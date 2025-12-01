// bot/scenes/addPhotoScene.js
const { Scenes } = require("telegraf");
const Gallery = require("../../../models/gallery");
const {
  savePhoto,
  showPreview,
  validate,
  clearMessages,
  deleteOne,
} = require("../../helpers/telegram");

const addPhotoScene = new Scenes.WizardScene(
  "add_photo",

  // 0 — просим фото
  async (ctx) => {
    ctx.wizard.state.data = {};
    ctx.wizard.state.sentMessages = [];

    const msg = await ctx.reply("📸 Пришли фото для галереи");
    ctx.wizard.state.sentMessages.push(msg.message_id);

    return ctx.wizard.next();
  },

  // 1 — получаем фото
  async (ctx) => {
    const valid = await validate(ctx, "Отправь фото!", "photo");
    if (!valid) return;

    const photo = ctx.message.photo.pop();
    ctx.wizard.state.data.photoFileId = photo.file_id;

    await deleteOne(ctx);
    await showPreview(ctx, "фильтр (например: summer, retro...)", 1);

    return ctx.wizard.next();
  },

  // 2 — ввод фильтра
  async (ctx) => {
    const valid = await validate(ctx, "Введи название фильтра!", "text");
    if (!valid) return;

    ctx.wizard.state.data.filter = ctx.message.text;
    await deleteOne(ctx);
    await showPreview(ctx, "подпись (footer)", 2);

    return ctx.wizard.next();
  },

  // 3 — ввод подписи и финальное сохранение
  async (ctx) => {
    const valid = await validate(ctx, "Введи подпись!", "text");
    if (!valid) return;

    ctx.wizard.state.data.footer = ctx.message.text;

    try {
      // Сохраняем файл на сервер и получаем точное имя и URL
      const fileData = await savePhoto(ctx, ctx.wizard.state.data.photoFileId);

      // Обновляем wizard state для корректного сохранения
      Object.assign(ctx.wizard.state.data, fileData);

      // Сохраняем запись в базе
      await Gallery.create({
        fileName: ctx.wizard.state.data.fileName,
        fileUrl: ctx.wizard.state.data.fileUrl,
        filter: ctx.wizard.state.data.filter,
        footer: ctx.wizard.state.data.footer,
      });

      // Отправляем финальное превью
      await ctx.replyWithPhoto(
        { source: ctx.wizard.state.data.fileUrl },
        {
          caption:
            `Фото добавлено в галерею!\n\n` +
            `🎛 Фильтр: ${ctx.wizard.state.data.filter}\n` +
            `💬 Подпись: ${ctx.wizard.state.data.footer}`,
        }
      );
    } catch (err) {
      console.error("Gallery save error:", err);
      await ctx.reply("❌ Ошибка при добавлении фото.");
    }

    await clearMessages(ctx);
    return ctx.scene.leave();
  }
);

module.exports = addPhotoScene;
