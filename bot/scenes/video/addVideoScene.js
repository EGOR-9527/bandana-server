// bot/scenes/addVideoScene.js
const { Scenes, Markup } = require("telegraf");
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const Video = require("../../../models/video");
const { clearMessages } = require("../../helpers/telegram");
const { getYandexDirectLink } = require("../../helpers/telegram");

const uploadDir = path.join(__dirname, "../../../uploads");

// -------------------------------
// Скачивание видео по прямой ссылке
// -------------------------------
async function saveVideoFromUrl(url) {
  try {
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

    const fileName = Date.now() + ".mp4";
    const filePath = path.join(uploadDir, fileName);
    const writer = fs.createWriteStream(filePath);

    const response = await axios({
      url,
      method: "GET",
      responseType: "stream",
    });

    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
      writer.on("finish", () => resolve({ fileName, filePath }));
      writer.on("error", reject);
    });
  } catch (err) {
    console.error("Ошибка при скачивании видео:", err);
    return null;
  }
}

// -------------------------------
// Сцена добавления видео
// -------------------------------
const addVideoScene = new Scenes.WizardScene(
  "add_video",

  // -------------------------------
  // Шаг 0 — запрос публичной ссылки Яндекс.Диска
  // -------------------------------
  async (ctx) => {
    ctx.wizard.state.data = {};
    ctx.wizard.state.sentMessages = [];

    const msg = await ctx.reply(
      "🎬 Пришли публичную ссылку на видео с Яндекс.Диска:"
    );
    ctx.wizard.state.sentMessages.push(msg.message_id);

    return ctx.wizard.next();
  },

  // -------------------------------
  // Шаг 1 — сохраняем ссылку и просим название
  // -------------------------------
  async (ctx) => {
    const publicUrl = ctx.message?.text?.trim();
    if (!publicUrl) {
      const msg = await ctx.reply("❌ Отправь корректную ссылку:");
      ctx.wizard.state.sentMessages.push(msg.message_id);
      return;
    }

    // Сохраняем ссылку в состоянии, но **не скачиваем видео сразу**
    ctx.wizard.state.data.publicUrl = publicUrl;

    const nameMsg = await ctx.reply("📝 Введи название видео:");
    ctx.wizard.state.sentMessages.push(nameMsg.message_id);

    return ctx.wizard.next();
  },

  // -------------------------------
  // Шаг 2 — скачиваем видео и сохраняем запись после того, как пользователь ввёл название
  // -------------------------------
  async (ctx) => {
    const name = ctx.message?.text?.trim();
    if (!name) {
      const msg = await ctx.reply(
        "❌ Название не может быть пустым. Попробуй ещё раз:"
      );
      ctx.wizard.state.sentMessages.push(msg.message_id);
      return;
    }

    ctx.wizard.state.data.name = name;

    try {
      // Получаем прямой URL через API Яндекс.Диска
      const directUrl = await getYandexDirectLink(
        ctx.wizard.state.data.publicUrl
      );
      if (!directUrl) throw new Error("Не удалось получить прямую ссылку");

      // Скачиваем видео на сервер
      const saved = await saveVideoFromUrl(directUrl);
      if (!saved) throw new Error("Не удалось скачать видео");

      ctx.wizard.state.data.fileName = saved.fileName;
      ctx.wizard.state.data.filePath = saved.filePath;

      // Создаём запись в базе
      await Video.create({
        fileName: ctx.wizard.state.data.fileName,
        fileUrl: ctx.wizard.state.data.filePath,
        name: ctx.wizard.state.data.name,
      });

      const msg = await ctx.reply("✅ Видео успешно добавлено!", {
        reply_markup: Markup.inlineKeyboard([
          [Markup.button.callback("⛔ Завершить", "stop")],
        ]),
      });
      ctx.wizard.state.sentMessages.push(msg.message_id);
    } catch (err) {
      console.error("Ошибка при добавлении видео:", err);
      const msg = await ctx.reply(
        "❌ Ошибка при добавлении видео. Проверь ссылку и попробуй снова."
      );
      ctx.wizard.state.sentMessages.push(msg.message_id);
    }

    setTimeout(async () => {
      await clearMessages(ctx);
    }, 2000);
    return ctx.scene.leave();
  }
);

module.exports = addVideoScene;
