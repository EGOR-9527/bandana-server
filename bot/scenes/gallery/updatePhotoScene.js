const { Scenes, Markup } = require("telegraf");
const Gallery = require("../../../models/gallery");
const { savePhoto } = require("../../helpers/telegram");
const fs = require("fs");
const path = require("path");

const UPLOADS_DIR = path.join(__dirname, "../../../uploads");
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const updatePhotoScene = new Scenes.WizardScene(
  "update_photo",

  async (ctx) => {
    ctx.wizard.state.sentMessages = [];
    ctx.wizard.state.fieldToEdit = null;

    const photos = await Gallery.findAll({ order: [["id", "ASC"]] });
    if (!photos?.length) {
      await ctx.reply("Фото в галерее пока нет");
      return ctx.scene.leave();
    }

    ctx.wizard.state.photos = photos;
    ctx.wizard.state.currentIndex = 0;

    await showPhotoSlide(ctx);
    return ctx.wizard.next();
  },

  async (ctx) => {
    if (ctx.message) return ctx.wizard.next();

    if (!ctx.callbackQuery) return;

    const data = ctx.callbackQuery.data;
    const photos = ctx.wizard.state.photos;
    let idx = ctx.wizard.state.currentIndex;

    await ctx.answerCbQuery();

    if (data === "back" || data === "next") {
      idx =
        data === "back"
          ? idx > 0
            ? idx - 1
            : photos.length - 1
          : idx < photos.length - 1
          ? idx + 1
          : 0;

      ctx.wizard.state.currentIndex = idx;
      await clearCurrentMessage(ctx);
      await showPhotoSlide(ctx);
      return;
    }

    if (data === "edit") {
      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback("Новое фото", "field_photo")],
        [Markup.button.callback("Подпись", "field_footer")],
        [Markup.button.callback("Фильтр", "field_filter")],
        [Markup.button.callback("Назад к просмотру", "back_to_slider")],
      ]);

      await ctx.editMessageReplyMarkup(keyboard.reply_markup);
      return;
    }

    if (data === "back_to_slider") {
      await showPhotoSlide(ctx);
      return;
    }

    if (data.startsWith("field_")) {
      ctx.wizard.state.fieldToEdit = data.replace("field_", "");
      ctx.session.editPhotoId = photos[idx].id;

      const field = ctx.wizard.state.fieldToEdit;
      const messages = {
        photo: "Пришли новое фото для галереи",
        footer: "Напиши новую подпись под фото",
        filter: "Укажи новый фильтр (например: black&white, vintage и т.д.)",
      };

      const msg = await ctx.reply(messages[field] || "Пришли новое значение:");
      ctx.wizard.state.sentMessages.push(msg.message_id);

      return ctx.wizard.next();
    }
  },

  async (ctx) => {
    const field = ctx.wizard.state.fieldToEdit;
    const photoId = ctx.session.editPhotoId;

    if (!field || !photoId) {
      return ctx.wizard.selectStep(1);
    }

    let newData = {};
    let successMsg = "";

    try {
      if (field === "photo") {
        if (!ctx.message?.photo?.length) {
          await ctx.reply("Пожалуйста, пришли фото");
          return;
        }

        const photo = ctx.message.photo.pop();
        const fileData = await savePhoto(ctx, photo.file_id, UPLOADS_DIR);

        const old = await Gallery.findByPk(photoId);
        if (old?.fileName) {
          const oldPath = path.join(UPLOADS_DIR, old.fileName);
          if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
        }

        newData = {
          fileName: fileData.fileName,
          photoFileId: photo.file_id,
        };
        successMsg = "Фото успешно заменено";
      }
      else {
        if (!ctx.message?.text || !ctx.message.text.trim()) {
          await ctx.reply("Пожалуйста, пришли текст");
          return;
        }

        const text = ctx.message.text.trim();
        newData = { [field]: text };

        const names = { footer: "Подпись", filter: "Фильтр" };
        successMsg = `${names[field] || field} обновлено`;
      }

      await Gallery.update(newData, { where: { id: photoId } });

      const updated = await Gallery.findByPk(photoId);
      if (updated) {
        const i = ctx.wizard.state.photos.findIndex((p) => p.id === photoId);
        if (i !== -1) ctx.wizard.state.photos[i] = updated;
      }

      await ctx.replyWithMarkdownV2(`*Готово* \n${successMsg}`);
    } catch (err) {
      console.error("Ошибка при обновлении фото:", err);
      await ctx.reply("Ошибка при сохранении. Попробуй ещё раз.");
    }

    ctx.wizard.state.fieldToEdit = null;
    delete ctx.session.editPhotoId;

    await showPhotoSlide(ctx);
    return ctx.wizard.selectStep(1);
  }
);

async function showPhotoSlide(ctx) {
  const idx = ctx.wizard.state.currentIndex;
  const photo = ctx.wizard.state.photos[idx];
  const total = ctx.wizard.state.photos.length;

  const caption = `
*Фото ${idx + 1} из ${total}*

${
  photo.footer
    ? `*Подпись:* ${photo.footer.escapeMarkdown()}`
    : "_Подпись не указана_"
}

${
  photo.filter
    ? `*Фильтр:* ${photo.filter.escapeMarkdown()}`
    : "_Фильтр не указан_"
}
`.trim();

  const keyboard = Markup.inlineKeyboard([
    [
      Markup.button.callback("Назад", "back"),
      Markup.button.callback("Изменить", "edit"),
      Markup.button.callback("Вперёд", "next"),
    ],
  ]);

  await clearCurrentMessage(ctx);

  let msg;

  if (photo.photoFileId) {
    try {
      msg = await ctx.replyWithPhoto(photo.photoFileId, {
        caption,
        parse_mode: "Markdown",
        ...keyboard,
      });
    } catch (err) {
      console.log("file_id не сработал, fallback на файл");
    }
  }

  if (!msg && photo.fileName) {
    const filePath = path.join(UPLOADS_DIR, photo.fileName);
    if (fs.existsSync(filePath)) {
      msg = await ctx.replyWithPhoto(
        { source: filePath },
        { caption, parse_mode: "Markdown", ...keyboard }
      );
    }
  }

  if (!msg) {
    msg = await ctx.reply(`${caption}\n\nФото недоступно на сервере`, {
      parse_mode: "Markdown",
      ...keyboard,
    });
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

String.prototype.escapeMarkdown = function () {
  return this.replace(/([_*[\]()~>`#+\-=|{}.!])/g, "\\$1");
};

module.exports = updatePhotoScene;
