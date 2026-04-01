require("dotenv").config();
const path = require("path");
const bot = require("../bot/bot");

const Events = require("../models/events");
const Gallery = require("../models/gallery");
const Video = require("../models/video");
const Teams = require("../models/teams");

const BASE_URL = process.env.PUBLIC_URL;

const cleanFile = (file) =>
  file?.startsWith("http")
    ? file
    : `${BASE_URL}/uploads/${path.basename(file || "")}`;

class UserController {
  async getEvents(req, res) {
    try {
      const events = await Events.findAll();
      res.json({
        success: true,
        data: events.map((e) => ({
          ...e.toJSON(),
          fileUrl: cleanFile(e.fileUrl),
        })),
      });
    } catch {
      res.status(500).json({ success: false });
    }
  }

  async getGallery(req, res) {
    try {
      const data = await Gallery.findAll();
      res.json({
        success: true,
        data: data.map((i) => ({
          ...i.toJSON(),
          fileUrl: cleanFile(i.fileUrl),
        })),
      });
    } catch {
      res.status(500).json({ success: false });
    }
  }

  async getGalleryFilters(req, res) {
    try {
      const images = await Gallery.findAll();
      const filters = [
        "Все",
        ...new Set(images.map((i) => i.filter).filter(Boolean)),
      ];
      res.json({ success: true, data: filters });
    } catch {
      res.json({ success: true, data: ["Все"] });
    }
  }

  async getVideo(req, res) {
    try {
      const videos = await Video.findAll();
      res.json({
        success: true,
        data: videos.map((v) => ({
          ...v.toJSON(),
          fileUrl: cleanFile(v.fileUrl),
        })),
      });
    } catch {
      res.status(500).json({ success: false });
    }
  }

  async getTeams(req, res) {
    try {
      const teams = await Teams.findAll();
      res.json({
        success: true,
        data: teams.map((t) => ({
          ...t.toJSON(),
          fileUrl: cleanFile(t.fileUrl),
        })),
      });
    } catch {
      res.status(500).json({ success: false });
    }
  }

  async postContactForm(req, res) {
    try {
      const {
        fullNameAdult,
        fullNameKid,
        age,
        phone,
        city,
        message,
      } = req.body;

      const text = `
📩 *Новая заявка*

👨‍👩‍👧 Родитель: ${fullNameAdult}
👶 Ребёнок: ${fullNameKid}
🎂 Возраст: ${age}
📞 Телефон: ${phone}
🏙 Город: ${city}

💬 ${message || "Без сообщения"}
`;

      const admins = (process.env.ADMINS_ID || "")
        .split(",")
        .map(Number)
        .filter(Boolean);

      for (const id of admins) {
        await bot.telegram.sendMessage(id, text, {
          parse_mode: "Markdown",
        });
      }

      res.json({ success: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ success: false });
    }
  }
}

module.exports = new UserController();
