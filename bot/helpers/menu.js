// helpers/menu.js
const { Markup } = require("telegraf");

const MENU = {
  0: [
    { text: "➕ Создать", action: "create_event" },
    { text: "✏ Изменить", action: "update_event" },
    { text: "🗑 Удалить", action: "delete_event" },
  ],
  1: [
    { text: "➕ Добавить", action: "add_photo" },
    { text: "✏ Изменить", action: "update_photo" },
    { text: "🗑 Удалить", action: "delete_photo" },
  ],
  2: [
    { text: "➕ Добавить", action: "add_video" },
    { text: "✏ Изменить", action: "update_video" },
    { text: "🗑 Удалить", action: "delete_video" },
  ],
  3: [
    { text: "➕ Добавить", action: "add_team" },
    { text: "✏ Изменить", action: "update_team" },
    { text: "🗑 Удалить", action: "delete_team" },
  ],
};

function showMenu(ctx, index, text = "Выбери действие:") {
  const menuItems = MENU[index];
  if (!menuItems) {
    return ctx.reply("❗ Меню для этого раздела не найдено");
  }

  const buttons = menuItems.map((item) => [
    Markup.button.callback(item.text, item.action),
  ]);

  return ctx.reply(text, Markup.inlineKeyboard(buttons));
}

async function handleEventCallback(ctx) {
  try {
    await ctx.answerCbQuery();
  } catch {}

  const action = ctx.callbackQuery?.data;

  if (ctx.scene?.current?.id) {
    try {
      await ctx.scene.leave();
    } catch {}
  }

  switch (action) {
    case "create_event":
      return ctx.scene.enter("create_event");
    case "update_event":
      return ctx.scene.enter("update_event");
    case "delete_event":
      return ctx.scene.enter("delete_event");
    case "add_photo":
      return ctx.scene.enter("add_photo");
    case "update_photo":
      return ctx.scene.enter("update_photo");
    case "delete_photo":
      return ctx.scene.enter("delete_photo");
    case "add_video":
      return ctx.scene.enter("add_video");
    case "update_video":
      return ctx.scene.enter("update_video");
    case "delete_video":
      return ctx.scene.enter("delete_video");
    case "add_team":
      return ctx.scene.enter("add_team");
    case "update_team":
      return ctx.scene.enter("update_team");
    case "delete_team":
      return ctx.scene.enter("delete_team");
    default:
      return ctx.reply("❗ Неизвестная команда");
  }
}

module.exports = {
  showMenu,
  handleEventCallback,
  MENU,
};
