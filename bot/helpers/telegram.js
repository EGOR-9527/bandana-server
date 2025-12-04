// bot/helpers/telegram.js
const { Markup } = require("telegraf");
const fs = require("fs");
const path = require("path");
const fetch = require("node-fetch");
const axios = require("axios");

// -------------------------------
// Папка для загрузок
// -------------------------------
const UPLOADS_DIR = path.join(__dirname, "../../uploads");
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// =======================
//   Сохраняем фото
// =======================
async function savePhoto(ctx, fileId) {
  const fileLink = await ctx.telegram.getFileLink(fileId);

  const fileName = `${Date.now()}.jpg`;
  const filePath = path.join(UPLOADS_DIR, fileName);

  const res = await fetch(fileLink.href); // node >= 18
  const buffer = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(filePath, buffer);

  return {
    fileName,
    fileUrl: filePath,
  };
}

// =======================
//   Сохраняем видео по ссылке (например, Яндекс.Диск)
// =======================
async function saveVideoFromUrl(url) {
  try {
    const fileName = `${Date.now()}.mp4`;
    const filePath = path.join(UPLOADS_DIR, fileName);
    const writer = fs.createWriteStream(filePath);

    const response = await axios({
      url,
      method: "GET",
      responseType: "stream",
    });
    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
      writer.on("finish", () => resolve({ fileName, filePath }));
      writer.on("error", (err) => reject(err));
    });
  } catch (err) {
    console.error("Ошибка при скачивании видео:", err);
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
  } catch {}
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
  } catch {}
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

// -------------------------------
// Получение прямого URL Яндекс.Диска
// -------------------------------
async function getYandexDirectLink(publicKey) {
  try {
    const apiUrl = `https://cloud-api.yandex.net/v1/disk/public/resources/download?public_key=${encodeURIComponent(
      publicKey
    )}`;
    const res = await axios.get(apiUrl);
    return res.data.href; // прямой URL для скачивания
  } catch (err) {
    console.error("Ошибка получения прямой ссылки Яндекс.Диска:", err);
    return null;
  }
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
  if (type === "photo" && (!ctx.message?.photo || ctx.message.photo.length === 0)) {
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
  saveVideoFromUrl,
  deleteOne,
  getYandexDirectLink,
  clearMessages,
  showPreview,
  validate,
};
