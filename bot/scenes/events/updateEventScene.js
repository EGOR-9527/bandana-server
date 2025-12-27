const { Scenes, Markup } = require("telegraf");
const Events = require("../../../models/events");
const { savePhoto } = require("../../helpers/telegram");
const fs = require("fs");
const path = require("path");

const uploadDir = path.join(__dirname, "../../../uploads");

// Функция для экранирования Markdown символов
function escapeMarkdown(text) {
  if (!text) return text;
  return text.replace(/[_*[\]()~`>#+\-=|{}.!]/g, "\\$&");
}

const updateEventScene = new Scenes.WizardScene(
  "update_event",

  async (ctx) => {
    ctx.wizard.state.sentMessages = [];
    ctx.wizard.state.fieldToEdit = null;

    const events = await Events.findAll();
    if (!events?.length) {
      await ctx.reply("Событий пока нет");
      return ctx.scene.leave();
    }

    ctx.wizard.state.events = events;
    ctx.wizard.state.currentIndex = 0;

    await showEventSlide(ctx);
    return ctx.wizard.next();
  },

  async (ctx) => {
    if (ctx.message) return ctx.wizard.next();

    if (!ctx.callbackQuery) return;
    const data = ctx.callbackQuery.data;
    const events = ctx.wizard.state.events;
    let idx = ctx.wizard.state.currentIndex;

    await ctx.answerCbQuery();

    if (data === "back" || data === "next") {
      idx =
        data === "back"
          ? idx > 0
            ? idx - 1
            : events.length - 1
          : idx < events.length - 1
          ? idx + 1
          : 0;

      ctx.wizard.state.currentIndex = idx;
      await clearCurrentMessage(ctx);
      await showEventSlide(ctx);
      return;
    }

    if (data === "edit") {
      const editKeyboard = Markup.inlineKeyboard([
        [Markup.button.callback("Фото", "field_photo")],
        [Markup.button.callback("Описание", "field_description")],
        [Markup.button.callback("Дата", "field_date")],
        [Markup.button.callback("Место", "field_place")],
        [Markup.button.callback("Назад к просмотру", "back_to_slider")],
      ]);

      await ctx.editMessageReplyMarkup(editKeyboard.reply_markup);
      return;
    }

    if (data === "back_to_slider") {
      await showEventSlide(ctx);
      return;
    }

    if (data.startsWith("field_")) {
      ctx.wizard.state.fieldToEdit = data.replace("field_", "");
      ctx.session.editEventId = events[idx].id;

      const field = ctx.wizard.state.fieldToEdit;
      const fieldName = {
        photo: "фото",
        description: "описание",
        date: "дату",
        place: "место",
      }[field];

      const text =
        field === "photo"
          ? "Пришли новое фото события"
          : `Напиши новое ${fieldName}:`;

      const msg = await ctx.reply(text);
      ctx.wizard.state.sentMessages.push(msg.message_id);

      return ctx.wizard.next();
    }
  },

  async (ctx) => {
    const field = ctx.wizard.state.fieldToEdit;
    const eventId = ctx.session.editEventId;

    if (!field || !eventId) {
      return ctx.wizard.selectStep(1);
    }

    let newData = {};
    let successMessage = "";

    try {
      if (field === "photo") {
        if (!ctx.message?.photo?.length) {
          await ctx.reply("Пожалуйста, пришли фото");
          return;
        }

        const photo = ctx.message.photo.pop();
        const fileData = await savePhoto(ctx, photo.file_id);

        const old = await Events.findByPk(eventId);
        if (old?.fileName) {
          const oldPath = path.join(uploadDir, old.fileName);
          if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
        }

        // Формируем новый fileUrl на основе имени файла
        const fileUrl = `/uploads/${fileData.fileName}`;

        newData = {
          fileName: fileData.fileName,
          photoFileId: photo.file_id,
          fileUrl: fileUrl, // Обновляем fileUrl
        };
        successMessage = "Фото успешно обновлено!";
      } else {
        if (!ctx.message?.text || !ctx.message.text.trim()) {
          await ctx.reply("Пожалуйста, пришли текст");
          return;
        }

        const text = ctx.message.text.trim();
        newData = { [field]: text };

        const names = { description: "Описание", date: "Дата", place: "Место" };
        successMessage = `${names[field] || field} обновлено!`;
      }

      await Events.update(newData, { where: { id: eventId } });

      const fresh = await Events.findByPk(eventId);
      if (fresh) {
        const i = ctx.wizard.state.events.findIndex((e) => e.id === eventId);
        if (i !== -1) ctx.wizard.state.events[i] = fresh;
      }

      await ctx.reply(`✅ ${successMessage}`);
    } catch (err) {
      console.error("Ошибка обновления события:", err);
      await ctx.reply("Произошла ошибка при сохранении");
    }

    ctx.wizard.state.fieldToEdit = null;
    delete ctx.session.editEventId;

    await showEventSlide(ctx);
    return ctx.wizard.selectStep(1);
  }
);

async function showEventSlide(ctx) {
  const idx = ctx.wizard.state.currentIndex;
  const event = ctx.wizard.state.events[idx];
  const total = ctx.wizard.state.events.length;

  // Экранируем текстовые поля
  const description = escapeMarkdown(event.description) || "_не указано_";
  const date = escapeMarkdown(event.date) || "_не указано_";
  const place = escapeMarkdown(event.place) || "_не указано_";

  const caption = `*Событие ${idx + 1} из ${total}*

📝 *Описание*
${description}

📅 *Дата*
${date}

📍 *Место*
${place}`;

  const keyboard = Markup.inlineKeyboard([
    [
      Markup.button.callback("⬅️", "back"),
      Markup.button.callback("Изменить", "edit"),
      Markup.button.callback("➡️", "next"),
    ],
  ]);

  await clearCurrentMessage(ctx);

  let msg;
  try {
    if (event.photoFileId) {
      msg = await ctx.replyWithPhoto(event.photoFileId, {
        caption,
        parse_mode: "Markdown",
        ...keyboard,
      });
    } else if (
      event.fileName &&
      fs.existsSync(path.join(uploadDir, event.fileName))
    ) {
      msg = await ctx.replyWithPhoto(
        { source: path.join(uploadDir, event.fileName) },
        {
          caption,
          parse_mode: "Markdown",
          ...keyboard,
        }
      );
    } else {
      msg = await ctx.reply(caption + "\n\n📷 Фото недоступно", {
        parse_mode: "Markdown",
        ...keyboard,
      });
    }
  } catch (error) {
    console.error("Ошибка при отправке события:", error);
    // Резервный вариант без Markdown
    const simpleCaption = `Событие ${idx + 1} из ${total}

Описание: ${event.description || "не указано"}
Дата: ${event.date || "не указано"}
Место: ${event.place || "не указано"}`;

    if (event.photoFileId) {
      msg = await ctx.replyWithPhoto(event.photoFileId, {
        caption: simpleCaption,
        ...keyboard,
      });
    } else if (
      event.fileName &&
      fs.existsSync(path.join(uploadDir, event.fileName))
    ) {
      msg = await ctx.replyWithPhoto(
        { source: path.join(uploadDir, event.fileName) },
        {
          caption: simpleCaption,
          ...keyboard,
        }
      );
    } else {
      msg = await ctx.reply(simpleCaption + "\n\nФото недоступно", {
        ...keyboard,
      });
    }
  }

  ctx.wizard.state.currentMessageId = msg.message_id;
  ctx.wizard.state.sentMessages.push(msg.message_id);
}

async function clearCurrentMessage(ctx) {
  for (const id of ctx.wizard.state.sentMessages || []) {
    try {
      await ctx.deleteMessage(id);
    } catch {}
  }
  ctx.wizard.state.sentMessages = [];
}

module.exports = updateEventScene;
