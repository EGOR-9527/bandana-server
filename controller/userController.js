require("dotenv").config();
const path = require("path");
const bot = require("../bot/bot");
const Events = require("../models/events");
const Gallery = require("../models/gallery");
const Video = require("../models/video");
const Teams = require("../models/teams");

const BASE_URL = process.env.TEST ? "http://localhost:5000" : "https://bandana-dance.ru";

const getCleanFilename = (fileUrl) => {
  if (!fileUrl) return "";
  try {
    return path.basename(new URL(fileUrl).pathname);
  } catch {
    return path.basename(fileUrl.replace(/\\/g, "/"));
  }
};

const buildFileUrl = (fileUrl) => {
  if (!fileUrl) return "";

  if (typeof fileUrl === "string" && fileUrl.startsWith("http")) {
    return fileUrl;
  }

  return `${BASE_URL}/uploads/${getCleanFilename(fileUrl)}`;
};

class UserController {
  async getEvents(req, res) {
    try {
      const events = await Events.findAll();
      const result = events.map((e) => ({
        ...e.toJSON(),
        fileUrl: buildFileUrl(e.fileUrl),
      }));
      res.json({ success: true, data: result });
    } catch (err) {
      console.error("Ошибка getEvents:", err);
      res.status(500).json({ success: false, message: "Ошибка сервера" });
    }
  }

  async getTeams(req, res) {
    try {
      const teams = await Teams.findAll();
      console.log(teams);
      const result = teams.map((t) => ({
        id: t.id,
        name: t.name,
        city: t.city,
        ageRange: t.ageRange,
        instructors: t.instructors,
        achievements: t.achievements,
        description: t.description,
        isRecruiting: t.isRecruiting,
        fileUrl: buildFileUrl(t.fileUrl),
      }));
      res.json({ success: true, data: result });
    } catch (err) {
      console.error("Ошибка getTeams:", err);
      res.status(500).json({ success: false, message: "Ошибка сервера" });
    }
  }

  async getGalleryFilters(req, res) {
    try {
      const images = await Gallery.findAll();

      const uniqueFilters = [
        ...new Set(
          images.map((img) => img.filter).filter((f) => f && f.trim() !== "")
        ),
      ];

      const filterList = [
        "Все",
        ...uniqueFilters.sort((a, b) => a.localeCompare(b, "ru")),
      ];

      res.json({ success: true, data: filterList });
    } catch (err) {
      console.error("Ошибка getGalleryFilters:", err);
      res.status(500).json({ success: false, data: ["Все"] });
    }
  }

  async getGallery(req, res) {
    try {
      const result = await Gallery.findAll();

      const processedResult = result.map((item) => ({
        ...item.toJSON(),
        fileUrl: buildFileUrl(item.fileUrl),
      }));

      res.json({
        success: true,
        data: processedResult,
      });
    } catch (err) {
      console.error("Ошибка getGallery:", err);
      res.status(500).json({ success: false, message: "Ошибка сервера" });
    }
  }

  async getVideo(req, res) {
    try {
      const videos = await Video.findAll();
      const result = videos.map((v) => ({
        ...v.toJSON(),
        fileUrl: buildFileUrl(v.fileUrl),
      }));
      res.json({ success: true, data: result });
    } catch (err) {
      console.error("Ошибка getVideo:", err);
      res.status(500).json({ success: false, message: "Ошибка сервера" });
    }
  }

  async postContactForm(req, res) {
    try {
      const { fullNameKid, fullNameAdult, age, phone, city, message } =
        req.body;

      const text = `
─────────────────────────────
📩 *Новая заявка с сайта*

👨‍👩‍👧 *Родитель:* ${fullNameKid}
👶 *Ребенок:* ${fullNameAdult}
🎂 *Возраст:* ${age} лет
📞 *Телефон:* ${phone}
🏙 *Город:* ${city}

💬 *Сообщение:*
${message || "_Нет сообщения_"}

─────────────────────────────
`;

      const ADMINS_ID = process.env.ADMINS_ID.split(",").map((id) =>
        Number(id)
      );
      for (const adminId of ADMINS_ID) {
        await bot.telegram.sendMessage(adminId, text, {
          parse_mode: "Markdown",
        });
      }

      res.json({ success: true, message: "Форма отправлена!" });
    } catch (err) {
      console.error("Ошибка contactForm:", err);
      res.status(500).json({ success: false, message: "Ошибка сервера" });
    }
  }
}

module.exports = new UserController();
