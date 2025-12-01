const { Scenes, Markup } = require("telegraf");
const Gallery = require("../../../models/gallery");
const { savePhoto, validate, deleteOne } = require("../../helpers/telegram");
const fs = require("fs");
const path = require("path");

const UPLOADS_DIR = path.join(__dirname, "../../../uploads"); // путь к папке uploads
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const updatePhotoScene = new Scenes.WizardScene(
  "update_photo",

  // Шаг 0: загрузка всех фото
  async (ctx) => {
    const photos = await Gallery.findAll();
    ctx.wizard.state.sentMessages = [];
    ctx.wizard.state.data = {};

    if (!photos || photos.length === 0) {
      await ctx.reply("❗ Фото еще нет");
      return ctx.scene.leave();
    }

    ctx.wizard.state.photos = photos;
    ctx.wizard.state.currentIndex = 0;

    await showPhotoSlide(ctx);
    return ctx.wizard.next();
  },

  // Шаг 1: выбор фото для редактирования
  async (ctx) => {
    if (!ctx.callbackQuery) return;
    const data = ctx.callbackQuery.data;
    const photos = ctx.wizard.state.photos;
    let idx = ctx.wizard.state.currentIndex;
    await ctx.answerCbQuery().catch(() => {});

    // Навигация
    if (data === "back") {
      idx = idx > 0 ? idx - 1 : photos.length - 1;
      ctx.wizard.state.currentIndex = idx;
      await clearCurrentMessage(ctx);
      await showPhotoSlide(ctx);
      return;
    }

    if (data === "next") {
      idx = idx < photos.length - 1 ? idx + 1 : 0;
      ctx.wizard.state.currentIndex = idx;
      await clearCurrentMessage(ctx);
      await showPhotoSlide(ctx);
      return;
    }

    // Редактирование фото
    if (data === "edit") {
      await ctx.telegram.editMessageReplyMarkup(
        ctx.chat.id,
        ctx.wizard.state.currentMessageId,
        undefined,
        {
          inline_keyboard: [
            [{ text: "Фото", callback_data: "field_photo" }],
            [{ text: "Подпись", callback_data: "field_footer" }],
            [{ text: "Фильтр", callback_data: "field_filter" }],
            [{ text: "Назад к слайдам", callback_data: "back_to_slider" }],
          ],
        }
      );
      return;
    }

    if (data === "back_to_slider") {
      await showPhotoSlide(ctx);
      return;
    }

    if (data.startsWith("field_")) {
      ctx.wizard.state.fieldToEdit = data.replace("field_", "");
      ctx.session.editPhotoId = photos[idx].id;

      if (ctx.wizard.state.fieldToEdit === "photo") {
        const msg = await ctx.reply("📸 Отправь новое фото:");
        ctx.wizard.state.sentMessages.push(msg.message_id);
      } else {
        const msg = await ctx.reply(
          `✏ Отправь новое значение для ${ctx.wizard.state.fieldToEdit}:`
        );
        ctx.wizard.state.sentMessages.push(msg.message_id);
      }

      return ctx.wizard.next();
    }
  },

  // Шаг 2: получение нового значения
  async (ctx) => {
    const field = ctx.wizard.state.fieldToEdit;
    const photoId = ctx.session.editPhotoId;

    if (!field || !photoId) return ctx.scene.leave();

    let newData = {};

    if (field === "photo") {
      const valid = await validate(ctx, "📸 Отправь фото!", "photo");
      if (!valid) return;

      const photo = ctx.message.photo.pop();
      const fileData = await savePhoto(ctx, photo.file_id, UPLOADS_DIR);

      // удаляем старое фото
      const photoModel = await Gallery.findByPk(photoId);
      if (photoModel && photoModel.fileName) {
        const oldPath = path.join(UPLOADS_DIR, photoModel.fileName);
        if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
      }

      newData = { ...fileData, photoFileId: photo.file_id };
      await ctx.reply("✅ Фото обновлено");
    } else {
      const valid = await validate(
        ctx,
        `✏ Отправь новое значение для ${field}!`,
        "text"
      );
      if (!valid) return;
      newData = { [field]: ctx.message.text };
      await ctx.reply(`✅ ${field.charAt(0).toUpperCase() + field.slice(1)} обновлено`);
    }

    try {
      await Gallery.update(newData, { where: { id: photoId } });
    } catch (e) {
      console.error("Ошибка при обновлении фото:", e);
      await ctx.reply("❌ Ошибка при обновлении. Попробуй снова.");
    }

    await showPhotoSlide(ctx);
  }
);

// -------------------------------
// Функция показа фото
async function showPhotoSlide(ctx) {
  const idx = ctx.wizard.state.currentIndex;
  const photo = ctx.wizard.state.photos[idx];
  const filePath = path.join(UPLOADS_DIR, photo.fileName);

  const keyboard = Markup.inlineKeyboard([
    [
      Markup.button.callback("⬅️", "back"),
      Markup.button.callback("Изменить", "edit"),
      Markup.button.callback("➡️", "next"),
    ],
  ]);

  await clearCurrentMessage(ctx);

  let msg;
  if (fs.existsSync(filePath)) {
    msg = await ctx.replyWithPhoto(
      { source: filePath },
      {
        caption: `📝 ${photo.footer || "—"}\n🎨 ${photo.filter || "—"}\n\n${idx + 1}/${ctx.wizard.state.photos.length}`,
        ...keyboard,
      }
    );
  } else {
    msg = await ctx.reply(
      `❌ Фото недоступно на сервере\n📝 ${photo.footer || "—"}\n🎨 ${photo.filter || "—"}`,
      keyboard
    );
  }

  ctx.wizard.state.currentMessageId = msg.message_id;
  ctx.wizard.state.sentMessages.push(msg.message_id);
}

// Очистка сообщений сцены
async function clearCurrentMessage(ctx) {
  const ids = ctx.wizard.state.sentMessages || [];
  for (const id of ids) {
    try {
      await ctx.deleteMessage(id);
    } catch {}
  }
  ctx.wizard.state.sentMessages = [];
}

module.exports = updatePhotoScene;
