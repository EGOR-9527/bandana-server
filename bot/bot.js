const { Telegraf, Scenes, session } = require("telegraf");
require("dotenv").config();

const { showMenu, handleEventCallback } = require("./helpers/menu");
const startCommand = require("./commands/start");
const eventsCommand = require("./commands/events");
const galleryCommand = require("./commands/gallery");

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

bot.use(session());

const GLOBAL_COMMANDS = ["events", "gallery", "video"];

bot.use(async (ctx, next) => {
  const text = ctx.message?.text || ctx.callbackQuery?.data;
  if (!text) return next();

  if (ctx.callbackQuery) {
    try { await ctx.answerCbQuery(); } catch {}
  }

  if (GLOBAL_COMMANDS.includes(text)) {
    if (ctx.scene?.current?.id) {
      try { await ctx.scene.leave(); } catch {}
    }

    switch (text) {
      case "events": return showMenu(ctx, 0);
      case "gallery": return showMenu(ctx, 1);
      case "video": return showMenu(ctx, 2);
    }
  }

  return next();
});

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

stage.action(/create_event|update_event|delete_event/, handleEventCallback);
stage.action(/add_photo|update_photo|delete_photo/, handleEventCallback);
stage.action(/add_video|update_video|delete_video/, handleEventCallback);

bot.use(stage.middleware());

startCommand(bot);
eventsCommand(bot);
galleryCommand(bot);

bot.launch().then(() => console.log("Бот запущен"));

module.exports = bot;
