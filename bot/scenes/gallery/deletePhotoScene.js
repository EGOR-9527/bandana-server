const { Scenes, Markup } = require("telegraf");
const Gallery = require("../../../models/gallery");
const fs = require("fs");
const path = require("path");

// Абсолютный путь к папке uploads
const UPLOADS_DIR = path.join(__dirname, "../../../uploads");

// Создаем папку, если ее нет
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const deletePhotoScene = new Scenes.WizardScene(
  "delete_photo",

  // Шаг 0 — показываем первую фотографию
  async (ctx) => {
    const photos = await Gallery.findAll();
    ctx.wizard.state.sentMessages = [];
    ctx.wizard.state.data = {};

    if (!photos || photos.length === 0) {
      await ctx.reply("❌ Нет фото для удаления.");
      return ctx.scene.leave();
    }

    ctx.wizard.state.photos = photos;
    ctx.wizard.state.currentIndex = 0;

    await showPhotoSlide(ctx);
    return ctx.wizard.next();
  },

  // Шаг 1 — ожидание действий (удаление, следующее, предыдущее)
  async (ctx) => {
    if (!ctx.callbackQuery) return;
    const action = ctx.callbackQuery.data;
    try { await ctx.answerCbQuery(); } catch {}

    const idx = ctx.wizard.state.currentIndex;
    const photos = ctx.wizard.state.photos;

    if (action === "delete") {
      const photo = photos[idx];

      // Удаляем файл с сервера
      const filePath = path.join(UPLOADS_DIR, photo.fileName);
      if (fs.existsSync(filePath)) {
        try { fs.unlinkSync(filePath); } catch (err) { console.error("Ошибка удаления файла:", err); }
      }

      // Удаляем из БД
      try { await photo.destroy(); } catch (err) { console.error("Ошибка удаления из БД:", err); }

      await ctx.reply("🗑 Фото удалено!");

      photos.splice(idx, 1);

      if (photos.length === 0) {
        await ctx.reply("Больше фото нет.");
        return ctx.scene.leave();
      }

      ctx.wizard.state.currentIndex = idx >= photos.length ? photos.length - 1 : idx;
      return showPhotoSlide(ctx);
    }

    if (action === "next") {
      ctx.wizard.state.currentIndex = (idx + 1) % photos.length;
      return showPhotoSlide(ctx);
    }

    if (action === "prev") {
      ctx.wizard.state.currentIndex = (idx - 1 + photos.length) % photos.length;
      return showPhotoSlide(ctx);
    }

    if (action === "stop") {
      await clearCurrentMessage(ctx);
      return ctx.scene.leave();
    }
  }
);

// Функция показа фото
async function showPhotoSlide(ctx) {
  const idx = ctx.wizard.state.currentIndex;
  const photo = ctx.wizard.state.photos[idx];
  const filePath = path.join(UPLOADS_DIR, photo.fileName);

  const keyboard = Markup.inlineKeyboard([
    [
      Markup.button.callback("⬅️", "prev"),
      Markup.button.callback("🗑 Удалить", "delete"),
      Markup.button.callback("➡️", "next"),
    ],
    [Markup.button.callback("⛔ Завершить", "stop")],
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
    try { await ctx.deleteMessage(id); } catch {}
  }
  ctx.wizard.state.sentMessages = [];
}

module.exports = deletePhotoScene;
