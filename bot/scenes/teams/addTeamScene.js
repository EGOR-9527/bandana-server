const { Scenes, Markup } = require("telegraf");
const Teams = require("../../../models/teams");
const {
  savePhoto,
  showPreview,
  validate,
  clearMessages,
  deleteOne,
} = require("../../helpers/telegram");

const trimCaption = (text) => {
  if (!text) return text;
  return text.length > 4000 ? text.slice(0, 4000) + "…" : text;
};

const safeReply = async (ctx, text, options = {}) => {
  try {
    return await ctx.reply(text, options);
  } catch (e) {
    console.error("Ошибка Telegram:", e.message);
    return null;
  }
};

const safeReplyWithPhoto = async (ctx, photoFileId, caption, options = {}) => {
  try {
    return await ctx.replyWithPhoto(photoFileId, { caption: trimCaption(caption), ...options });
  } catch (e) {
    console.error("Ошибка Telegram (photo):", e.message);
    return null;
  }
};

const handleCallbackAction = async (ctx, actions) => {
  if (!ctx.callbackQuery) return null;
  
  const action = ctx.callbackQuery.data;
  
  if (action === "stop") {
    await clearMessages(ctx);
    await ctx.scene.leave();
    return true;
  }
  
  if (actions[action]) {
    try {
      const result = await actions[action]();
      return result !== false;
    } catch (e) {
      console.error("Ошибка обработки callback:", e);
      return true;
    }
  }
  
  return false;
};

const showRecruitingStep = async (ctx) => {
  const d = ctx.wizard.state.data || {};
  const text = `📋 Предпросмотр:\n\nШаг: набор в команду\n❓ Команда открыта для набора новых участников?`;
  
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback("✅ Да", "recruit_yes"), Markup.button.callback("❌ Нет", "recruit_no")],
    [Markup.button.callback("⬅️ Назад", "back"), Markup.button.callback("⛔ Отменить", "stop")]
  ]);
  
  if (ctx.wizard.state.sentMessages?.recruit) {
    try {
      await ctx.deleteMessage(ctx.wizard.state.sentMessages.recruit);
    } catch {}
  }
  
  let msg = null;
  if (d.photoFileId) {
    msg = await safeReplyWithPhoto(ctx, d.photoFileId, text, { parse_mode: "HTML", ...keyboard });
  } else {
    msg = await safeReply(ctx, text, { parse_mode: "HTML", ...keyboard });
  }
  
  if (msg) {
    ctx.wizard.state.sentMessages.recruit = msg.message_id;
  }
};

const getNextStepName = (currentIndex) => {
  const steps = [
    "фото команды",
    "название команды", 
    "город команды",
    "возраст участников",
    "преподаватели и хореограф",
    "достижения команды (через ;)",
    "описание команды",
    "набор в команду"
  ];
  return steps[currentIndex + 1] || "завершение";
};

const getPrevStepName = (currentIndex) => {
  const steps = [
    "фото команды",
    "название команды",
    "город команды",
    "возраст участников",
    "преподаватели и хореограф",
    "достижения команды (через ;)",
    "описание команды"
  ];
  return steps[currentIndex - 1] || "фото команды";
};

const processTextInput = (ctx, fieldName, stepIndex) => {
  if (fieldName === 'achievements') {
    ctx.wizard.state.data[fieldName] = ctx.message?.text
      ? ctx.message.text.split(";").map(a => a.trim()).filter(a => a)
      : [];
  } else {
    ctx.wizard.state.data[fieldName] = ctx.message?.text?.trim() || "";
  }
  
  return ctx.wizard.next();
};

const saveAndFinish = async (ctx) => {
  try {
    await deleteOne(ctx);
    
    const fileData = await savePhoto(ctx, ctx.wizard.state.data.photoFileId);
    if (fileData) {
      Object.assign(ctx.wizard.state.data, fileData);
    }
    
    const requiredFields = ['name', 'city', 'ageRange', 'instructors', 'description'];
    for (const field of requiredFields) {
      if (!ctx.wizard.state.data[field]) {
        await safeReply(ctx, `❌ Ошибка: отсутствует поле ${field}`);
        await ctx.scene.leave();
        return;
      }
    }
    
    if (!Array.isArray(ctx.wizard.state.data.achievements)) {
      ctx.wizard.state.data.achievements = [];
    }
    
    await Teams.create(ctx.wizard.state.data);
    
    const recruitingStatus = ctx.wizard.state.data.isRecruiting ? "✅ Открыт для набора" : "❌ Набор закрыт";
    const achievementsText = Array.isArray(ctx.wizard.state.data.achievements) && ctx.wizard.state.data.achievements.length > 0
      ? ctx.wizard.state.data.achievements.map(a => `• ${a}`).join("\n")
      : "Нет достижений";
    
    const caption = `✅ Команда создана!\n\n🏷 Название: ${ctx.wizard.state.data.name}\n🏙 Город: ${ctx.wizard.state.data.city}\n🎂 Возраст: ${ctx.wizard.state.data.ageRange}\n👨‍🏫 Преподаватели: ${ctx.wizard.state.data.instructors}\n🏆 Достижения:\n${achievementsText}\n📝 Описание: ${ctx.wizard.state.data.description}\n👥 ${recruitingStatus}`;
    
    if (ctx.wizard.state.data.photoFileId) {
      await safeReplyWithPhoto(ctx, ctx.wizard.state.data.photoFileId, caption, { parse_mode: "HTML" });
    } else {
      await safeReply(ctx, caption, { parse_mode: "HTML" });
    }
  } catch (e) {
    console.error("Create team error:", e);
    await safeReply(ctx, "❌ Ошибка при создании команды. Попробуй позже.");
  }
  
  await clearMessages(ctx);
  await ctx.scene.leave();
};

const createInputHandler = (fieldName, stepIndex) => {
  return async (ctx) => {
    const validationResult = await validate(ctx, `Введи ${getNextStepName(stepIndex - 1).toLowerCase()}!`, "text");
    
    if (validationResult === "STOP") {
      await clearMessages(ctx);
      await ctx.scene.leave();
      return;
    }
    
    if (validationResult === "BACK") {
      await deleteOne(ctx);
      await showPreview(ctx, getPrevStepName(stepIndex), { stepIndex: stepIndex - 1 });
      return ctx.wizard.back();
    }
    
    if (validationResult === "NEXT") {
      if (!ctx.wizard.state.data[fieldName]) {
        const msg = await safeReply(ctx, `Сначала введи ${getNextStepName(stepIndex - 1).toLowerCase()}!`);
        if (msg) {
          setTimeout(async () => {
            try { await ctx.deleteMessage(msg.message_id); } catch {}
          }, 1500);
        }
        return;
      }
      await deleteOne(ctx);
      await showPreview(ctx, getNextStepName(stepIndex), { stepIndex: stepIndex + 1 });
      return ctx.wizard.next();
    }
    
    if (validationResult === false) return;
    
    if (validationResult === true) {
      processTextInput(ctx, fieldName, stepIndex);
      await deleteOne(ctx);
      await showPreview(ctx, getNextStepName(stepIndex), { stepIndex: stepIndex + 1 });
      return ctx.wizard.next();
    }
  };
};

const addTeamScene = new Scenes.WizardScene(
  "add_team",
  
  async (ctx) => {
    ctx.wizard.state.data = {};
    ctx.wizard.state.sentMessages = {};
    const msg = await safeReply(ctx, "📸 Пришли фото команды");
    if (msg) ctx.wizard.state.sentMessages.start = msg.message_id;
    return ctx.wizard.next();
  },
  
  async (ctx) => {
    const validationResult = await validate(ctx, "Сначала отправь фото!", "photo");
    
    if (validationResult === "STOP") {
      await clearMessages(ctx);
      await ctx.scene.leave();
      return;
    }
    
    if (validationResult === "BACK") {
      return ctx.wizard.back();
    }
    
    if (validationResult === "NEXT") {
      if (!ctx.wizard.state.data.photoFileId) {
        const msg = await safeReply(ctx, "Сначала отправь фото!");
        if (msg) {
          setTimeout(async () => {
            try { await ctx.deleteMessage(msg.message_id); } catch {}
          }, 1500);
        }
        return;
      }
      await deleteOne(ctx);
      await showPreview(ctx, "название команды", { stepIndex: 1 });
      return ctx.wizard.next();
    }
    
    if (validationResult === false) return;
    
    if (validationResult === true) {
      const photo = ctx.message.photo.pop();
      ctx.wizard.state.data.photoFileId = photo.file_id;
      await deleteOne(ctx);
      await showPreview(ctx, "название команды", { stepIndex: 1 });
      return ctx.wizard.next();
    }
  },
  
  createInputHandler("name", 1),
  createInputHandler("city", 2),
  createInputHandler("ageRange", 3),
  createInputHandler("instructors", 4),
  
  async (ctx) => {
    const validationResult = await validate(ctx, "Укажи достижения команды!", "text");
    
    if (validationResult === "STOP") {
      await clearMessages(ctx);
      await ctx.scene.leave();
      return;
    }
    
    if (validationResult === "BACK") {
      await deleteOne(ctx);
      await showPreview(ctx, "преподаватели и хореограф", { stepIndex: 4 });
      return ctx.wizard.back();
    }
    
    if (validationResult === "NEXT") {
      if (!ctx.wizard.state.data.achievements) {
        const msg = await safeReply(ctx, "Сначала укажи достижения команды!");
        if (msg) {
          setTimeout(async () => {
            try { await ctx.deleteMessage(msg.message_id); } catch {}
          }, 1500);
        }
        return;
      }
      await deleteOne(ctx);
      await showPreview(ctx, "описание команды", { stepIndex: 6 });
      return ctx.wizard.next();
    }
    
    if (validationResult === false) return;
    
    if (validationResult === true) {
      processTextInput(ctx, 'achievements', 5);
      await deleteOne(ctx);
      await showPreview(ctx, "описание команды", { stepIndex: 6 });
      return ctx.wizard.next();
    }
  },
  
  createInputHandler("description", 6),
  
  async (ctx) => {
    const validationResult = await validate(ctx, "Выбери вариант или напиши 'да'/'нет'!", "text");
    
    if (validationResult === "STOP") {
      await clearMessages(ctx);
      await ctx.scene.leave();
      return;
    }
    
    if (validationResult === "BACK") {
      await deleteOne(ctx);
      await showPreview(ctx, "описание команды", { stepIndex: 6 });
      return ctx.wizard.back();
    }
    
    if (validationResult === "NEXT") {
      const msg = await safeReply(ctx, "Выбери вариант или напиши 'да'/'нет'!");
      if (msg) {
        setTimeout(async () => {
          try { await ctx.deleteMessage(msg.message_id); } catch {}
        }, 1500);
      }
      return;
    }
    
    if (validationResult === false) return;
    
    if (validationResult === true) {
      const text = ctx.message?.text?.trim().toLowerCase();
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
      
      if (!handled) {
        await deleteOne(ctx);
        await showRecruitingStep(ctx);
      }
      return;
    }
  }
);

module.exports = addTeamScene;