const { Scenes, Markup } = require("telegraf");
const Gallery = require("../../../models/gallery");
const { savePhoto, validate } = require("../../helpers/telegram");
const fs = require("fs");
const path = require("path");

const UPLOADS_DIR = path.join(__dirname, "../../../uploads");
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// ================================
// Сцена обновления фото
// ================================
const updatePhotoScene = new Scenes.WizardScene(
  "update_photo",

  // ---------- Шаг 0: Загрузка фото ----------
  async (ctx) => {
    const photos = await Gallery.findAll({ order: [["id", "ASC"]] });
    ctx.wizard.state.sentMessages = [];
    ctx.wizard.state.fieldToEdit = null;
    ctx.wizard.state.photos = photos;
    ctx.wizard.state.currentIndex = 0;

    if (!photos.length) {
      await ctx.reply("❗ Фото в галерее пока нет");
      return ctx.scene.leave();
    }

    await showPhotoSlide(ctx);
    return ctx.wizard.next();
  },

  // ---------- Шаг 1: Выбор фото и поля для редактирования ----------
  async (ctx) => {
    if (!ctx.callbackQuery) return;

    const data = ctx.callbackQuery.data;
    const photos = ctx.wizard.state.photos;
    let idx = ctx.wizard.state.currentIndex;
    await ctx.answerCbQuery().catch(() => {});

    // --- Навигация по слайдам ---
    if (data === "back") idx = idx > 0 ? idx - 1 : photos.length - 1;
    if (data === "next") idx = idx < photos.length - 1 ? idx + 1 : 0;

    ctx.wizard.state.currentIndex = idx;

    if (data === "back" || data === "next") {
      await clearCurrentMessage(ctx);
      await showPhotoSlide(ctx);
      return;
    }

    // --- Редактирование ---
    if (data === "edit") {
      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback("Новое фото", "field_photo")],
        [Markup.button.callback("Подпись", "field_footer")],
        [Markup.button.callback("Фильтр", "field_filter")],
        [Markup.button.callback("Назад к просмотру", "back_to_slider")],
      ]);
      await ctx.editMessageReplyMarkup(keyboard.reply_markup);
      return;
    }

    // --- Вернуться к слайдам ---
    if (data === "back_to_slider") {
      await showPhotoSlide(ctx);
      return;
    }

    // --- Выбор поля для редактирования ---
    if (data.startsWith("field_")) {
      ctx.wizard.state.fieldToEdit = data.replace("field_", "");
      ctx.session.editPhotoId = photos[idx].id;

      const messages = {
        photo: "📸 Пришли новое фото для галереи",
        footer: "✏ Напиши новую подпись под фото",
        filter: "🎨 Укажи новый фильтр (например: black&white, vintage и т.д.)",
      };

      const msg = await ctx.reply(messages[ctx.wizard.state.fieldToEdit] || "✏ Пришли новое значение:");
      ctx.wizard.state.sentMessages.push(msg.message_id);

      return ctx.wizard.next();
    }
  },

  // ---------- Шаг 2: Получение нового значения ----------
  async (ctx) => {
    const field = ctx.wizard.state.fieldToEdit;
    const photoId = ctx.session.editPhotoId;
    if (!field || !photoId) return ctx.scene.leave();

    let newData = {};
    try {
      if (field === "photo") {
        const valid = await validate(ctx, "📸 Отправь фото!", "photo");
        if (!valid) return;

        const photo = ctx.message.photo.pop();
        const fileData = await savePhoto(ctx, photo.file_id, UPLOADS_DIR);

        // Удаляем старое фото с сервера
        const old = await Gallery.findByPk(photoId);
        if (old?.fileName) {
          const oldPath = path.join(UPLOADS_DIR, old.fileName);
          if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
        }

        newData = { fileName: fileData.fileName, photoFileId: photo.file_id };
        await ctx.reply("✅ Фото обновлено");

      } else {
        const valid = await validate(ctx, `✏ Отправь новое значение для ${field}!`, "text");
        if (!valid) return;

        const text = ctx.message.text.trim();
        newData = { [field]: text };
        await ctx.reply(`✅ ${field.charAt(0).toUpperCase() + field.slice(1)} обновлено`);
      }

      await Gallery.update(newData, { where: { id: photoId } });

      // Обновляем локальный массив
      const updated = await Gallery.findByPk(photoId);
      const i = ctx.wizard.state.photos.findIndex(p => p.id === photoId);
      if (i !== -1) ctx.wizard.state.photos[i] = updated;

    } catch (err) {
      console.error("Ошибка при обновлении фото:", err);
      await ctx.reply("❌ Ошибка при сохранении. Попробуй ещё раз.");
    }

    ctx.wizard.state.fieldToEdit = null;
    delete ctx.session.editPhotoId;

    await showPhotoSlide(ctx);
    return ctx.wizard.selectStep(1);
  }
);

// ================================
// Функция показа фото
// ================================
async function showPhotoSlide(ctx) {
  const idx = ctx.wizard.state.currentIndex;
  const photo = ctx.wizard.state.photos[idx];
  const filePath = path.join(UPLOADS_DIR, photo.fileName);
  const total = ctx.wizard.state.photos.length;

  const caption = `*Фото ${idx + 1} из ${total}*\nПодпись: ${photo.footer || "_не указана_"}\nФильтр: ${photo.filter || "_не указан_"}`;

  const keyboard = Markup.inlineKeyboard([
    [
      Markup.button.callback("⬅️", "back"),
      Markup.button.callback("Назад", "back"),
      Markup.button.callback("Изменить", "edit"),
      Markup.button.callback("➡️", "next"),
      Markup.button.callback("Вперёд", "next"),
    ],
  ]);

  await clearCurrentMessage(ctx);

  let msg;
  if (photo.photoFileId) {
    try {
      msg = await ctx.replyWithPhoto(photo.photoFileId, { caption, parse_mode: "Markdown", ...keyboard });
    } catch {
      if (fs.existsSync(filePath)) {
        msg = await ctx.replyWithPhoto({ source: filePath }, { caption, parse_mode: "Markdown", ...keyboard });
      }
    }
  } else if (fs.existsSync(filePath)) {
    msg = await ctx.replyWithPhoto({ source: filePath }, { caption, parse_mode: "Markdown", ...keyboard });
  } else {
    msg = await ctx.reply(`${caption}\n\nФото недоступно на сервере`, { parse_mode: "Markdown", ...keyboard });
  }

  ctx.wizard.state.currentMessageId = msg.message_id;
  ctx.wizard.state.sentMessages.push(msg.message_id);
}

// ================================
// Очистка сообщений сцены
// ================================
async function clearCurrentMessage(ctx) {
  for (const id of ctx.wizard.state.sentMessages || []) {
    try { await ctx.deleteMessage(id); } catch {}
  }
  ctx.wizard.state.sentMessages = [];
}

// ================================
// Экранирование Markdown
// ================================
String.prototype.escapeMarkdown = function () {
  return this.replace(/([_*[\]()~>`#+\-=|{}.!])/g, "\\$1");
};

module.exports = updatePhotoScene;
