// bot/scenes/createEventScene.js
const { Scenes } = require("telegraf");
const Events = require("../../../models/events");
const {
  savePhoto,
  showPreview,
  validate,
  clearMessages,
  deleteOne,
} = require("../../helpers/telegram");

const createEventScene = new Scenes.WizardScene(
  "create_event",
  // 0 - старт
  async (ctx) => {
    ctx.wizard.state.data = {};
    ctx.wizard.state.sentMessages = [];
    const msg = await ctx.reply("Пришли фото");
    ctx.wizard.state.sentMessages.push(msg.message_id);
    return ctx.wizard.next();
  },

  // 1 - фото
  async (ctx) => {
    if (ctx.callbackQuery) {
      const action = ctx.callbackQuery.data;
      try {
        await ctx.answerCbQuery();
      } catch {}
      if (action === "next") {
        if (!ctx.wizard.state.data.photoFileId) {
          const msg = await ctx.reply("Сначала отправь фото!");
          setTimeout(async () => {
            try {
              await ctx.deleteMessage(msg.message_id);
            } catch {}
          }, 1500);
          return;
        }
        return ctx.wizard.next();
      }
      if (action === "back") {
        const msg = await ctx.reply("Нажми stop, если хочешь закончить");
        ctx.wizard.state.sentMessages.push(msg.message_id);
        return;
      }
      if (action === "stop") {
        await clearMessages(ctx);
        return ctx.scene.leave();
      }
    }

    const valid = await validate(ctx, "Отправь фото!", "photo");
    if (!valid) return;

    const photo = ctx.message.photo.pop();
    ctx.wizard.state.data.photoFileId = photo.file_id;

    await deleteOne(ctx);
    await showPreview(ctx, "описание", 1);

    return ctx.wizard.next();
  },

  // 2 - описание
  async (ctx) => {
    if (ctx.callbackQuery) {
      const action = ctx.callbackQuery.data;
      try {
        await ctx.answerCbQuery();
      } catch {}
      if (action === "next") {
        if (!ctx.wizard.state.data.description) {
          const msg = await ctx.reply("Сначала описание!");
          setTimeout(async () => {
            try {
              await ctx.deleteMessage(msg.message_id);
            } catch {}
          }, 1500);
          return;
        }
        await deleteOne(ctx);
        await showPreview(ctx, "дата", 2);
        return ctx.wizard.next();
      }
      if (action === "back") {
        await deleteOne(ctx);
        await showPreview(ctx, "фото", 0);
        return ctx.wizard.back();
      }
      if (action === "stop") {
        await clearMessages(ctx);
        return ctx.scene.leave();
      }
    }

    const valid = await validate(ctx, "Напиши описание!", "text");
    if (!valid) return;

    ctx.wizard.state.data.description = ctx.message.text;

    await deleteOne(ctx);
    await showPreview(ctx, "дата", 2);

    return ctx.wizard.next();
  },

  // 3 - дата
  async (ctx) => {
    if (ctx.callbackQuery) {
      const action = ctx.callbackQuery.data;
      try {
        await ctx.answerCbQuery();
      } catch {}
      if (action === "next") {
        if (!ctx.wizard.state.data.date) {
          const msg = await ctx.reply("Введи дату!");
          setTimeout(async () => {
            try {
              await ctx.deleteMessage(msg.message_id);
            } catch {}
          }, 1500);
          return;
        }
        await deleteOne(ctx);
        await showPreview(ctx, "место", 3);
        return ctx.wizard.next();
      }
      if (action === "back") {
        await deleteOne(ctx);
        await showPreview(ctx, "описание", 1);
        return ctx.wizard.back();
      }
      if (action === "stop") {
        await clearMessages(ctx);
        return ctx.scene.leave();
      }
    }

    const valid = await validate(ctx, "Введи дату!", "text");
    if (!valid) return;

    ctx.wizard.state.data.date = ctx.message.text;

    await deleteOne(ctx);
    await showPreview(ctx, "место", 3);

    return ctx.wizard.next();
  },

  // 4 - место и сохранение
  async (ctx) => {
    if (ctx.callbackQuery) {
      const action = ctx.callbackQuery.data;
      try {
        await ctx.answerCbQuery();
      } catch {}
      if (action === "back") {
        await deleteOne(ctx);
        await showPreview(ctx, "дата", 2);
        return ctx.wizard.back();
      }
      if (action === "stop") {
        await clearMessages(ctx);
        return ctx.scene.leave();
      }
    }

    const valid = await validate(ctx, "Введи место!", "text");
    if (!valid) return;

    ctx.wizard.state.data.place = ctx.message.text;

    try {

      const fileData = await savePhoto(ctx, ctx.wizard.state.data.photoFileId);

      Object.assign(ctx.wizard.state.data, fileData);

      await Events.create(ctx.wizard.state.data);

      await ctx.replyWithPhoto(ctx.wizard.state.data.photoFileId, {
        caption:
          `Создано!\n\n` +
          `📝 ${ctx.wizard.state.data.description}\n` +
          `📅 ${ctx.wizard.state.data.date}\n` +
          `📍 ${ctx.wizard.state.data.place}`,
      });
    } catch (e) {
      console.error("Create event error:", e);
      await ctx.reply("Ошибка. Попробуй позже.");
    }

    await clearMessages(ctx);
    return ctx.scene.leave();
  }
);

module.exports = createEventScene;
