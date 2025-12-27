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
    if (ctx.message) return ctx.wizard.next();

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
        [Markup.button.callback("Назад к просмотру", "back_to_slider")],
      ]);

      await ctx.editMessageReplyMarkup(editKeyboard.reply_markup);
      return;
    }

    if (data === "back_to_slider") {
      await showTeamSlide(ctx);
      return;
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
            "Пожалуйста, пришли текст достижений через точку с запятой (;)"
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
  }
);

async function showTeamSlide(ctx) {
  const idx = ctx.wizard.state.currentIndex;
  const team = ctx.wizard.state.teams[idx];
  const total = ctx.wizard.state.teams.length;

  const name = escapeMarkdown(team.name) || "_не указано_";
  const city = escapeMarkdown(team.city) || "_не указано_";
  const ageRange = escapeMarkdown(team.ageRange) || "_не указано_";
  const instructors = escapeMarkdown(team.instructors) || "_не указано_";
  const choreographer = escapeMarkdown(team.choreographer) || "_не указано_";
  const description = escapeMarkdown(team.description) || "_не указано_";

  let achievementsText = "_не указано_";
  if (team.achievements?.length) {
    const escapedAchievements = team.achievements.map((a) => escapeMarkdown(a));
    achievementsText = escapedAchievements.map((a) => `• ${a}`).join("\n");
  }

  const caption = `*Команда ${idx + 1} из ${total}*

🏷 *Название:* ${name}
🏙 *Город:* ${city}
🎂 *Возраст:* ${ageRange}
👨‍🏫 *Преподаватели:* ${instructors}
💃 *Хореограф:* ${choreographer}

📝 *Описание:*
${description}

🏆 *Достижения:*
${achievementsText}`;

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
    if (team.photoFileId) {
      msg = await ctx.replyWithPhoto(team.photoFileId, {
        caption,
        parse_mode: "Markdown",
        ...keyboard,
      });
    } else if (
      team.fileName &&
      fs.existsSync(path.join(uploadDir, team.fileName))
    ) {
      msg = await ctx.replyWithPhoto(
        { source: path.join(uploadDir, team.fileName) },
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
    console.error("Ошибка при отправке сообщения:", error);
    const simpleCaption = `Команда ${idx + 1} из ${total}

Название: ${team.name || "не указано"}
Город: ${team.city || "не указано"}
Возраст: ${team.ageRange || "не указано"}
Преподаватели: ${team.instructors || "не указано"}
Хореограф: ${team.choreographer || "не указано"}

Описание: ${team.description || "не указано"}

Достижения: ${
      team.achievements?.length
        ? team.achievements.map((a) => `• ${a}`).join("\n")
        : "не указано"
    }`;

    if (team.photoFileId) {
      msg = await ctx.replyWithPhoto(team.photoFileId, {
        caption: simpleCaption,
        ...keyboard,
      });
    } else if (
      team.fileName &&
      fs.existsSync(path.join(uploadDir, team.fileName))
    ) {
      msg = await ctx.replyWithPhoto(
        { source: path.join(uploadDir, team.fileName) },
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

module.exports = updateTeamScene;
