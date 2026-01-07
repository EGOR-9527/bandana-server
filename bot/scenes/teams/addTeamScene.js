const { Scenes, Markup } = require("telegraf");
const Teams = require("../../../models/teams");
const {
  savePhoto,
  showPreview,
  validate,
  clearMessages,
  deleteOne,
} = require("../../helpers/telegram");

const trimCaption = (text) => (text ? (text.length > 4000 ? text.slice(0, 4000) + "…" : text) : "");

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
    return await ctx.replyWithPhoto(photoFileId, {
      caption: trimCaption(caption),
      ...options,
    });
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
      return result === false ? false : true;
    } catch (e) {
      console.error("Ошибка обработки callback:", e);
      return false;
    }
  }

  return false;
};

const safeDeleteAndShowPreview = async (ctx, stepName, stepIndex) => {
  try {
    await deleteOne(ctx);
  } catch (e) {
    console.error("Ошибка при удалении:", e.message);
  }

  try {
    await showPreview(ctx, stepName, { stepIndex });
    return true;
  } catch (e) {
    console.error("Ошибка при показе preview:", e.message);
    return false;
  }
};

const processTextInput = (ctx, fieldName) => {
  if (fieldName === "achievements") {
    ctx.wizard.state.data[fieldName] = ctx.message?.text
      ? ctx.message.text.split(";").map(a => a.trim()).filter(a => a)
      : [];
  } else {
    ctx.wizard.state.data[fieldName] = ctx.message?.text?.trim() || "";
  }
};

const getStepNames = () => [
  "фото команды",
  "название команды",
  "город команды",
  "возраст участников",
  "преподаватели и хореограф",
  "достижения команды (через ;)",
  "описание команды",
  "набор в команду",
];

const getNextStepName = (index) => getStepNames()[index + 1] || "завершение";
const getPrevStepName = (index) => getStepNames()[index - 1] || "фото команды";

const showRecruitingStep = async (ctx) => {
  const d = ctx.wizard.state.data || {};
  const text = `📋 Предпросмотр:\n\nШаг: набор в команду\n❓ Команда открыта для набора новых участников?`;

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback("✅ Да", "recruit_yes"), Markup.button.callback("❌ Нет", "recruit_no")],
    [Markup.button.callback("⬅️ Назад", "back"), Markup.button.callback("⛔ Отменить", "stop")],
  ]);

  // Удаляем предыдущее сообщение о наборе, если оно есть
  if (ctx.wizard.state.sentMessages?.recruit) {
    try { 
      await ctx.deleteMessage(ctx.wizard.state.sentMessages.recruit); 
    } catch (e) {
      console.error("Ошибка при удалении сообщения recruit:", e.message);
    }
  }

  let msg;
  if (d.photoFileId) {
    msg = await safeReplyWithPhoto(ctx, d.photoFileId, text, { 
      parse_mode: "HTML", 
      reply_markup: keyboard.reply_markup 
    });
  } else {
    msg = await safeReply(ctx, text, { 
      parse_mode: "HTML", 
      reply_markup: keyboard.reply_markup 
    });
  }

  if (msg) {
    ctx.wizard.state.sentMessages.recruit = msg.message_id;
  }
  return msg;
};

const saveAndFinish = async (ctx) => {
  try {
    // Удаляем сообщение с кнопками
    await deleteOne(ctx).catch(() => {});
    
    // Сохраняем фото
    const fileData = await savePhoto(ctx, ctx.wizard.state.data.photoFileId);
    if (fileData) Object.assign(ctx.wizard.state.data, fileData);

    // Проверяем обязательные поля
    const requiredFields = ["name", "city", "ageRange", "instructors", "description"];
    for (const field of requiredFields) {
      if (!ctx.wizard.state.data[field]) {
        await safeReply(ctx, `❌ Ошибка: отсутствует поле ${field}`);
        await ctx.scene.leave();
        return;
      }
    }

    // Убеждаемся, что achievements - массив
    if (!Array.isArray(ctx.wizard.state.data.achievements)) {
      ctx.wizard.state.data.achievements = [];
    }

    // Создаем команду в базе данных
    await Teams.create(ctx.wizard.state.data);

    // Формируем сообщение об успешном создании
    const recruitingStatus = ctx.wizard.state.data.isRecruiting ? "✅ Открыт для набора" : "❌ Набор закрыт";
    const achievementsText = ctx.wizard.state.data.achievements.length
      ? ctx.wizard.state.data.achievements.map(a => `• ${a}`).join("\n")
      : "Нет достижений";

    const caption = `✅ Команда создана!\n\n🏷 Название: ${ctx.wizard.state.data.name}\n🏙 Город: ${ctx.wizard.state.data.city}\n🎂 Возраст: ${ctx.wizard.state.data.ageRange}\n👨‍🏫 Преподаватели: ${ctx.wizard.state.data.instructors}\n🏆 Достижения:\n${achievementsText}\n📝 Описание: ${ctx.wizard.state.data.description}\n👥 ${recruitingStatus}`;

    // Отправляем финальное сообщение
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

const processRecruitingStep = async (ctx) => {
  // Если это callback query (нажатие на кнопку)
  if (ctx.callbackQuery) {
    const action = ctx.callbackQuery.data;
    
    // Отвечаем на callback query
    try {
      await ctx.answerCbQuery();
    } catch (e) {
      console.error("Ошибка answerCbQuery:", e.message);
    }

    // Обрабатываем действия
    if (action === "back") {
      await safeDeleteAndShowPreview(ctx, "описание команды", 6);
      return ctx.wizard.back();
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
    
    if (action === "stop") {
      await clearMessages(ctx);
      await ctx.scene.leave();
      return;
    }
    
    return;
  }

  // Если это текстовое сообщение (пользователь написал "да" или "нет")
  if (ctx.message?.text) {
    const text = ctx.message.text.trim().toLowerCase();
    
    if (["да", "yes", "да✅", "✅ да", "1", "открыт"].includes(text)) {
      ctx.wizard.state.data.isRecruiting = true;
      await saveAndFinish(ctx);
      return;
    }
    
    if (["нет", "no", "нет❌", "❌ нет", "0", "закрыт"].includes(text)) {
      ctx.wizard.state.data.isRecruiting = false;
      await saveAndFinish(ctx);
      return;
    }
    
    // Если введен неправильный текст, показываем кнопки снова
    const msg = await safeReply(ctx, "❌ Пожалуйста, используй кнопки ниже или напиши 'да' или 'нет'");
    if (msg) {
      setTimeout(async () => { 
        try { await ctx.deleteMessage(msg.message_id); } catch {} 
      }, 1500);
    }
    
    await showRecruitingStep(ctx);
    return;
  }

  // Если это что-то другое (например, фото или документ)
  if (ctx.message && !ctx.callbackQuery) {
    const msg = await safeReply(ctx, "❌ Пожалуйста, используй кнопки или напиши 'да' или 'нет'");
    if (msg) {
      setTimeout(async () => { 
        try { await ctx.deleteMessage(msg.message_id); } catch {} 
      }, 1500);
    }
    
    await showRecruitingStep(ctx);
    return;
  }

  // Если ничего из вышеперечисленного, просто показываем кнопки
  await showRecruitingStep(ctx);
};

const createInputHandler = (fieldName, stepIndex) => async (ctx) => {
  const validationResult = await validate(ctx, `Введи ${getNextStepName(stepIndex - 1).toLowerCase()}!`, "text");

  if (validationResult === "STOP") { 
    await clearMessages(ctx); 
    await ctx.scene.leave(); 
    return; 
  }
  
  if (validationResult === "BACK") { 
    await safeDeleteAndShowPreview(ctx, getPrevStepName(stepIndex), stepIndex - 1); 
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
    
    const nextStep = getNextStepName(stepIndex);
    if (await safeDeleteAndShowPreview(ctx, nextStep, stepIndex + 1)) {
      return ctx.wizard.next();
    }
    return;
  }
  
  if (validationResult === false) return;

  processTextInput(ctx, fieldName);
  const nextStep = getNextStepName(stepIndex);
  if (await safeDeleteAndShowPreview(ctx, nextStep, stepIndex + 1)) {
    return ctx.wizard.next();
  }
};

// Создаем сцену
const addTeamScene = new Scenes.WizardScene(
  "add_team",
  
  // Шаг 0: Начало сцены
  async (ctx) => { 
    ctx.wizard.state.data = {}; 
    ctx.wizard.state.sentMessages = {}; 
    const msg = await safeReply(ctx, "📸 Пришли фото команды"); 
    if (msg) ctx.wizard.state.sentMessages.start = msg.message_id; 
    return ctx.wizard.next(); 
  },
  
  // Шаг 1: Получение фото
  async (ctx) => {
    const validationResult = await validate(ctx, "Сначала отправь фото!", "photo");
    
    if (validationResult === "STOP") { 
      await clearMessages(ctx); 
      await ctx.scene.leave(); 
      return; 
    }
    
    if (validationResult === "BACK") return ctx.wizard.back();
    
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
      
      await safeDeleteAndShowPreview(ctx, "название команды", 1); 
      return ctx.wizard.next(); 
    }
    
    if (validationResult === true) {
      if (!ctx.message?.photo?.length) { 
        const msg = await safeReply(ctx, "❌ Пожалуйста, отправь фото!"); 
        if (msg) {
          setTimeout(async () => { 
            try { await ctx.deleteMessage(msg.message_id); } catch {} 
          }, 1500);
        } 
        return; 
      }
      
      ctx.wizard.state.data.photoFileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
      await safeDeleteAndShowPreview(ctx, "название команды", 1);
      return ctx.wizard.next();
    }
  },
  
  // Шаг 2: Название команды
  createInputHandler("name", 1),
  
  // Шаг 3: Город команды
  createInputHandler("city", 2),
  
  // Шаг 4: Возраст участников
  createInputHandler("ageRange", 3),
  
  // Шаг 5: Преподаватели и хореограф
  createInputHandler("instructors", 4),
  
  // Шаг 6: Достижения команды
  async (ctx) => {
    const validationResult = await validate(ctx, "Укажи достижения команды!", "text");
    
    if (validationResult === "STOP") { 
      await clearMessages(ctx); 
      await ctx.scene.leave(); 
      return; 
    }
    
    if (validationResult === "BACK") { 
      await safeDeleteAndShowPreview(ctx, "преподаватели и хореограф", 4); 
      return ctx.wizard.back(); 
    }
    
    if (validationResult === "NEXT") { 
      if (!ctx.wizard.state.data.achievements || ctx.wizard.state.data.achievements.length === 0) { 
        const msg = await safeReply(ctx, "Сначала укажи достижения команды!"); 
        if (msg) {
          setTimeout(async () => { 
            try { await ctx.deleteMessage(msg.message_id); } catch {} 
          }, 1500);
        } 
        return; 
      } 
      
      await safeDeleteAndShowPreview(ctx, "описание команды", 6); 
      return ctx.wizard.next(); 
    }
    
    if (validationResult === true) { 
      processTextInput(ctx, "achievements"); 
      await safeDeleteAndShowPreview(ctx, "описание команды", 6); 
      return ctx.wizard.next(); 
    }
  },
  
  // Шаг 7: Описание команды
  createInputHandler("description", 6),
  
  // Шаг 8: Набор в команду - показываем кнопки
  async (ctx) => { 
    await showRecruitingStep(ctx);
    return ctx.wizard.next();
  },
  
  // Шаг 9: Обработка ответа о наборе
  async (ctx) => {
    await processRecruitingStep(ctx);
  }
);

// Регистрируем обработчики действий для сцены
addTeamScene.action("recruit_yes", async (ctx) => {
  await processRecruitingStep(ctx);
});

addTeamScene.action("recruit_no", async (ctx) => {
  await processRecruitingStep(ctx);
});

addTeamScene.action("back", async (ctx) => {
  await processRecruitingStep(ctx);
});

addTeamScene.action("stop", async (ctx) => {
  await processRecruitingStep(ctx);
});

// Обработчик для всех остальных действий (на всякий случай)
addTeamScene.action(/.*/, async (ctx) => {
  const step = ctx.scene.state.wizard?.cursor || 0;
  console.log("Необработанное действие:", ctx.callbackQuery.data, "на шаге:", step);
  
  // Если мы на шагах 8 или 9 (набор в команду), обрабатываем
  if (step === 8 || step === 9) {
    await processRecruitingStep(ctx);
  }
  
  // Отвечаем на callback query
  try {
    await ctx.answerCbQuery();
  } catch (e) {
    console.error("Ошибка answerCbQuery:", e.message);
  }
});

module.exports = addTeamScene;