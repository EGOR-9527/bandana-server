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

  async (ctx) => {
    ctx.wizard.state.data = {};
    ctx.wizard.state.sentMessages = [];

    const msg = await ctx.reply("📸 Пришли фото для галереи");
    ctx.wizard.state.sentMessages.push(msg.message_id);

    return ctx.wizard.next();
  },

  async (ctx) => {
    if (ctx.callbackQuery) {
      const action = ctx.callbackQuery.data;
      try {
        await ctx.answerCbQuery();
      } catch {}
      if (action === "stop") {
        await clearMessages(ctx);
        return ctx.scene.leave();
      }
    }

    const valid = await validate(ctx, "Отправь фото!", "photo");
    if (!valid) return;

    if (!ctx.message?.photo || !ctx.message.photo.length) {
      const msg = await ctx.reply("❌ Фото не обнаружено. Попробуй ещё раз.");
      ctx.wizard.state.sentMessages.push(msg.message_id);
      return;
    }

    const photo = ctx.message.photo.pop();
    ctx.wizard.state.data.photoFileId = photo.file_id;

    await deleteOne(ctx);
    await showPreview(ctx, "фильтр (например: summer, retro...)", 1);

    return ctx.wizard.next();
  },

  async (ctx) => {
    if (ctx.callbackQuery) {
      const action = ctx.callbackQuery.data;
      try {
        await ctx.answerCbQuery();
      } catch {}
      if (action === "stop") {
        await clearMessages(ctx);
        return ctx.scene.leave();
      }
    }
    const valid = await validate(ctx, "Введи название фильтра!", "text");
    if (!valid) return;

    const text = ctx.message?.text?.trim();
    if (!text) {
      const msg = await ctx.reply("❌ Сначала введи название фильтра!");
      setTimeout(async () => {
        try {
          await ctx.deleteMessage(msg.message_id);
        } catch {}
      }, 1500);
      return;
    }

    ctx.wizard.state.data.filter = text;

    await deleteOne(ctx);
    await showPreview(ctx, "подпись (footer)", 2);

    return ctx.wizard.next();
  },

  async (ctx) => {
    if (ctx.callbackQuery) {
      const action = ctx.callbackQuery.data;
      try {
        await ctx.answerCbQuery();
      } catch {}
      if (action === "stop") {
        await clearMessages(ctx);
        return ctx.scene.leave();
      }
    }
    const valid = await validate(ctx, "Введи подпись!", "text");
    if (!valid) return;

    const text = ctx.message?.text?.trim();
    if (!text) {
      const msg = await ctx.reply("❌ Сначала введи подпись!");
      setTimeout(async () => {
        try {
          await ctx.deleteMessage(msg.message_id);
        } catch {}
      }, 1500);
      return;
    }

    ctx.wizard.state.data.footer = text;

    try {
      const fileData = await savePhoto(ctx, ctx.wizard.state.data.photoFileId);

      Object.assign(ctx.wizard.state.data, fileData);

      await Gallery.create({
        fileName: ctx.wizard.state.data.fileName,
        fileUrl: ctx.wizard.state.data.fileUrl,
        filter: ctx.wizard.state.data.filter,
        footer: ctx.wizard.state.data.footer,
      });

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
