const { showMenu } = require("../helpers/menu");

module.exports = (bot) => {
  bot.command("gallery", (ctx) => showMenu(ctx));
  bot.hears("gallery", (ctx) => showMenu(ctx));
};
