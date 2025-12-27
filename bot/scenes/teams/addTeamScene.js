// bot/scenes/createTeamScene.js
const { Scenes } = require("telegraf");
const Teams = require("../../../models/teams");
const {
  savePhoto,
  showPreview,
  validate,
  clearMessages,
  deleteOne,
} = require("../../helpers/telegram");

const createTeamScene = new Scenes.WizardScene(
  "add_team",

  // 0 - старт
  async (ctx) => {
    ctx.wizard.state.data = {};
    ctx.wizard.state.sentMessages = [];
    const msg = await ctx.reply("📸 Пришли фото команды");
    ctx.wizard.state.sentMessages.push(msg.message_id);
    return ctx.wizard.next();
  },

  // 1 - фото
  async (ctx) => {
    if (ctx.callbackQuery) {
      const action = ctx.callbackQuery.data;
      try { await ctx.answerCbQuery(); } catch {}

      if (action === "next") {
        if (!ctx.wizard.state.data.photoFileId) {
          const msg = await ctx.reply("Сначала отправь фото!");
          setTimeout(async () => { try { await ctx.deleteMessage(msg.message_id); } catch {} }, 1500);
          return;
        }
        return ctx.wizard.next();
      }
      if (action === "back") return; // назад пока нет, на шаге 0
      if (action === "stop") {
        await clearMessages(ctx);
        return ctx.scene.leave();
      }
    }

    const valid = await validate(ctx, "Сначала отправь фото!", "photo");
    if (!valid) return;

    const photo = ctx.message.photo.pop();
    ctx.wizard.state.data.photoFileId = photo.file_id;

    await deleteOne(ctx);
    await showPreview(ctx, "название команды", 1);
    return ctx.wizard.next();
  },

  // 2 - название
  async (ctx) => {
    if (ctx.callbackQuery) {
      const action = ctx.callbackQuery.data;
      try { await ctx.answerCbQuery(); } catch {}
      if (action === "next") {
        if (!ctx.wizard.state.data.name) {
          const msg = await ctx.reply("Сначала введи название команды!");
          setTimeout(async () => { try { await ctx.deleteMessage(msg.message_id); } catch {} }, 1500);
          return;
        }
        await deleteOne(ctx);
        await showPreview(ctx, "город команды", 2);
        return ctx.wizard.next();
      }
      if (action === "back") {
        await deleteOne(ctx);
        await showPreview(ctx, "фото команды", 0);
        return ctx.wizard.back();
      }
      if (action === "stop") {
        await clearMessages(ctx);
        return ctx.scene.leave();
      }
    }

    const valid = await validate(ctx, "Напиши название команды!", "text");
    if (!valid) return;

    ctx.wizard.state.data.name = ctx.message?.text?.trim();
    await deleteOne(ctx);
    await showPreview(ctx, "город команды", 2);
    return ctx.wizard.next();
  },

  // 3 - город
  async (ctx) => {
    if (ctx.callbackQuery) {
      const action = ctx.callbackQuery.data;
      try { await ctx.answerCbQuery(); } catch {}
      if (action === "next") {
        if (!ctx.wizard.state.data.city) {
          const msg = await ctx.reply("Сначала введи город команды!");
          setTimeout(async () => { try { await ctx.deleteMessage(msg.message_id); } catch {} }, 1500);
          return;
        }
        await deleteOne(ctx);
        await showPreview(ctx, "возраст участников", 3);
        return ctx.wizard.next();
      }
      if (action === "back") {
        await deleteOne(ctx);
        await showPreview(ctx, "название команды", 1);
        return ctx.wizard.back();
      }
      if (action === "stop") {
        await clearMessages(ctx);
        return ctx.scene.leave();
      }
    }

    const valid = await validate(ctx, "Напиши город команды!", "text");
    if (!valid) return;

    ctx.wizard.state.data.city = ctx.message?.text?.trim();
    await deleteOne(ctx);
    await showPreview(ctx, "возраст участников", 3);
    return ctx.wizard.next();
  },

  // 4 - возраст участников
  async (ctx) => {
    if (ctx.callbackQuery) {
      const action = ctx.callbackQuery.data;
      try { await ctx.answerCbQuery(); } catch {}
      if (action === "next") {
        if (!ctx.wizard.state.data.ageRange) {
          const msg = await ctx.reply("Сначала укажи возраст участников!");
          setTimeout(async () => { try { await ctx.deleteMessage(msg.message_id); } catch {} }, 1500);
          return;
        }
        await deleteOne(ctx);
        await showPreview(ctx, "преподаватели и хореограф", 4);
        return ctx.wizard.next();
      }
      if (action === "back") {
        await deleteOne(ctx);
        await showPreview(ctx, "город команды", 2);
        return ctx.wizard.back();
      }
      if (action === "stop") {
        await clearMessages(ctx);
        return ctx.scene.leave();
      }
    }

    const valid = await validate(ctx, "Укажи возраст участников!", "text");
    if (!valid) return;

    ctx.wizard.state.data.ageRange = ctx.message?.text?.trim();
    await deleteOne(ctx);
    await showPreview(ctx, "преподаватели и хореограф", 4);
    return ctx.wizard.next();
  },

  // 5 - преподаватели
  async (ctx) => {
    if (ctx.callbackQuery) {
      const action = ctx.callbackQuery.data;
      try { await ctx.answerCbQuery(); } catch {}
      if (action === "next") {
        if (!ctx.wizard.state.data.instructors) {
          const msg = await ctx.reply("Сначала укажи преподавателей и хореографа!");
          setTimeout(async () => { try { await ctx.deleteMessage(msg.message_id); } catch {} }, 1500);
          return;
        }
        await deleteOne(ctx);
        await showPreview(ctx, "достижения команды (через ;)", 5);
        return ctx.wizard.next();
      }
      if (action === "back") {
        await deleteOne(ctx);
        await showPreview(ctx, "возраст участников", 3);
        return ctx.wizard.back();
      }
      if (action === "stop") {
        await clearMessages(ctx);
        return ctx.scene.leave();
      }
    }

    const valid = await validate(ctx, "Укажи преподавателей и хореографа!", "text");
    if (!valid) return;

    ctx.wizard.state.data.instructors = ctx.message?.text?.trim();
    await deleteOne(ctx);
    await showPreview(ctx, "достижения команды (через ;)", 5);
    return ctx.wizard.next();
  },

  // 6 - достижения и сохранение
  async (ctx) => {
    if (ctx.callbackQuery) {
      const action = ctx.callbackQuery.data;
      try { await ctx.answerCbQuery(); } catch {}
      if (action === "back") {
        await deleteOne(ctx);
        await showPreview(ctx, "преподаватели и хореограф", 4);
        return ctx.wizard.back();
      }
      if (action === "stop") {
        await clearMessages(ctx);
        return ctx.scene.leave();
      }
    }

    const valid = await validate(ctx, "Укажи достижения команды!", "text");
    if (!valid) return;

    ctx.wizard.state.data.achievements = ctx.message?.text
      ? ctx.message.text.split(";").map(a => a.trim())
      : [];

    try {
      await deleteOne(ctx);
      const fileData = await savePhoto(ctx, ctx.wizard.state.data.photoFileId);
      Object.assign(ctx.wizard.state.data, fileData);

      await Teams.create(ctx.wizard.state.data);

      await ctx.replyWithPhoto(ctx.wizard.state.data.photoFileId, {
        caption:
          `✅ Команда создана!\n\n` +
          `🏷 Название: ${ctx.wizard.state.data.name}\n` +
          `🏙 Город: ${ctx.wizard.state.data.city}\n` +
          `🎂 Возраст: ${ctx.wizard.state.data.ageRange}\n` +
          `👨‍🏫 Преподаватели: ${ctx.wizard.state.data.instructors}\n` +
          `🏆 Достижения:\n${ctx.wizard.state.data.achievements.map(a => `• ${a}`).join("\n")}`,
      });
    } catch (e) {
      console.error("Create team error:", e);
      await ctx.reply("❌ Ошибка при создании команды. Попробуй позже.");
    }

    await clearMessages(ctx);
    return ctx.scene.leave();
  }
);

module.exports = createTeamScene;
