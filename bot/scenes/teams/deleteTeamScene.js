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

  if (team.isRecruiting) {
    textRecruiting = "открыт";
  } else {
    textRecruiting = "закрыт";
  }

  if (fs.existsSync(filePath)) {
    msg = await ctx.replyWithPhoto(
      { source: filePath },
      {
        caption:
          `🏷 Название: ${team.name}\n` +
          `🏙 Город: ${team.city}\n` +
          `🎂 Возраст: ${team.ageRange}\n` +
          `👨‍🏫 Преподаватели: ${team.instructors}\n` +
          `📝 Описание: ${team.description}\n` +
          `👥 Набор: ${textRecruiting}\n` +
          `🏆 Достижения:\n${
            team.achievements?.map((a) => `• ${a}`).join("\n") || "—"
          }\n\n` +
          `${idx + 1}/${ctx.wizard.state.teams.length}`,
        ...keyboard,
      }
    );
  } else {
    msg = await ctx.reply(
      `Фото недоступно на сервере\n🏷 Название: ${team.name}\n` +
        `🏙 Город: ${team.city}\n` +
        `🎂 Возраст: ${team.ageRange}\n` +
        `👨‍🏫 Преподаватели: ${team.instructors}\n` +
        `📝 Описание: ${team.description}\n` +
        `👥 Набор: ${textRecruiting}\n` +
        `🏆 Достижения:\n${
          team.achievements?.map((a) => `• ${a}`).join("\n") || "—"
        }\n\n` +
        `${idx + 1}/${ctx.wizard.state.teams.length}`,
      keyboard
    );
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
