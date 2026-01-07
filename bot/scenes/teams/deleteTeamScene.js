const { Scenes, Markup } = require("telegraf");
const Teams = require("../../../models/teams");
const {
  savePhoto,
  showPreview,
  validate,
  clearMessages,
  deleteOne,
} = require("../../helpers/telegram");

// Функция для обрезки текста при показе итога
const trimForDisplay = (text, maxLength = 1000) => {
  if (!text) return "";
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + "…";
};

// Функция для обрезки подписи в Telegram
const trimCaption = (text) => (text ? (text.length > 1024 ? text.slice(0, 1024) + "…" : text) : "");

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
    // Сохраняем полный текст без ограничений
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

    // Создаем команду в базе данных (сохраняем полные данные)
    await Teams.create(ctx.wizard.state.data);

    // Формируем сообщение об успешном создании с обрезкой для отображения
    const recruitingStatus = ctx.wizard.state.data.isRecruiting ? "✅ Открыт для набора" : "❌ Набор закрыт";
    
    // Обрабатываем достижения - обрезаем каждое достижение если нужно
    let achievementsText;
    const originalAchievements = ctx.wizard.state.data.achievements || [];
    if (originalAchievements.length) {
      const trimmedAchievements = originalAchievements.map(a => 
        `• ${trimForDisplay(a, 200)}`
      );
      achievementsText = trimmedAchievements.join("\n");
      // Если общий текст достижений слишком длинный, обрезаем список
      if (achievementsText.length > 1500) {
        achievementsText = trimmedAchievements.slice(0, 5).join("\n");
        achievementsText += `\n… и ещё ${originalAchievements.length - 5} достижений`;
      }
    } else {
      achievementsText = "Нет достижений";
    }

    // Формируем финальное сообщение с обрезкой длинных полей
    const caption = `✅ Команда создана!\n\n` +
      `🏷 Название: ${trimForDisplay(ctx.wizard.state.data.name, 100)}\n` +
      `🏙 Город: ${trimForDisplay(ctx.wizard.state.data.city, 100)}\n` +
      `🎂 Возраст: ${trimForDisplay(ctx.wizard.state.data.ageRange, 100)}\n` +
      `👨‍🏫 Преподаватели: ${trimForDisplay(ctx.wizard.state.data.instructors, 300)}\n` +
      `🏆 Достижения:\n${achievementsText}\n` +
      `📝 Описание: ${trimForDisplay(ctx.wizard.state.data.description, 500)}\n` +
      `👥 ${recruitingStatus}`;

    // Отправляем финальное сообщение
    if (ctx.wizard.state.data.photoFileId) {
      await safeReplyWithPhoto(ctx, ctx.wizard.state.data.photoFileId, caption, { parse_mode: "HTML" });
    } else {
      await safeReply(ctx, caption, { parse_mode: "HTML" });
    }
    
    // Отправляем дополнительное сообщение, если данные были обрезаны
    const originalDescriptionLength = ctx.wizard.state.data.description.length;
    const originalInstructorsLength = ctx.wizard.state.data.instructors.length;
    const originalAchievementsCount = originalAchievements.length;
    
    const warnings = [];
    if (originalDescriptionLength > 500) {
      warnings.push(`📝 Описание было сокращено с ${originalDescriptionLength} до 500 символов`);
    }
    if (originalInstructorsLength > 300) {
      warnings.push(`👨‍🏫 Список преподавателей был сокращён с ${originalInstructorsLength} до 300 символов`);
    }
    if (originalAchievementsCount > 5) {
      warnings.push(`🏆 Показаны первые 5 из ${originalAchievementsCount} достижений`);
    }
    
    if (warnings.length > 0) {
      const warningText = `ℹ️ <b>Примечание:</b>\n${warnings.join('\n')}\n\nПолная информация сохранена в базе данных.`;
      await safeReply(ctx, warningText, { parse_mode: "HTML" });
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
    const msg = await safeReply(ctx, "📸 Пришли фото команды\n\n<em>Примечание: все текстовые поля сохраняются полностью, но в итоговом сообщении могут быть сокращены для лучшего отображения.</em>", { 
      parse_mode: "HTML" 
    }); 
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
    const validationResult = await validate(ctx, "Укажи достижения команды (через точку с запятой)!", "text");
    
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
      await safeDeleteAndShowPreview(ctx, "описание команды", 6); // Исправлено: было "описание команда"
      return ctx.wizard.next(); 
    }
  },
  
  // Шаг 7: Описание команды
  async (ctx) => {
    const validationResult = await validate(ctx, "Введи описание команды!", "text");
    
    if (validationResult === "STOP") { 
      await clearMessages(ctx); 
      await ctx.scene.leave(); 
      return; 
    }
    
    if (validationResult === "BACK") { 
      await safeDeleteAndShowPreview(ctx, "достижения команды (через ;)", 5); 
      return ctx.wizard.back(); 
    }
    
    if (validationResult === "NEXT") { 
      if (!ctx.wizard.state.data.description) { 
        const msg = await safeReply(ctx, "Сначала введи описание команды!"); 
        if (msg) {
          setTimeout(async () => { 
            try { await ctx.deleteMessage(msg.message_id); } catch {} 
          }, 1500);
        } 
        return; 
      } 
      
      // Показываем кнопки набора
      await showRecruitingStep(ctx);
      return ctx.wizard.next(); 
    }
    
    if (validationResult === true) { 
      processTextInput(ctx, "description"); 
      await showRecruitingStep(ctx);
      return ctx.wizard.next(); 
    }
  },
  
  // Шаг 8: Обработка ответа о наборе
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
  // Отвечаем на callback query
  try {
    await ctx.answerCbQuery();
  } catch (e) {
    console.error("Ошибка answerCbQuery:", e.message);
  }
  
  const step = ctx.scene.state.wizard?.cursor || 0;
  console.log("Необработанное действие:", ctx.callbackQuery.data, "на шаге:", step);
  
  // Если мы на шагах 8 (набор в команду), обрабатываем
  if (step === 8) {
    await processRecruitingStep(ctx);
  }
});

module.exports = addTeamScene;