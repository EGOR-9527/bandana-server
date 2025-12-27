const { Telegraf, Scenes, session } = require("telegraf");
require("dotenv").config();

const { showMenu, handleEventCallback } = require("./helpers/menu");
const startCommand = require("./commands/start");
const eventsCommand = require("./commands/events");
const galleryCommand = require("./commands/gallery");
const teamCommand = require("./commands/team");

const createEventScene = require("./scenes/events/createEventScene");
const updateEventScene = require("./scenes/events/updateEventScene");
const deleteEventScene = require("./scenes/events/deleteEventScene");

const addPhotoScene = require("./scenes/gallery/addPhotoScene");
const updatePhotoScene = require("./scenes/gallery/updatePhotoScene");
const deletePhotoScene = require("./scenes/gallery/deletePhotoScene");

const addVideoScene = require("./scenes/video/addVideoScene");
const updateVideoScene = require("./scenes/video/updateVideoScene");
const deleteVideoScene = require("./scenes/video/deleteVideoScene");

const addTeamScene = require("./scenes/teams/addTeamScene");
const updateTeamScene = require("./scenes/teams/updateTeamScene");
const deleteTeamScene = require("./scenes/teams/deleteTeamScene");

const bot = new Telegraf(process.env.BOT_TOKEN);

bot.use(session());

const GLOBAL_COMMANDS = ["events", "gallery", "video", "team"];

const ADMINS_ID = process.env.ADMINS_ID.split(",").map((id) => Number(id));

bot.use(async (ctx, next) => {
  const text = ctx.message?.text || ctx.callbackQuery?.data;
  if (!text) return next();

  const userId = ctx.from?.id;
  console.log();
  if (!ADMINS_ID.includes(userId)) {
    return ctx.reply("Ты не админ🤡");
  }

  if (ctx.callbackQuery) {
    try {
      await ctx.answerCbQuery();
    } catch (err) {
      console.log("Ошибка: " + err);
    }
  }

  if (GLOBAL_COMMANDS.includes(text)) {
    if (ctx.scene?.current?.id) {
      try {
        await ctx.scene.leave();
      } catch {}
    }

    switch (text) {
      case "events":
        return showMenu(ctx, 0);
      case "gallery":
        return showMenu(ctx, 1);
      case "video":
        return showMenu(ctx, 2);
      case "team":
        return showMenu(ctx, 3);
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
  addTeamScene,
  updateTeamScene,
  deleteTeamScene,
]);

stage.action(/create_event|update_event|delete_event/, handleEventCallback);
stage.action(/add_photo|update_photo|delete_photo/, handleEventCallback);
stage.action(/add_video|update_video|delete_video/, handleEventCallback);
stage.action(/add_team|update_team|delete_team/, handleEventCallback);

bot.use(stage.middleware());

startCommand(bot);
eventsCommand(bot);
galleryCommand(bot);
teamCommand(bot);

bot.launch().then(() => console.log("Бот запущен"));

module.exports = bot;
