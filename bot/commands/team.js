const { showMenu } = require("../helpers/menu");

module.exports = (bot) => {
  bot.command("team", (ctx) => showMenu(ctx));
  bot.hears("team", (ctx) => showMenu(ctx));
};
