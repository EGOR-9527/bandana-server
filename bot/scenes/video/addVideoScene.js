// bot/scenes/addVideoScene.js
const { Scenes, Markup } = require("telegraf");
const Video = require("../../../models/video");
const { deleteOne, clearMessages, validate, saveVideo } = require("../../helpers/telegram");

const addVideoScene = new Scenes.WizardScene(
  "add_video",

  // 0 — старт: запрос видео
  async (ctx) => {
    ctx.wizard.state.data = {};
    ctx.wizard.state.sentMessages = [];

    const msg = await ctx.reply("🎬 Пришли видео (до 50 МБ):");
    ctx.wizard.state.sentMessages.push(msg.message_id);

    return ctx.wizard.next();
  },

  // 1 — получение видео (сохраняем только file_id)
  async (ctx) => {
    const video = ctx.message?.video;

    const valid = await validate(ctx, "❌ Пришли видео", "video");
    if (!valid) return;

    if (video.file_size > 50 * 1024 * 1024) {
      const msg = await ctx.reply("❌ Видео слишком большое. Максимум 50 МБ.");
      ctx.wizard.state.sentMessages.push(msg.message_id);
      return;
    }

    // Сохраняем временно file_id
    ctx.wizard.state.data.videoFileId = video.file_id;

    await deleteOne(ctx);

    const nameMsg = await ctx.reply("📝 Введи название видео:");
    ctx.wizard.state.sentMessages.push(nameMsg.message_id);

    return ctx.wizard.next();
  },

  // 2 — получение названия видео и финальное сохранение
  async (ctx) => {
    const text = ctx.message?.text?.trim();
    if (!text) {
      const msg = await ctx.reply("❌ Название не может быть пустым. Попробуй ещё раз:");
      ctx.wizard.state.sentMessages.push(msg.message_id);
      return;
    }

    ctx.wizard.state.data.name = text;

    try {
      // Сохраняем видео на сервер и получаем fileName и fileUrl
      const saved = await saveVideo(ctx, ctx.wizard.state.data.videoFileId);
      if (!saved) {
        const msg = await ctx.reply("❌ Не удалось сохранить видео на сервер. Попробуй ещё раз.");
        ctx.wizard.state.sentMessages.push(msg.message_id);
        return;
      }

      // Используем имя и путь файла, которые вернул saveVideo
      ctx.wizard.state.data.fileName = saved.fileName;
      ctx.wizard.state.data.fileUrl = saved.fileUrl;

      // Создаём запись в базе
      await Video.create({
        fileName: ctx.wizard.state.data.fileName,
        fileUrl: ctx.wizard.state.data.fileUrl,
        name: ctx.wizard.state.data.name,
      });

      const msg = await ctx.reply("✅ Видео успешно добавлено!", {
        reply_markup: Markup.inlineKeyboard([[Markup.button.callback("⛔ Завершить", "stop")]]),
      });
      ctx.wizard.state.sentMessages.push(msg.message_id);
    } catch (err) {
      console.error("Add video error:", err);
      const msg = await ctx.reply("❌ Ошибка при добавлении видео. Попробуй позже.");
      ctx.wizard.state.sentMessages.push(msg.message_id);
    }

    await clearMessages(ctx);
    return ctx.scene.leave();
  }
);

module.exports = addVideoScene;
