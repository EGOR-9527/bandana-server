const { showMenu } = require("../helpers/menu");

module.exports = (bot) => {
  bot.command("events", (ctx) => showMenu(ctx));
  bot.hears("events", (ctx) => showMenu(ctx));
};
