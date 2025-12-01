// bot/scenes/deleteVideoScene.js
const { Scenes, Markup } = require("telegraf");
const Video = require("../../../models/video");
const fs = require("fs");
const path = require("path");

const deleteVideoScene = new Scenes.WizardScene(
  "delete_video",

  // Шаг 0: старт сцены
  async (ctx) => {
    const videos = await Video.findAll();
    ctx.wizard.state.sentMessages = [];
    ctx.wizard.state.data = {};

    if (!videos || videos.length === 0) {
      await ctx.reply("❌ Нет видео для удаления.");
      return ctx.scene.leave();
    }

    ctx.wizard.state.videos = videos;
    ctx.wizard.state.currentIndex = 0;

    await showVideoSlide(ctx);
    return ctx.wizard.next();
  },

  // Шаг 1: обработка callback кнопок
  async (ctx) => {
    if (!ctx.callbackQuery) return;
    const action = ctx.callbackQuery.data;
    const idx = ctx.wizard.state.currentIndex;
    const videos = ctx.wizard.state.videos;

    await ctx.answerCbQuery().catch(() => {});

    const projectRoot = path.resolve(__dirname, "../../.."); // корень проекта

    if (action === "delete") {
      const video = videos[idx];
      const filePath = path.join(projectRoot, "uploads", video.fileName);

      // Удаляем файл с диска
      if (fs.existsSync(filePath)) {
        try {
          fs.unlinkSync(filePath);
        } catch (err) {
          console.error("Ошибка удаления файла:", err);
        }
      }

      // Удаляем запись из базы
      await video.destroy();
      await ctx.reply("🗑 Видео удалено!");

      // Убираем видео из массива
      videos.splice(idx, 1);

      if (videos.length === 0) {
        await ctx.reply("Больше видео нет.");
        return ctx.scene.leave();
      }

      // Корректируем индекс
      ctx.wizard.state.currentIndex = idx >= videos.length ? videos.length - 1 : idx;
      return showVideoSlide(ctx);
    }

    if (action === "next") {
      ctx.wizard.state.currentIndex = (idx + 1) % videos.length;
      return showVideoSlide(ctx);
    }

    if (action === "prev") {
      ctx.wizard.state.currentIndex = (idx - 1 + videos.length) % videos.length;
      return showVideoSlide(ctx);
    }

    if (action === "stop") {
      await clearCurrentMessage(ctx);
      return ctx.scene.leave();
    }
  }
);

// Показывает текущее видео с навигацией
async function showVideoSlide(ctx) {
  const idx = ctx.wizard.state.currentIndex;
  const video = ctx.wizard.state.videos[idx];

  const keyboard = Markup.inlineKeyboard([
    [
      Markup.button.callback("⬅️", "prev"),
      Markup.button.callback("🗑 Удалить", "delete"),
      Markup.button.callback("➡️", "next"),
    ],
    [Markup.button.callback("⛔ Завершить", "stop")],
  ]);

  await clearCurrentMessage(ctx);

  const projectRoot = path.resolve(__dirname, "../../..");
  const filePath = path.join(projectRoot, "uploads", video.fileName);

  let msg;
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

// Очистка всех сообщений сцены
async function clearCurrentMessage(ctx) {
  const ids = ctx.wizard.state.sentMessages || [];
  for (const id of ids) {
    try {
      await ctx.deleteMessage(id);
    } catch {}
  }
  ctx.wizard.state.sentMessages = [];
}

module.exports = deleteVideoScene;
