// bot/scenes/createTeamScene.js
const { Scenes, Markup } = require("telegraf");
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

  // 0 - фото
  async (ctx) => {
    ctx.wizard.state.data = {};
    ctx.wizard.state.sentMessages = [];

    const msg = await ctx.reply("📸 Пришли фото команды");
    ctx.wizard.state.sentMessages[0] = msg.message_id;

    return ctx.wizard.next();
  },

  // 1 - загрузка фото
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

      if (action === "back") return;
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
    await showPreview(ctx, "название команды", { stepIndex: 1 });
    return ctx.wizard.next();
  },

  // 2 - название команды
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
        await showPreview(ctx, "город команды", { stepIndex: 2 });
        return ctx.wizard.next();
      }

      if (action === "back") {
        await deleteOne(ctx);
        await showPreview(ctx, "фото команды", { stepIndex: 0 });
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
    await showPreview(ctx, "город команды", { stepIndex: 2 });
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
        await showPreview(ctx, "возраст участников", { stepIndex: 3 });
        return ctx.wizard.next();
      }

      if (action === "back") {
        await deleteOne(ctx);
        await showPreview(ctx, "название команды", { stepIndex: 1 });
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
    await showPreview(ctx, "возраст участников", { stepIndex: 3 });
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
        await showPreview(ctx, "преподаватели и хореограф", { stepIndex: 4 });
        return ctx.wizard.next();
      }

      if (action === "back") {
        await deleteOne(ctx);
        await showPreview(ctx, "город команды", { stepIndex: 2 });
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
    await showPreview(ctx, "преподаватели и хореограф", { stepIndex: 4 });
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
        await showPreview(ctx, "достижения команды (через ;)", { stepIndex: 5 });
        return ctx.wizard.next();
      }

      if (action === "back") {
        await deleteOne(ctx);
        await showPreview(ctx, "возраст участников", { stepIndex: 3 });
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
    await showPreview(ctx, "достижения команды (через ;)", { stepIndex: 5 });
    return ctx.wizard.next();
  },

  // 6 - достижения
  async (ctx) => {
    if (ctx.callbackQuery) {
      const action = ctx.callbackQuery.data;
      try { await ctx.answerCbQuery(); } catch {}

      if (action === "next") {
        if (!ctx.wizard.state.data.achievements) {
          const msg = await ctx.reply("Сначала укажи достижения команды!");
          setTimeout(async () => { try { await ctx.deleteMessage(msg.message_id); } catch {} }, 1500);
          return;
        }
        await deleteOne(ctx);
        await showPreview(ctx, "описание команды", { stepIndex: 6 });
        return ctx.wizard.next();
      }

      if (action === "back") {
        await deleteOne(ctx);
        await showPreview(ctx, "преподаватели и хореограф", { stepIndex: 4 });
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

    await deleteOne(ctx);
    await showPreview(ctx, "описание команды", { stepIndex: 6 });
    return ctx.wizard.next();
  },

  // 7 - описание
  async (ctx) => {
    if (ctx.callbackQuery) {
      const action = ctx.callbackQuery.data;
      try { await ctx.answerCbQuery(); } catch {}

      if (action === "next") {
        if (!ctx.wizard.state.data.description) {
          const msg = await ctx.reply("Сначала напиши описание команды!");
          setTimeout(async () => { try { await ctx.deleteMessage(msg.message_id); } catch {} }, 1500);
          return;
        }
        await deleteOne(ctx);
        await showRecruitingQuestion(ctx);
        return ctx.wizard.next();
      }

      if (action === "back") {
        await deleteOne(ctx);
        await showPreview(ctx, "достижения команды (через ;)", { stepIndex: 5 });
        return ctx.wizard.back();
      }

      if (action === "stop") {
        await clearMessages(ctx);
        return ctx.scene.leave();
      }
    }

    const valid = await validate(ctx, "Напиши описание команды!", "text");
    if (!valid) return;

    ctx.wizard.state.data.description = ctx.message?.text?.trim();
    await deleteOne(ctx);
    await showRecruitingQuestion(ctx);
    return ctx.wizard.next();
  },

  // 8 - набор участников
  async (ctx) => {
    if (ctx.callbackQuery) {
      const action = ctx.callbackQuery.data;
      try { await ctx.answerCbQuery(); } catch {}

      if (action === "back") {
        await deleteOne(ctx);
        await showPreview(ctx, "описание команды", { stepIndex: 6 });
        return ctx.wizard.back();
      }

      if (action === "stop") {
        await clearMessages(ctx);
        return ctx.scene.leave();
      }

      if (action === "recruit_yes") {
        ctx.wizard.state.data.isRecruiting = true;
        await saveAndFinish(ctx);
        return;
      }

      if (action === "recruit_no") {
        ctx.wizard.state.data.isRecruiting = false;
        await saveAndFinish(ctx);
        return;
      }
    }

    const text = ctx.message?.text?.trim().toLowerCase();
    if (["да", "yes", "✅ да"].includes(text)) {
      ctx.wizard.state.data.isRecruiting = true;
      await saveAndFinish(ctx);
      return;
    }
    if (["нет", "no", "❌ нет"].includes(text)) {
      ctx.wizard.state.data.isRecruiting = false;
      await saveAndFinish(ctx);
      return;
    }

    await deleteOne(ctx);
    await showRecruitingQuestion(ctx);
  }
);

// --- Вспомогательные функции ---

async function showRecruitingQuestion(ctx) {
  const d = ctx.wizard.state.data || {};
  let text = `📋 Предпросмотр:\n\n` +
             `Шаг: набор в команду\n` +
             `❓ Команда открыта для набора новых участников?`;

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback("✅ Да", "recruit_yes"), Markup.button.callback("❌ Нет", "recruit_no")],
    [Markup.button.callback("⬅️ Назад", "back"), Markup.button.callback("⛔ Отменить", "stop")]
  ]);

  // Удаляем старое сообщение
  const prevMsgId = ctx.wizard.state.sentMessages[7];
  if (prevMsgId) {
    try { await ctx.deleteMessage(prevMsgId); } catch {}
  }

  const msg = d.photoFileId
    ? await ctx.replyWithPhoto(d.photoFileId, { caption: text, ...keyboard })
    : await ctx.reply(text, keyboard);

  ctx.wizard.state.sentMessages[7] = msg.message_id;
}

async function saveAndFinish(ctx) {
  try {
    await deleteOne(ctx);

    const fileData = await savePhoto(ctx, ctx.wizard.state.data.photoFileId);
    Object.assign(ctx.wizard.state.data, fileData);

    await Teams.create(ctx.wizard.state.data);

    const recruitingStatus = ctx.wizard.state.data.isRecruiting ? "✅ Открыт для набора" : "❌ Набор закрыт";

    await ctx.replyWithPhoto(ctx.wizard.state.data.photoFileId, {
      caption:
        `✅ Команда создана!\n\n` +
        `🏷 Название: ${ctx.wizard.state.data.name}\n` +
        `🏙 Город: ${ctx.wizard.state.data.city}\n` +
        `🎂 Возраст: ${ctx.wizard.state.data.ageRange}\n` +
        `👨‍🏫 Преподаватели: ${ctx.wizard.state.data.instructors}\n` +
        `🏆 Достижения:\n${ctx.wizard.state.data.achievements.map(a => `• ${a}`).join("\n")}\n` +
        `📝 Описание: ${ctx.wizard.state.data.description}\n` +
        `👥 ${recruitingStatus}`
    });
  } catch (e) {
    console.error("Create team error:", e);
    await ctx.reply("❌ Ошибка при создании команды. Попробуй позже.");
  }

  await clearMessages(ctx);
  return ctx.scene.leave();
}

module.exports = createTeamScene;
