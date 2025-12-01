// bot/scenes/deleteEventScene.js
const { Scenes, Markup } = require("telegraf");
const Events = require("../../../models/events");
const fs = require("fs");
const path = require("path");

const deleteEventScene = new Scenes.WizardScene(
  "delete_event",
  // Шаг 0 — показываем первое событие
  async (ctx) => {
    const events = await Events.findAll();

    ctx.wizard.state.sentMessages = [];
    ctx.wizard.state.data = {};

    if (events.length === 0) {
      await ctx.reply("Нет событий для удаления.");
      return ctx.scene.leave();
    }

    ctx.wizard.state.events = events;
    ctx.wizard.state.currentIndex = 0;

    await showEventSlide(ctx);

    return ctx.wizard.next();
  },

  // Шаг 1 — ожидание действий (удаление, следующее, предыдущее)
  async (ctx) => {
    if (!ctx.callbackQuery) return;

    const action = ctx.callbackQuery.data;
    try {
      await ctx.answerCbQuery();
    } catch {}

    const idx = ctx.wizard.state.currentIndex;
    const events = ctx.wizard.state.events;

    if (action === "delete") {
      const ev = events[idx];

      // удаляем фото
      const filePath = path.resolve(__dirname, "../../../uploads", ev.fileName);
      if (fs.existsSync(filePath)) {
        try {
          fs.unlinkSync(filePath);
        } catch {}
      }

      await ev.destroy();
      await ctx.reply("🗑 Событие удалено!");

      // удаляем событие из массива
      events.splice(idx, 1);

      if (events.length === 0) {
        await ctx.reply("Больше событий нет.");
        return ctx.scene.leave();
      }

      // корректируем индекс
      ctx.wizard.state.currentIndex =
        idx >= events.length ? events.length - 1 : idx;

      return showEventSlide(ctx);
    }

    if (action === "next") {
      ctx.wizard.state.currentIndex = (idx + 1) % events.length;
      return showEventSlide(ctx);
    }

    if (action === "prev") {
      ctx.wizard.state.currentIndex = (idx - 1 + events.length) % events.length;
      return showEventSlide(ctx);
    }

    if (action === "stop") {
      clearCurrentMessage(ctx);
      return ctx.scene.leave();
    }
  }
);

// Функция показа события
async function showEventSlide(ctx) {
  const idx = ctx.wizard.state.currentIndex;
  const event = ctx.wizard.state.events[idx];

  const filePath = path.resolve(__dirname, "../../../uploads", event.fileName);

  const keyboard = Markup.inlineKeyboard([
    [
      Markup.button.callback("⬅️", "prev"),
      Markup.button.callback("🗑 Удалить", "delete"),
      Markup.button.callback("➡️", "next"),
    ],
    [Markup.button.callback("⛔ Завершить", "stop")],
  ]);

  await clearCurrentMessage(ctx);

  let msg;
  if (fs.existsSync(filePath)) {
    msg = await ctx.replyWithPhoto(
      { source: filePath },
      {
        caption: `📝 ${event.description}\n📅 ${event.date}\n📍 ${
          event.place || "—"
        }\n\n${idx + 1}/${ctx.wizard.state.events.length}`,
        ...keyboard,
      }
    );
  } else {
    msg = await ctx.reply(
      `Фото недоступно на сервере\n📝 ${event.description}\n📅 ${
        event.date
      }\n📍 ${event.place || "—"}`,
      keyboard
    );
  }

  ctx.wizard.state.currentMessageId = msg.message_id;
  ctx.wizard.state.sentMessages.push(msg.message_id);
}

// Очистка сообщений сцены
async function clearCurrentMessage(ctx) {
  const ids = ctx.wizard.state.sentMessages || [];
  for (const id of ids) {
    try {
      await ctx.deleteMessage(id);
    } catch {}
  }
  ctx.wizard.state.sentMessages = [];
}

module.exports = deleteEventScene;
