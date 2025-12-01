// bot/helpers/telegram.js
const { Markup } = require("telegraf");
const fs = require("fs");
const path = require("path");
const fetch = require("node-fetch"); // если ещё не установлен, npm i node-fetch@2

// =======================
//   Сохраняем фото
// =======================
async function savePhoto(ctx, fileId) {
  const fileLink = await ctx.telegram.getFileLink(fileId);

  const uploadsDir = path.join(__dirname, "../../uploads"); // путь к uploads
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

  const fileName = `${Date.now()}.jpg`;
  const filePath = path.join(uploadsDir, fileName);

  const res = await fetch(fileLink.href); // node >= 18
  const buffer = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(filePath, buffer);

  return {
    fileName,
    fileUrl: filePath,
  };
}

// =======================
//   Сохраняем видео
// =======================
async function saveVideo(ctx, videoFileId) {
  try {
    const fileLink = await ctx.telegram.getFileLink(videoFileId);
    const response = await fetch(fileLink.href);
    const buffer = await response.arrayBuffer();

    const fileName = `${Date.now()}.mp4`;
    const dir = path.resolve("uploads");
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const filePath = path.join(dir, fileName);
    fs.writeFileSync(filePath, Buffer.from(buffer));

    return { fileName, fileUrl: `../../uploads/${fileName}` };
  } catch (err) {
    console.error("saveVideo error:", err);
    return null;
  }
}

// =======================
//   Удаляем одно сообщение
// =======================
async function deleteOne(ctx, id) {
  try {
    if (id) {
      await ctx.deleteMessage(id);
      return;
    }
    if (!ctx.wizard?.state?.sentMessages?.length) return;
    const mid = ctx.wizard.state.sentMessages.shift();
    if (mid) await ctx.deleteMessage(mid);
  } catch (err) {}
}

// =======================
//   Очищаем все сообщения сцены
// =======================
async function clearMessages(ctx) {
  try {
    if (ctx.wizard.state.sentMessages?.length) {
      for (const id of ctx.wizard.state.sentMessages) {
        try {
          await ctx.deleteMessage(id);
        } catch {}
      }
    }
  } catch (err) {}
  ctx.wizard.state.sentMessages = [];
  ctx.wizard.state.data = {};
}

// =======================
//   Предпросмотр данных (фото или видео)
// =======================
async function showPreview(ctx, stepName, stepIndex = 0) {
  const d = ctx.wizard.state.data || {};
  let text = `📋 Предпросмотр:\n\n`;
  if (d.name) text += `🎬 Название: ${d.name}\n`;
  if (d.description) text += `📝 ${d.description}\n`;
  if (d.date) text += `📅 ${d.date}\n`;
  if (d.place) text += `📍 ${d.place}\n`;
  text += `\nШаг: ${stepName}\nОтправь новое значение или используй кнопки:`;

  const keyboard = Markup.inlineKeyboard([
    [
      Markup.button.callback("⬅️", "back"),
      Markup.button.callback("⛔", "stop"),
      Markup.button.callback("➡️", "next"),
    ],
  ]);

  if (!ctx.wizard.state.sentMessages) ctx.wizard.state.sentMessages = [];

  // удаляем старый preview, если есть
  if (ctx.wizard.state.sentMessages[stepIndex]) {
    try {
      await ctx.deleteMessage(ctx.wizard.state.sentMessages[stepIndex]);
    } catch {}
  }

  let msg;
  if (d.videoFileId) {
    msg = await ctx.replyWithVideo(d.videoFileId, {
      caption: text,
      ...keyboard,
    });
  } else if (d.photoFileId) {
    msg = await ctx.replyWithPhoto(d.photoFileId, {
      caption: text,
      ...keyboard,
    });
  } else {
    msg = await ctx.reply(text, keyboard);
  }

  ctx.wizard.state.sentMessages[stepIndex] = msg.message_id;
  return msg;
}

// =======================
//   Валидация ввода
// =======================
async function validate(ctx, errorMessage, type) {
  // Обработка callbackQuery
  if (ctx.callbackQuery) {
    const a = ctx.callbackQuery.data;
    try {
      await ctx.answerCbQuery();
    } catch {}
    if (a === "back") return "BACK";
    if (a === "next") return "NEXT";
    if (a === "stop") return "STOP";
  }

  // Текстовые команды
  if (ctx.message?.text === "/back") return "BACK";
  if (ctx.message?.text === "/next") return "NEXT";
  if (ctx.message?.text === "/stop") return "STOP";

  // Проверка типа "photo"
  if (
    type === "photo" &&
    (!ctx.message?.photo || ctx.message.photo.length === 0)
  ) {
    const msg = await ctx.reply(errorMessage);
    ctx.wizard.state.sentMessages.push(msg.message_id);
    return false;
  }

  // Проверка типа "video"
  if (type === "video" && !ctx.message?.video) {
    const msg = await ctx.reply(errorMessage);
    ctx.wizard.state.sentMessages.push(msg.message_id);
    return false;
  }

  // Проверка других типов (text)
  if (type && type !== "photo" && type !== "video" && !ctx.message?.[type]) {
    const msg = await ctx.reply(errorMessage);
    ctx.wizard.state.sentMessages.push(msg.message_id);
    return false;
  }

  // Удаляем сообщение пользователя
  try {
    await deleteOne(ctx);
  } catch {}

  return true;
}

module.exports = {
  savePhoto,
  saveVideo,
  deleteOne,
  clearMessages,
  showPreview,
  validate,
};
