const path = require("path");
const bot = require("../bot/bot");
const Events = require("../models/events");
const Gallery = require("../models/gallery");
const Video = require("../models/video");

const BASE_URL = process.env.BASE_URL || "http://localhost:5000";

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
      const events = await Events.findAll({ order: [["date", "DESC"]] });
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

  async getGalleryFilters(req, res) {
    try {
      const images = await Gallery.findAll({
        attributes: ["filter"],
        raw: true,
      });

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
      const images = await Gallery.findAll({ order: [["createdAt", "DESC"]] });
      const result = images.map((img) => ({
        ...img.toJSON(),
        fileUrl: buildFileUrl(img.fileUrl),
      }));
      res.json({ success: true, data: result });
    } catch (err) {
      console.error("Ошибка getGallery:", err);
      res.status(500).json({ success: false, message: "Ошибка сервера" });
    }
  }

  async getVideo(req, res) {
    try {
      const videos = await Video.findAll({ order: [["createdAt", "DESC"]] });
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
