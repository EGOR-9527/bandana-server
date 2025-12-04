// bot/scenes/updateVideoScene.js
const { Scenes, Markup } = require("telegraf");
const Video = require("../../../models/video");
const fs = require("fs");
const path = require("path");
const { getYandexDirectLink, saveVideoFromUrl, clearMessages } = require("../../helpers/telegram");

const UPLOADS_DIR = path.join(__dirname, "../../../uploads");
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// -------------------------------
// Сцена обновления видео
// -------------------------------
const updateVideoScene = new Scenes.WizardScene(
  "update_video",

  // -------------------------------
  // Шаг 0 — выбор видео
  // -------------------------------
  async (ctx) => {
    ctx.wizard.state.sentMessages = [];
    ctx.wizard.state.videos = await Video.findAll({ order: [["id", "ASC"]] });

    if (!ctx.wizard.state.videos.length) {
      await ctx.reply("Видео пока нет");
      return ctx.scene.leave();
    }

    ctx.wizard.state.currentIndex = 0;
    await showVideoSlide(ctx);
    return ctx.wizard.next();
  },

  // -------------------------------
  // Шаг 1 — выбор поля для редактирования
  // -------------------------------
  async (ctx) => {
    if (!ctx.callbackQuery) return;

    const data = ctx.callbackQuery.data;
    const videos = ctx.wizard.state.videos;
    let idx = ctx.wizard.state.currentIndex;

    await ctx.answerCbQuery();

    if (data === "back") idx = idx > 0 ? idx - 1 : videos.length - 1;
    if (data === "next") idx = idx < videos.length - 1 ? idx + 1 : 0;
    ctx.wizard.state.currentIndex = idx;

    if (data === "back" || data === "next") {
      await clearCurrentMessage(ctx);
      await showVideoSlide(ctx);
      return;
    }

    if (data === "edit") {
      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback("Видео", "field_video")],
        [Markup.button.callback("Название", "field_name")],
        [Markup.button.callback("Назад к просмотру", "back_to_slider")],
      ]);
      await ctx.editMessageReplyMarkup(keyboard.reply_markup);
      return;
    }

    if (data === "back_to_slider") {
      await showVideoSlide(ctx);
      return;
    }

    if (data.startsWith("field_")) {
      ctx.wizard.state.fieldToEdit = data.replace("field_", "");
      ctx.session.editVideoId = videos[idx].id;

      const prompt =
        ctx.wizard.state.fieldToEdit === "video"
          ? "Пришли ссылку на новое видео с Яндекс.Диска"
          : "Напиши новое название видео";

      const msg = await ctx.reply(prompt);
      ctx.wizard.state.sentMessages.push(msg.message_id);
      return ctx.wizard.next();
    }
  },

  // -------------------------------
  // Шаг 2 — получение нового значения
  // -------------------------------
  async (ctx) => {
    const field = ctx.wizard.state.fieldToEdit;
    const videoId = ctx.session.editVideoId;
    if (!field || !videoId) return ctx.scene.leave();

    const video = await Video.findByPk(videoId);
    if (!video) return ctx.scene.leave();

    let newData = {};

    try {
      if (field === "video") {
        const publicUrl = ctx.message?.text?.trim();
        if (!publicUrl) {
          const msg = await ctx.reply("❌ Отправь корректную ссылку на видео");
          ctx.wizard.state.sentMessages.push(msg.message_id);
          return;
        }

        const directUrl = await getYandexDirectLink(publicUrl);
        if (!directUrl) {
          const msg = await ctx.reply("❌ Не удалось получить прямую ссылку");
          ctx.wizard.state.sentMessages.push(msg.message_id);
          return;
        }

        const saved = await saveVideoFromUrl(directUrl);
        if (!saved) {
          const msg = await ctx.reply("❌ Не удалось скачать видео");
          ctx.wizard.state.sentMessages.push(msg.message_id);
          return;
        }

        // Удаляем старый файл
        if (video.fileName) {
          const oldPath = path.join(UPLOADS_DIR, video.fileName);
          if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
        }

        newData = { fileName: saved.fileName, fileUrl: saved.filePath };
        await ctx.reply("✅ Видео обновлено");
      } else if (field === "name") {
        const name = ctx.message?.text?.trim();
        if (!name) {
          const msg = await ctx.reply("❌ Название не может быть пустым");
          ctx.wizard.state.sentMessages.push(msg.message_id);
          return;
        }
        newData = { name };
        await ctx.reply("✅ Название обновлено");
      }

      await Video.update(newData, { where: { id: videoId } });

      const updated = await Video.findByPk(videoId);
      if (updated) {
        const i = ctx.wizard.state.videos.findIndex((v) => v.id === videoId);
        if (i !== -1) ctx.wizard.state.videos[i] = updated;
      }
    } catch (err) {
      console.error("Ошибка при обновлении видео:", err);
      await ctx.reply("❌ Ошибка при обновлении. Попробуй снова.");
    }

    ctx.wizard.state.fieldToEdit = null;
    delete ctx.session.editVideoId;

    await showVideoSlide(ctx);
    return ctx.wizard.selectStep(1);
  }
);

// -------------------------------
// Функция для показа видео
// -------------------------------
async function showVideoSlide(ctx) {
  const idx = ctx.wizard.state.currentIndex;
  const video = ctx.wizard.state.videos[idx];

  const keyboard = Markup.inlineKeyboard([
    [
      Markup.button.callback("⬅️", "back"),
      Markup.button.callback("Изменить", "edit"),
      Markup.button.callback("➡️", "next"),
    ],
  ]);

  await clearCurrentMessage(ctx);

  let msg;
  const filePath = video.fileName
    ? path.join(UPLOADS_DIR, video.fileName)
    : null;

  if (filePath && fs.existsSync(filePath)) {
    msg = await ctx.replyWithVideo(
      { source: filePath },
      {
        caption: `🎬 ${video.name}\n\n${idx + 1}/${
          ctx.wizard.state.videos.length
        }`,
        ...keyboard,
      }
    );
  } else {
    msg = await ctx.reply(`❌ Видео недоступно\n🎬 ${video.name}`, keyboard);
  }

  ctx.wizard.state.currentMessageId = msg.message_id;
  ctx.wizard.state.sentMessages.push(msg.message_id);
}

// -------------------------------
// Очистка сообщений сцены
// -------------------------------
async function clearCurrentMessage(ctx) {
  for (const id of ctx.wizard.state.sentMessages || []) {
    try {
      await ctx.deleteMessage(id);
    } catch {}
  }
  ctx.wizard.state.sentMessages = [];
}

module.exports = updateVideoScene;
