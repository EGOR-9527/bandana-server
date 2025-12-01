const { Scenes, Markup } = require("telegraf");
const Events = require("../../../models/events");
const { savePhoto, validate, deleteOne } = require("../../helpers/telegram");
const fs = require("fs");
const path = require("path");

const updateEventScene = new Scenes.WizardScene(
  "update_event",

  // -------------------------------
  // Шаг 0: Загрузка событий
  // -------------------------------
  async (ctx) => {
    const events = await Events.findAll();
    ctx.wizard.state.sentMessages = [];
    ctx.wizard.state.data = {};

    if (!events || events.length === 0) {
      await ctx.reply("❗ Событий еще нет");
      return ctx.scene.leave();
    }

    ctx.wizard.state.events = events;
    ctx.wizard.state.currentIndex = 0;

    await showEventSlide(ctx);
    return ctx.wizard.next();
  },

  // -------------------------------
  // Шаг 1: Слайдер событий и выбор редактирования
  // -------------------------------
  async (ctx) => {
    if (!ctx.callbackQuery) return;

    const data = ctx.callbackQuery.data;
    const events = ctx.wizard.state.events;
    let idx = ctx.wizard.state.currentIndex;

    await ctx.answerCbQuery().catch(() => {});

    // --- Навигация по слайдам ---
    if (data === "back") {
      idx = idx > 0 ? idx - 1 : events.length - 1;
      ctx.wizard.state.currentIndex = idx;
      await clearCurrentMessage(ctx);
      await showEventSlide(ctx);
      return;
    }

    if (data === "next") {
      idx = idx < events.length - 1 ? idx + 1 : 0;
      ctx.wizard.state.currentIndex = idx;
      await clearCurrentMessage(ctx);
      await showEventSlide(ctx);
      return;
    }

    // --- Редактирование события ---
    if (data === "edit") {
      await ctx.telegram.editMessageReplyMarkup(
        ctx.chat.id,
        ctx.wizard.state.currentMessageId,
        undefined,
        {
          inline_keyboard: [
            [{ text: "Фото", callback_data: "field_photo" }],
            [{ text: "Описание", callback_data: "field_description" }],
            [{ text: "Дата", callback_data: "field_date" }],
            [{ text: "Место", callback_data: "field_place" }],
            [{ text: "Назад к слайдам", callback_data: "back_to_slider" }],
          ],
        }
      );
      return;
    }

    // --- Вернуться к слайдам ---
    if (data === "back_to_slider") {
      await showEventSlide(ctx);
      return;
    }

    // --- Выбор поля для редактирования ---
    if (data.startsWith("field_")) {
      ctx.wizard.state.fieldToEdit = data.replace("field_", "");
      ctx.session.editEventId = events[idx].id;

      if (ctx.wizard.state.fieldToEdit === "photo") {
        const msg = await ctx.reply("Отправь новое фото:");
        ctx.wizard.state.sentMessages.push(msg.message_id);
      } else {
        const msg = await ctx.reply(
          `Отправь новое значение для ${ctx.wizard.state.fieldToEdit}:`
        );
        ctx.wizard.state.sentMessages.push(msg.message_id);
      }

      return ctx.wizard.next();
    }
  },

  // -------------------------------
  // Шаг 2: Получение нового значения и сохранение
  // -------------------------------
  async (ctx) => {
    const field = ctx.wizard.state.fieldToEdit;
    const eventId = ctx.session.editEventId;

    if (!field || !eventId) return ctx.scene.leave();

    let newData = {};

    if (field === "photo") {
      const valid = await validate(ctx, "Отправь фото!", "photo");
      if (!valid) return;

      const photo = ctx.message.photo.pop();
      const fileData = await savePhoto(ctx, photo.file_id);

      // Удаляем старое фото
      const event = await Events.findByPk(eventId);
      if (event && event.fileName) {
        const oldPath = path.join(__dirname, "../../../../uploads", event.fileName);
        if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
      }

      newData = { ...fileData, photoFileId: photo.file_id };

      await ctx.reply("Фото обновлено ✅");
    } else {
      const valid = await validate(
        ctx,
        `Отправь новое значение для ${field}!`,
        "text"
      );
      if (!valid) return;

      newData = { [field]: ctx.message.text };

      await ctx.reply(
        `${field.charAt(0).toUpperCase() + field.slice(1)} обновлено ✅`
      );
    }

    // --- Сохраняем в базу ---
    try {
      await Events.update(newData, { where: { id: eventId } });
    } catch (e) {
      console.error("Ошибка при обновлении события:", e);
      await ctx.reply("Ошибка при обновлении. Попробуй снова.");
    }

    await showEventSlide(ctx);
  }
);

// -------------------------------
// Функция показа текущего слайда события
// -------------------------------
async function showEventSlide(ctx) {
  const idx = ctx.wizard.state.currentIndex;
  const event = ctx.wizard.state.events[idx];
  const filePath = path.join(__dirname, "../../../uploads", event.fileName);

  const keyboard = Markup.inlineKeyboard([
    [
      Markup.button.callback("⬅️", "back"),
      Markup.button.callback("Изменить", "edit"),
      Markup.button.callback("➡️", "next"),
    ],
  ]);

  await clearCurrentMessage(ctx);

  let msg;
  if (fs.existsSync(filePath)) {
    msg = await ctx.replyWithPhoto(
      { source: filePath },
      {
        caption: `📝${event.description}\n📅${event.date}\n📍${
          event.place
        }\n\n${idx + 1}/${ctx.wizard.state.events.length}`,
        ...keyboard,
      }
    );
  } else {
    msg = await ctx.reply(
      `Фото недоступно на сервере\n📝${event.description}\n📅${event.date}\n📍${event.place}`,
      keyboard
    );
  }

  ctx.wizard.state.currentMessageId = msg.message_id;
  ctx.wizard.state.sentMessages.push(msg.message_id);
}

// -------------------------------
// Функция удаления текущего сообщения сцены
// -------------------------------
async function clearCurrentMessage(ctx) {
  const ids = ctx.wizard.state.sentMessages || [];
  for (const id of ids) {
    try {
      await ctx.deleteMessage(id);
    } catch {}
  }
  ctx.wizard.state.sentMessages = [];
}

module.exports = updateEventScene;
