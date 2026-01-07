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

const handleCallbackAction = async (ctx, actions) => {
  if (!ctx.callbackQuery) return null;
  
  const action = ctx.callbackQuery.data;
  
  if (action === "stop") {
    await clearMessages(ctx);
    await ctx.scene.leave();
    return true;
  }
  
  if (actions[action]) {
    await actions[action]();
    return true;
  }
  
  return false;
};

const showRecruitingStep = async (ctx) => {
  const d = ctx.wizard.state.data || {};
  let text = `📋 Предпросмотр:\n\n`;
  text += `\nШаг: набор в команду\n`;
  text += `❓ Команда открыта для набора новых участников?`;
  
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback("✅ Да", "recruit_yes"), Markup.button.callback("❌ Нет", "recruit_no")],
    [Markup.button.callback("⬅️ Назад", "back"), Markup.button.callback("⛔ Отменить", "stop")]
  ]);
  
  if (ctx.wizard.state.sentMessages?.recruit) {
    try {
      await ctx.deleteMessage(ctx.wizard.state.sentMessages.recruit);
    } catch {}
  }
  
  let msg;
  if (d.photoFileId) {
    msg = await ctx.replyWithPhoto(d.photoFileId, { caption: text, parse_mode: "HTML", ...keyboard });
  } else {
    msg = await ctx.reply(text, { parse_mode: "HTML", ...keyboard });
  }
  
  ctx.wizard.state.sentMessages.recruit = msg.message_id;
};

const createInputHandler = (fieldName, nextStepLabel, currentStepIndex, prevStepIndex) => {
  return async (ctx) => {
    const handled = await handleCallbackAction(ctx, {
      next: async () => {
        if (!ctx.wizard.state.data[fieldName]) {
          const msg = await ctx.reply(`Сначала введи ${nextStepLabel.toLowerCase()}!`);
          setTimeout(async () => {
            try { await ctx.deleteMessage(msg.message_id); } catch {}
          }, 1500);
          return;
        }
        await deleteOne(ctx);
        await showPreview(ctx, nextStepLabel, { stepIndex: currentStepIndex + 1 });
        return ctx.wizard.next();
      },
      back: async () => {
        await deleteOne(ctx);
        await showPreview(ctx, prevStepLabel, { stepIndex: prevStepIndex });
        return ctx.wizard.back();
      }
    });
    
    if (handled) return;
    
    const valid = await validate(ctx, `Напиши ${nextStepLabel.toLowerCase()}!`, "text");
    if (!valid) return;
    
    ctx.wizard.state.data[fieldName] = ctx.message?.text?.trim();
    await deleteOne(ctx);
    await showPreview(ctx, nextStepLabel, { stepIndex: currentStepIndex + 1 });
    return ctx.wizard.next();
  };
};

const saveAndFinish = async (ctx) => {
  try {
    await deleteOne(ctx);
    
    const fileData = await savePhoto(ctx, ctx.wizard.state.data.photoFileId);
    if (fileData) Object.assign(ctx.wizard.state.data, fileData);
    
    const requiredFields = ['name', 'city', 'ageRange', 'instructors', 'description'];
    for (const field of requiredFields) {
      if (!ctx.wizard.state.data[field]) {
        await ctx.reply(`❌ Ошибка: отсутствует поле ${field}`);
        await ctx.scene.leave();
        return;
      }
    }
    
    if (!Array.isArray(ctx.wizard.state.data.achievements)) {
      ctx.wizard.state.data.achievements = [];
    }
    
    await Teams.create(ctx.wizard.state.data);
    
    const recruitingStatus = ctx.wizard.state.data.isRecruiting ? "✅ Открыт для набора" : "❌ Набор закрыт";
    const achievementsText = ctx.wizard.state.data.achievements?.length > 0
      ? ctx.wizard.state.data.achievements.map(a => `• ${a}`).join("\n")
      : "Нет достижений";
    
    const caption = `✅ Команда создана!\n\n🏷 Название: ${ctx.wizard.state.data.name}\n🏙 Город: ${ctx.wizard.state.data.city}\n🎂 Возраст: ${ctx.wizard.state.data.ageRange}\n👨‍🏫 Преподаватели: ${ctx.wizard.state.data.instructors}\n🏆 Достижения:\n${achievementsText}\n📝 Описание: ${ctx.wizard.state.data.description}\n👥 ${recruitingStatus}`;
    
    if (ctx.wizard.state.data.photoFileId) {
      await ctx.replyWithPhoto(ctx.wizard.state.data.photoFileId, { caption, parse_mode: "HTML" });
    } else {
      await ctx.reply(caption, { parse_mode: "HTML" });
    }
  } catch (e) {
    console.error("Create team error:", e);
    await ctx.reply("❌ Ошибка при создании команды. Попробуй позже.");
  }
  
  await clearMessages(ctx);
  await ctx.scene.leave();
};

const addTeamScene = new Scenes.WizardScene(
  "add_team",
  
  async (ctx) => {
    ctx.wizard.state.data = {};
    ctx.wizard.state.sentMessages = {};
    const msg = await ctx.reply("📸 Пришли фото команды");
    ctx.wizard.state.sentMessages.start = msg.message_id;
    return ctx.wizard.next();
  },
  
  async (ctx) => {
    const handled = await handleCallbackAction(ctx, {
      next: async () => {
        if (!ctx.wizard.state.data.photoFileId) {
          const msg = await ctx.reply("Сначала отправь фото!");
          setTimeout(async () => {
            try { await ctx.deleteMessage(msg.message_id); } catch {}
          }, 1500);
          return;
        }
        await deleteOne(ctx);
        await showPreview(ctx, "название команды", { stepIndex: 1 });
        return ctx.wizard.next();
      },
      back: async () => {
        return ctx.wizard.back();
      }
    });
    
    if (handled) return;
    
    if (!ctx.message?.photo) {
      const msg = await ctx.reply("Пожалуйста, отправь фото!");
      setTimeout(async () => {
        try { await ctx.deleteMessage(msg.message_id); } catch {}
      }, 1500);
      return;
    } 
    
    const photo = ctx.message.photo.pop();
    ctx.wizard.state.data.photoFileId = photo.file_id;
    await deleteOne(ctx);
    await showPreview(ctx, "название команды", { stepIndex: 1 });
    return ctx.wizard.next();
  },
  
  createInputHandler("name", "город команды", 1, 0),
  createInputHandler("city", "возраст участников", 2, 1),
  createInputHandler("ageRange", "преподаватели и хореограф", 3, 2),
  createInputHandler("instructors", "достижения команды (через ;)", 4, 3),
  
  async (ctx) => {
    const handled = await handleCallbackAction(ctx, {
      next: async () => {
        if (!ctx.wizard.state.data.achievements) {
          const msg = await ctx.reply("Сначала укажи достижения команды!");
          setTimeout(async () => {
            try { await ctx.deleteMessage(msg.message_id); } catch {}
          }, 1500);
          return;
        }
        await deleteOne(ctx);
        await showPreview(ctx, "описание команды", { stepIndex: 6 });
        return ctx.wizard.next();
      },
      back: async () => {
        await deleteOne(ctx);
        await showPreview(ctx, "преподаватели и хореограф", { stepIndex: 4 });
        return ctx.wizard.back();
      }
    });
    
    if (handled) return;
    
    const valid = await validate(ctx, "Укажи достижения команды!", "text");
    if (!valid) return;
    
    ctx.wizard.state.data.achievements = ctx.message?.text
      ? ctx.message.text.split(";").map(a => a.trim()).filter(a => a)
      : [];
    await deleteOne(ctx);
    await showPreview(ctx, "описание команды", { stepIndex: 6 });
    return ctx.wizard.next();
  },
  
  createInputHandler("description", "набор в команду", 6, 5),
  
  async (ctx) => {
    const handled = await handleCallbackAction(ctx, {
      back: async () => {
        await deleteOne(ctx);
        await showPreview(ctx, "описание команды", { stepIndex: 6 });
        return ctx.wizard.back();
      },
      recruit_yes: async () => {
        ctx.wizard.state.data.isRecruiting = true;
        await saveAndFinish(ctx);
      },
      recruit_no: async () => {
        ctx.wizard.state.data.isRecruiting = false;
        await saveAndFinish(ctx);
      }
    });
    
    if (handled) return;
    
    if (ctx.message?.text) {
      const text = ctx.message.text.trim().toLowerCase();
      if (text === "да" || text === "yes" || text === "✅ да" || text === "да✅") {
        ctx.wizard.state.data.isRecruiting = true;
        await saveAndFinish(ctx);
        return;
      }
      if (text === "нет" || text === "no" || text === "❌ нет" || text === "нет❌") {
        ctx.wizard.state.data.isRecruiting = false;
        await saveAndFinish(ctx);
        return;
      }
    }
    
    await deleteOne(ctx);
    await showRecruitingStep(ctx);
    return;
  }
);

module.exports = addTeamScene;