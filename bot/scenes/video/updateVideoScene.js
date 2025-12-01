// bot/scenes/updateVideoScene.js
const { Scenes, Markup } = require("telegraf");
const Video = require("../../../models/video");
const { saveVideo, validate, deleteOne } = require("../../helpers/telegram");
const fs = require("fs");
const path = require("path");

const updateVideoScene = new Scenes.WizardScene(
  "update_video",

  // Шаг 0: выбор видео
  async (ctx) => {
    const videos = await Video.findAll();
    ctx.wizard.state.sentMessages = [];
    ctx.wizard.state.data = {};

    if (!videos || videos.length === 0) {
      await ctx.reply("❗ Видео еще нет");
      return ctx.scene.leave();
    }

    ctx.wizard.state.videos = videos;
    ctx.wizard.state.currentIndex = 0;

    await showVideoSlide(ctx);
    return ctx.wizard.next();
  },

  // Шаг 1: выбор поля для редактирования
  async (ctx) => {
    if (!ctx.callbackQuery) return;
    const data = ctx.callbackQuery.data;
    const videos = ctx.wizard.state.videos;
    let idx = ctx.wizard.state.currentIndex;

    await ctx.answerCbQuery().catch(() => {});

    if (data === "back") {
      idx = idx > 0 ? idx - 1 : videos.length - 1;
      ctx.wizard.state.currentIndex = idx;
      await clearCurrentMessage(ctx);
      await showVideoSlide(ctx);
      return;
    }

    if (data === "next") {
      idx = idx < videos.length - 1 ? idx + 1 : 0;
      ctx.wizard.state.currentIndex = idx;
      await clearCurrentMessage(ctx);
      await showVideoSlide(ctx);
      return;
    }

    if (data === "edit") {
      await ctx.telegram.editMessageReplyMarkup(
        ctx.chat.id,
        ctx.wizard.state.currentMessageId,
        undefined,
        {
          inline_keyboard: [
            [{ text: "Видео", callback_data: "field_video" }],
            [{ text: "Название", callback_data: "field_name" }],
            [{ text: "Назад к слайдам", callback_data: "back_to_slider" }],
          ],
        }
      );
      return;
    }

    if (data === "back_to_slider") {
      await showVideoSlide(ctx);
      return;
    }

    if (data.startsWith("field_")) {
      ctx.wizard.state.fieldToEdit = data.replace("field_", "");
      ctx.session.editVideoId = videos[idx].id;

      const msgText =
        ctx.wizard.state.fieldToEdit === "video"
          ? "Пришли новое видео (до 50 МБ)"
          : "Напиши новое название видео";
      const msg = await ctx.reply(msgText);
      ctx.wizard.state.sentMessages.push(msg.message_id);
      return ctx.wizard.next();
    }
  },

  // Шаг 2: получение нового значения
  async (ctx) => {
    const field = ctx.wizard.state.fieldToEdit;
    const videoId = ctx.session.editVideoId;
    if (!field || !videoId) return ctx.scene.leave();

    const video = await Video.findByPk(videoId);
    if (!video) return ctx.scene.leave();

    let newData = {};

    if (field === "video") {
      const valid = await validate(ctx, "❌ Отправь видео!", "video");
      if (!valid) return;

      const videoFileId = ctx.message.video.file_id;

      // Сохраняем новое видео на сервер
      const fileData = await saveVideo(ctx, videoFileId);
      if (!fileData) {
        const msg = await ctx.reply("❌ Не удалось сохранить видео. Попробуй ещё раз.");
        ctx.wizard.state.sentMessages.push(msg.message_id);
        return;
      }

      // Удаляем старый файл
      if (video.fileName) {
        const oldPath = path.join(__dirname, "../../../uploads", video.fileName);
        if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
      }

      newData = {
        fileName: fileData.fileName,
        fileUrl: fileData.fileUrl,
        videoFileId,
      };

      await ctx.reply("✅ Видео обновлено");
    } else if (field === "name") {
      const valid = await validate(ctx, "❌ Напиши новое название!", "text");
      if (!valid) return;

      newData = { name: ctx.message.text.trim() };
      await ctx.reply("✅ Название обновлено");
    }

    try {
      await Video.update(newData, { where: { id: videoId } });
    } catch (e) {
      console.error("Update video error:", e);
      await ctx.reply("❌ Ошибка при обновлении. Попробуй снова.");
    }

    // Возвращаемся к просмотру слайдов
    await showVideoSlide(ctx);
    return ctx.wizard.selectStep(1); // остаемся на шаге выбора видео
  }
);

// Функция для показа текущего видео
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
  const filePath = path.join(__dirname, "../../../uploads", video.fileName);
  console.log(filePath)
  if (fs.existsSync(filePath)) {
    msg = await ctx.replyWithVideo(
      { source: filePath },
      {
        caption: `🎬 ${video.name}\n\n${idx + 1}/${ctx.wizard.state.videos.length}`,
        ...keyboard,
      }
    );
  } else {
    msg = await ctx.reply(`❌ Видео недоступно\n🎬 ${video.name}`, keyboard);
  }

  ctx.wizard.state.currentMessageId = msg.message_id;
  ctx.wizard.state.sentMessages.push(msg.message_id);
}

// Функция очистки сообщений сцены
async function clearCurrentMessage(ctx) {
  const ids = ctx.wizard.state.sentMessages || [];
  for (const id of ids) {
    try {
      await ctx.deleteMessage(id);
    } catch {}
  }
  ctx.wizard.state.sentMessages = [];
}

module.exports = updateVideoScene;
