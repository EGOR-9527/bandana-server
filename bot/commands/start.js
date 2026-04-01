// bot/commands/start.js
const { Markup } = require("telegraf");
const showEventsMenu = require("../helpers/menu");

module.exports = (bot) => {
  bot.start(async (ctx) => {
    await ctx.reply(
      `Привет, ${ctx.from.first_name || "друг"}!`,
      Markup.keyboard([["events", "gallery", "video", "team"]]).resize()
    );
  });

  bot.command("menu", (ctx) => {
    return ctx.reply(
      "Меню",
      Markup.keyboard([["events", "gallery", "video", "team"]]).resize()
    );
  });
};
