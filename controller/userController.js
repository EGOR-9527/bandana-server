// controller/userController.js

const path = require("path");

const Events = require("../models/events");
const Gallery = require("../models/gallery");
const Video = require("../models/video");

// Базовый URL (лучше задать в .env)
const BASE_URL =
  process.env.CLIENT_URL || process.env.API_URL || "http://localhost:5000";

// Выдираем имя файла из любого пути/URL
const getCleanFilename = (fileUrl) => {
  if (!fileUrl) return "";
  try {
    return path.basename(new URL(fileUrl).pathname);
    // если это http(s) ссылка
  } catch {
    return path.basename(fileUrl.replace(/\\/g, "/")); // если это C:\путь\файл.jpg
  }
};

const buildFileUrl = (fileUrl) => {
  if (!fileUrl) return "";
  if (typeof fileUrl === "string" && fileUrl.startsWith("http")) return fileUrl;

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
      // Получаем все записи (можно и без where, если null-ов нет)
      const images = await Gallery.findAll({
        attributes: ["filter"], // берём только нужное поле
        raw: true, // САМОЕ ГЛАВНОЕ — получаем чистый объект!
      });

      // Теперь images — это массив вида: [ { filter: "ворвоа" }, { filter: "Концерты" }, ... ]

      const uniqueFilters = [
        ...new Set(
          images
            .map((img) => img.filter) // вытаскиваем значение
            .filter((f) => f && f.trim() !== "") // убираем пустые и null
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
}

module.exports = new UserController();
