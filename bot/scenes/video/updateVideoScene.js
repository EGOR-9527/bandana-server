// bot/scenes/updateVideoScene.js
const { Scenes, Markup } = require("telegraf");
const Video = require("../../../models/video");
const {
  saveVideo,
  validate,
  deleteOne,
  getYandexDirectLink,
  saveVideoFromUrl,
} = require("../../helpers/telegram");

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

    // Блокировка повторного нажатия
    if (ctx.wizard.state.processing) return; // игнорируем повторные клики
    ctx.wizard.state.processing = true;

    const video = await Video.findByPk(videoId);
    if (!video) {
      ctx.wizard.state.processing = false;
      return ctx.scene.leave();
    }

    let newData = {};

    try {
      if (field === "video") {
        const publicUrl = ctx.message?.text?.trim();

        if (!publicUrl || !publicUrl.startsWith("https")) {
          const msg = await ctx.reply(
            "❌ Отправь корректную ссылку на новое видео с Яндекс.Диска"
          );
          ctx.wizard.state.sentMessages.push(msg.message_id);
          ctx.wizard.state.processing = false;
          return;
        }

        const directUrl = await getYandexDirectLink(publicUrl);
        if (!directUrl) {
          const msg = await ctx.reply(
            "❌ Не удалось получить прямую ссылку. Проверь ссылку"
          );
          ctx.wizard.state.sentMessages.push(msg.message_id);
          ctx.wizard.state.processing = false;
          return;
        }

        // Скачиваем видео на сервер
        const saved = await saveVideoFromUrl(directUrl);
        if (!saved) {
          const msg = await ctx.reply(
            "❌ Не удалось скачать видео. Попробуй ещё раз"
          );
          ctx.wizard.state.sentMessages.push(msg.message_id);
          ctx.wizard.state.processing = false;
          return;
        }

        // Удаляем старый файл
        if (video.fileName) {
          const oldPath = path.join(
            __dirname,
            "../../../uploads",
            video.fileName
          );
          if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
        }

        newData = { fileName: saved.fileName, fileUrl: saved.filePath };
        await ctx.reply("✅ Видео обновлено");
      } else if (field === "name") {
        const text = ctx.message?.text?.trim();
        if (!text) {
          const msg = await ctx.reply("❌ Название не может быть пустым");
          ctx.wizard.state.sentMessages.push(msg.message_id);
          ctx.wizard.state.processing = false;
          return;
        }

        newData = { name: text };
        await ctx.reply("✅ Название обновлено");
      }

      await Video.update(newData, { where: { id: videoId } });
    } catch (err) {
      console.error("Ошибка при обновлении видео:", err);
      await ctx.reply("❌ Ошибка при обновлении. Попробуй снова.");
    }

    ctx.wizard.state.processing = false; // снимаем блокировку

    await showVideoSlide(ctx);
    return ctx.wizard.selectStep(1);
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
  console.log(filePath);
  if (fs.existsSync(filePath)) {
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
