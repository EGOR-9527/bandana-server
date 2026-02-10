const { Scenes, Markup } = require("telegraf");
const Teams = require("../../../models/teams");
const { savePhoto } = require("../../helpers/telegram");
const fs = require("fs");
const path = require("path");

const uploadDir = path.join(__dirname, "../../../uploads");

function escapeMarkdown(text) {
  if (!text) return text;
  return text.replace(/[_*[\]()~`>#+\-=|{}.!]/g, "\\$&");
}

const updateTeamScene = new Scenes.WizardScene(
  "update_team",

  async (ctx) => {
    ctx.wizard.state.sentMessages = [];
    ctx.wizard.state.fieldToEdit = null;

    const teams = await Teams.findAll();
    if (!teams?.length) {
      await ctx.reply("Команд пока нет");
      return ctx.scene.leave();
    }

    ctx.wizard.state.teams = teams;
    ctx.wizard.state.currentIndex = 0;

    await showTeamSlide(ctx);
    return ctx.wizard.next();
  },

  async (ctx) => {
    if (!ctx.callbackQuery) return;
    const data = ctx.callbackQuery.data;
    const teams = ctx.wizard.state.teams;
    let idx = ctx.wizard.state.currentIndex;

    await ctx.answerCbQuery();

    if (data === "back" || data === "next") {
      idx =
        data === "back"
          ? idx > 0
            ? idx - 1
            : teams.length - 1
          : idx < teams.length - 1
            ? idx + 1
            : 0;

      ctx.wizard.state.currentIndex = idx;
      await clearCurrentMessage(ctx);
      await showTeamSlide(ctx);
      return;
    }

    if (data === "edit") {
      const editKeyboard = Markup.inlineKeyboard([
        [Markup.button.callback("Фото", "field_photo")],
        [Markup.button.callback("Название", "field_name")],
        [Markup.button.callback("Город", "field_city")],
        [Markup.button.callback("Возраст", "field_ageRange")],
        [Markup.button.callback("Преподаватели", "field_instructors")],
        [Markup.button.callback("Хореограф", "field_choreographer")],
        [Markup.button.callback("Достижения", "field_achievements")],
        [Markup.button.callback("Описание", "field_description")],
        [Markup.button.callback("Статус набора", "field_isRecruiting")],
        [Markup.button.callback("Назад к просмотру", "back_to_slider")],
      ]);

      await ctx.editMessageReplyMarkup(editKeyboard.reply_markup);
      return;
    }

    if (data === "back_to_slider") {
      await showTeamSlide(ctx);
      return;
    }

    if (data === "field_isRecruiting") {
      ctx.wizard.state.fieldToEdit = "isRecruiting";
      ctx.session.editTeamId = teams[idx].id;

      const statusKeyboard = Markup.inlineKeyboard([
        [
          Markup.button.callback("✅ Открыть набор", "set_recruiting_true"),
          Markup.button.callback("❌ Закрыть набор", "set_recruiting_false"),
        ],
        [Markup.button.callback("⬅️ Назад к редактированию", "back_to_edit")],
      ]);

      const team = teams[idx];
      const currentStatus = team.isRecruiting
        ? "✅ Открыт для набора"
        : "❌ Набор закрыт";

      const text = `Текущий статус набора: ${currentStatus}\n\nВыберите новый статус:`;

      await ctx.editMessageCaption(text, {
        ...statusKeyboard,
        parse_mode: "HTML",
      });
      return;
    }

    if (data === "back_to_edit") {
      const editKeyboard = Markup.inlineKeyboard([
        [Markup.button.callback("Фото", "field_photo")],
        [Markup.button.callback("Название", "field_name")],
        [Markup.button.callback("Город", "field_city")],
        [Markup.button.callback("Возраст", "field_ageRange")],
        [Markup.button.callback("Преподаватели", "field_instructors")],
        [Markup.button.callback("Хореограф", "field_choreographer")],
        [Markup.button.callback("Достижения", "field_achievements")],
        [Markup.button.callback("Описание", "field_description")],
        [Markup.button.callback("Статус набора", "field_isRecruiting")],
        [Markup.button.callback("Назад к просмотру", "back_to_slider")],
      ]);

      await ctx.editMessageReplyMarkup(editKeyboard.reply_markup);
      return;
    }

    if (data === "set_recruiting_true" || data === "set_recruiting_false") {
      const newStatus = data === "set_recruiting_true";
      const teamId = ctx.session.editTeamId;

      try {
        await Teams.update(
          { isRecruiting: newStatus },
          { where: { id: teamId } },
        );

        const fresh = await Teams.findByPk(teamId);
        if (fresh) {
          const i = ctx.wizard.state.teams.findIndex((t) => t.id === teamId);
          if (i !== -1) ctx.wizard.state.teams[i] = fresh;
        }

        const statusText = newStatus
          ? "✅ Открыт для набора"
          : "❌ Набор закрыт";
        await ctx.reply(`✅ Статус набора обновлен: ${statusText}`);

        ctx.wizard.state.fieldToEdit = null;
        delete ctx.session.editTeamId;

        await showTeamSlide(ctx);
        return ctx.wizard.selectStep(1);
      } catch (err) {
        console.error("Ошибка обновления статуса набора:", err);
        await ctx.reply("Произошла ошибка при сохранении статуса");
        return;
      }
    }

    if (data.startsWith("field_")) {
      ctx.wizard.state.fieldToEdit = data.replace("field_", "");
      ctx.session.editTeamId = teams[idx].id;

      const field = ctx.wizard.state.fieldToEdit;
      const fieldNames = {
        photo: "фото",
        name: "название",
        city: "город",
        ageRange: "возраст участников",
        instructors: "преподаватели",
        choreographer: "хореографа",
        achievements: "достижения (через точку с запятой ;)",
        description: "описание",
      };
      const fieldName = fieldNames[field] || field;

      const text =
        field === "photo"
          ? "Пришли новое фото команды"
          : `Напиши новое значение для ${fieldName}:`;

      const msg = await ctx.reply(text);
      ctx.wizard.state.sentMessages.push(msg.message_id);

      return ctx.wizard.next();
    }
  },

  async (ctx) => {
    const field = ctx.wizard.state.fieldToEdit;
    const teamId = ctx.session.editTeamId;

    if (!field || !teamId) {
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

        const old = await Teams.findByPk(teamId);
        if (old?.fileName) {
          const oldPath = path.join(uploadDir, old.fileName);
          if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
        }

        const fileUrl = `/uploads/${fileData.fileName}`;

        newData = {
          fileName: fileData.fileName,
          photoFileId: photo.file_id,
          fileUrl: fileUrl,
        };
        successMessage = "Фото успешно обновлено!";
      } else if (field === "achievements") {
        if (!ctx.message?.text?.trim()) {
          await ctx.reply(
            "Пожалуйста, пришли текст достижений через точку с запятой (;)",
          );
          return;
        }
        const achievements = ctx.message.text
          .trim()
          .split(";")
          .map((a) => a.trim())
          .filter((a) => a);
        newData = { achievements: achievements };
        successMessage = "Достижения обновлены!";
      } else {
        if (!ctx.message?.text?.trim()) {
          await ctx.reply("Пожалуйста, пришли текст");
          return;
        }
        const text = ctx.message.text.trim();
        newData = { [field]: text };

        const fieldTitles = {
          name: "Название",
          city: "Город",
          ageRange: "Возраст участников",
          instructors: "Преподаватели",
          choreographer: "Хореограф",
          description: "Описание",
        };
        successMessage = `${fieldTitles[field] || field} обновлено!`;
      }

      await Teams.update(newData, { where: { id: teamId } });

      const fresh = await Teams.findByPk(teamId);
      if (fresh) {
        const i = ctx.wizard.state.teams.findIndex((t) => t.id === teamId);
        if (i !== -1) ctx.wizard.state.teams[i] = fresh;
      }

      await ctx.reply(`✅ ${successMessage}`);
    } catch (err) {
      console.error("Ошибка обновления команды:", err);
      await ctx.reply("Произошла ошибка при сохранении");
    }

    ctx.wizard.state.fieldToEdit = null;
    delete ctx.session.editTeamId;

    await showTeamSlide(ctx);
    return ctx.wizard.selectStep(1);
  },
);

async function showTeamSlide(ctx) {
  const idx = ctx.wizard.state.currentIndex;
  const team = ctx.wizard.state.teams[idx];
  const total = ctx.wizard.state.teams.length;

  const escape = (text) =>
    text ? text.replace(/[_*[\]()~`>#+\-=|{}.!]/g, "\\$&") : "_не указано_";

  const caption = `*Команда ${idx + 1} из ${total}*

🏷 *Название:* ${escape(team.name)}
🏙 *Город:* ${escape(team.city)}
🎂 *Возраст:* ${escape(team.ageRange)}
👨‍🏫 *Преподаватели:* ${escape(team.instructors)}
💃 *Хореограф:* ${escape(team.choreographer)}
👥 *Статус набора:* ${team.isRecruiting ? "✅ Открыт" : "❌ Закрыт"}

📝 *Описание:*
${escape(team.description)}

🏆 *Достижения:*
${
  team.achievements?.length
    ? team.achievements.map((a) => `• ${escape(a)}`).join("\n")
    : "_не указано_"
}`;

  const MAX_CAPTION = 1024;
  const safeCaption =
    caption.length > MAX_CAPTION
      ? caption.slice(0, MAX_CAPTION - 3) + "..."
      : caption;

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
    if (team.fileName) {
      const filePath = path.join(uploadDir, team.fileName);

      if (fs.existsSync(filePath)) {
        msg = await ctx.replyWithPhoto(
          { source: filePath },
          {
            caption: safeCaption,
            parse_mode: "Markdown",
            reply_markup: keyboard.reply_markup,
          },
        );
      } else {
        console.error(`Файл не найден: ${filePath}`);
        msg = await ctx.reply(
          safeCaption + "\n\n📷 Файл не найден на сервере",
          {
            parse_mode: "Markdown",
            reply_markup: keyboard.reply_markup,
          },
        );
      }
    } else {
      msg = await ctx.reply(safeCaption + "\n\n📷 Фото не указано в БД", {
        parse_mode: "Markdown",
        reply_markup: keyboard.reply_markup,
      });
    }
  } catch (error) {
    console.error("Ошибка отправки команды:", error);

    const simpleCaption = `Команда ${idx + 1} из ${total}\n\n📷 Ошибка загрузки фото`;
    msg = await ctx.reply(simpleCaption, {
      reply_markup: keyboard.reply_markup,
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

module.exports = updateTeamScene;
