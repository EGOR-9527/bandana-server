const { Scenes, Markup } = require("telegraf");
const Teams = require("../../../models/teams");
const fs = require("fs");
const path = require("path");

const deleteTeamScene = new Scenes.WizardScene(
  "delete_team",

  async (ctx) => {
    const teams = await Teams.findAll();

    ctx.wizard.state.sentMessages = [];
    ctx.wizard.state.data = {};

    if (teams.length === 0) {
      await ctx.reply("Нет команд для удаления.");
      return ctx.scene.leave();
    }

    ctx.wizard.state.teams = teams;
    ctx.wizard.state.currentIndex = 0;

    await showTeamSlide(ctx);

    return ctx.wizard.next();
  },

  async (ctx) => {
    if (!ctx.callbackQuery) return;

    const action = ctx.callbackQuery.data;
    try {
      await ctx.answerCbQuery();
    } catch {}

    const idx = ctx.wizard.state.currentIndex;
    const teams = ctx.wizard.state.teams;

    if (action === "delete") {
      const team = teams[idx];

      const filePath = path.resolve(
        __dirname,
        "../../../uploads",
        team.fileName
      );
      if (fs.existsSync(filePath)) {
        try {
          fs.unlinkSync(filePath);
        } catch {}
      }

      await team.destroy();
      await ctx.reply("🗑 Команда удалена!");

      teams.splice(idx, 1);

      if (teams.length === 0) {
        await ctx.reply("Больше команд нет.");
        return ctx.scene.leave();
      }

      ctx.wizard.state.currentIndex =
        idx >= teams.length ? teams.length - 1 : idx;

      return showTeamSlide(ctx);
    }

    if (action === "next") {
      ctx.wizard.state.currentIndex = (idx + 1) % teams.length;
      return showTeamSlide(ctx);
    }

    if (action === "prev") {
      ctx.wizard.state.currentIndex = (idx - 1 + teams.length) % teams.length;
      return showTeamSlide(ctx);
    }

    if (action === "stop") {
      await clearCurrentMessage(ctx);
      return ctx.scene.leave();
    }
  }
);

async function showTeamSlide(ctx) {
  const idx = ctx.wizard.state.currentIndex;
  const team = ctx.wizard.state.teams[idx];

  const filePath = path.resolve(__dirname, "../../../uploads", team.fileName);

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
  let textRecruiting = "";
  const MAX_CAPTION_LENGTH = 1024;

  const achievementsText = ctx.wizard.state.data.achievements
    .map((a) => `• ${a}`)
    .join("\n");

  let caption =
    `✅ Команда создана!\n\n` +
    `🏷 Название: ${ctx.wizard.state.data.name}\n` +
    `🏙 Город: ${ctx.wizard.state.data.city}\n` +
    `🎂 Возраст: ${ctx.wizard.state.data.ageRange}\n` +
    `👨‍🏫 Преподаватели: ${ctx.wizard.state.data.instructors}\n` +
    `🏆 Достижения:\n${achievementsText}\n` +
    `📝 Описание: ${ctx.wizard.state.data.description}\n` +
    `👥 ${
      ctx.wizard.state.data.isRecruiting
        ? "✅ Открыт для набора"
        : "❌ Набор закрыт"
    }`;

  if (caption.length > MAX_CAPTION_LENGTH) {
    caption = caption.slice(0, MAX_CAPTION_LENGTH - 3) + "...";
  }

  if (team.isRecruiting) {
    textRecruiting = "открыт";
  } else {
    textRecruiting = "закрыт";
  }

  if (fs.existsSync(filePath)) {
    msg = await ctx.replyWithPhoto(ctx.wizard.state.data.photoFileId, {
      caption,
    });
  }

  ctx.wizard.state.currentMessageId = msg.message_id;
  ctx.wizard.state.sentMessages.push(msg.message_id);
}

async function clearCurrentMessage(ctx) {
  const ids = ctx.wizard.state.sentMessages || [];
  for (const id of ids) {
    try {
      await ctx.deleteMessage(id);
    } catch {}
  }
  ctx.wizard.state.sentMessages = [];
}

module.exports = deleteTeamScene;
