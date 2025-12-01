// bot/bot.js
const { Telegraf, Scenes, session } = require("telegraf");
require("dotenv").config();

const { showMenu, handleEventCallback } = require("./helpers/menu");

// --- Команды ---
const startCommand = require("./commands/start");
const eventsCommand = require("./commands/events");
const galleryCommand = require("./commands/gallery");

// --- Сцены ---
const createEventScene = require("./scenes/events/createEventScene");
const updateEventScene = require("./scenes/events/updateEventScene");
const deleteEventScene = require("./scenes/events/deleteEventScene");

const addPhotoScene = require("./scenes/gallery/addPhotoScene");
const updatePhotoScene = require("./scenes/gallery/updatePhotoScene");
const deletePhotoScene = require("./scenes/gallery/deletePhotoScene");

const addVideoScene = require("./scenes/video/addVideoScene");
const updateVideoScene = require("./scenes/video/updateVideoScene");
const deleteVideoScene = require("./scenes/video/deleteVideoScene");

const bot = new Telegraf(process.env.BOT_TOKEN);

// session — обязателен для сцен
bot.use(session());

// Глобальные команды (меню)
const GLOBAL_COMMANDS = ["events", "gallery", "video"];

// --- ГЛОБАЛЬНОЕ MIDDLEWARE ---
bot.use(async (ctx, next) => {
  const text = ctx.message?.text || ctx.callbackQuery?.data;

  // Если не текст и не callback — дальше
  if (!text) return next();

  // Безопасный answerCbQuery — только когда callback
  if (ctx.callbackQuery) {
    try {
      await ctx.answerCbQuery();
    } catch {}
  }

  // Если это глобальная команда
  if (GLOBAL_COMMANDS.includes(text)) {
    // Выходим из сцены, если в ней есть пользователь
    if (ctx.scene?.current?.id) {
      try {
        await ctx.scene.leave();
      } catch {}
    }

    // Обрабатываем меню
    switch (text) {
      case "events":
        return showMenu(ctx, 0);
      case "gallery":
        return showMenu(ctx, 1);
      case "video":
        return showMenu(ctx, 2);
    }
  }

  // Ничего не поймали — идём дальше
  return next();
});

// --- STAGE (сцены) ---
const stage = new Scenes.Stage([
  createEventScene,
  updateEventScene,
  deleteEventScene,
  addPhotoScene,
  updatePhotoScene,
  deletePhotoScene,
  addVideoScene,
  updateVideoScene,
  deleteVideoScene,
]);

// Реагирование на callback-кнопки внутри сцен И вне сцен
stage.action(/create_event|update_event|delete_event/, handleEventCallback);
stage.action(/add_photo|update_photo|delete_photo/, handleEventCallback);
stage.action(/add_video|update_video|delete_video/, handleEventCallback);

// Подключаем stage
bot.use(stage.middleware());

// Команды
startCommand(bot);
eventsCommand(bot);
galleryCommand(bot);

// Запуск
bot.launch().then(() => console.log("Бот запущен"));
