require("dotenv").config();
const path = require("path");
const bot = require("../bot/bot");
const Events = require("../models/events");
const Gallery = require("../models/gallery");
const Video = require("../models/video");
const Teams = require("../models/teams");

const BASE_URL = "https://bandana-dance.ru";

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

// Функция для создания превью (если настроите обработку изображений)
const buildThumbnailUrl = (fileUrl, size = '300x300') => {
  if (!fileUrl) return '';
  const filename = getCleanFilename(fileUrl);
  // Если настроите CDN с ресайзом, раскомментируйте:
  // return `${BASE_URL}/uploads/${size}/${filename}`;
  return buildFileUrl(fileUrl); // Пока возвращаем оригинал
};

class UserController {
  constructor() {
    this.cacheTTL = process.env.CACHE_TTL || 300; // 5 минут по умолчанию
  }

  async getFromCache(key) {
    try {
      if (global.redisClient && global.redisClient.isOpen) {
        const cached = await global.redisClient.get(key);
        return cached ? JSON.parse(cached) : null;
      }
    } catch (err) {
      console.warn(`Ошибка кэша Redis для ключа ${key}:`, err.message);
    }
    return null;
  }

  async setToCache(key, data, ttl = this.cacheTTL) {
    try {
      if (global.redisClient && global.redisClient.isOpen) {
        await global.redisClient.setEx(key, ttl, JSON.stringify(data));
      }
    } catch (err) {
      console.warn(`Ошибка записи в кэш для ключа ${key}:`, err.message);
    }
  }

  async getEvents(req, res) {
    try {
      const cacheKey = 'api:events:all';
      
      // Пробуем получить из кэша
      const cached = await this.getFromCache(cacheKey);
      if (cached) {
        console.log('📦 Events from cache');
        return res.json(cached);
      }

      const events = await Events.findAll({
        attributes: ['id', 'title', 'date', 'description', 'fileUrl', 'createdAt'],
        order: [['date', 'DESC']],
        limit: 50 // Ограничиваем количество
      });
      
      const result = events.map((e) => ({
        id: e.id,
        title: e.title,
        date: e.date,
        description: e.description,
        fileUrl: buildFileUrl(e.fileUrl),
        thumbnailUrl: buildThumbnailUrl(e.fileUrl, '300x300'),
        createdAt: e.createdAt
      }));

      const response = { 
        success: true, 
        data: result,
        cached: false,
        timestamp: Date.now()
      };

      // Сохраняем в кэш
      await this.setToCache(cacheKey, response);

      res.json(response);
    } catch (err) {
      console.error("Ошибка getEvents:", err);
      res.status(500).json({ 
        success: false, 
        message: "Ошибка сервера",
        error: process.env.NODE_ENV === 'development' ? err.message : undefined
      });
    }
  }

  async getTeams(req, res) {
    try {
      const cacheKey = 'api:teams:all';
      
      const cached = await this.getFromCache(cacheKey);
      if (cached) {
        console.log('📦 Teams from cache');
        return res.json(cached);
      }

      const teams = await Teams.findAll({
        attributes: ['id', 'name', 'city', 'ageRange', 'instructors', 
                    'achievements', 'description', 'isRecruiting', 'fileUrl'],
        limit: 100
      });
      
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
        thumbnailUrl: buildThumbnailUrl(t.fileUrl, '300x300')
      }));

      const response = { 
        success: true, 
        data: result,
        cached: false,
        timestamp: Date.now()
      };

      await this.setToCache(cacheKey, response);

      res.json(response);
    } catch (err) {
      console.error("Ошибка getTeams:", err);
      res.status(500).json({ 
        success: false, 
        message: "Ошибка сервера",
        error: process.env.NODE_ENV === 'development' ? err.message : undefined
      });
    }
  }

  async getGalleryFilters(req, res) {
    try {
      const cacheKey = 'api:gallery:filters';
      
      const cached = await this.getFromCache(cacheKey);
      if (cached) {
        console.log('📦 Filters from cache');
        return res.json(cached);
      }

      const images = await Gallery.findAll({
        attributes: ['filter'],
        group: ['filter']
      });

      const uniqueFilters = images
        .map(img => img.filter)
        .filter(f => f && f.trim() !== "");

      const filterList = [
        "Все",
        ...uniqueFilters.sort((a, b) => a.localeCompare(b, "ru")),
      ];

      const response = { 
        success: true, 
        data: filterList,
        cached: false
      };

      await this.setToCache(cacheKey, response, 3600); // Кэшируем фильтры на час

      res.json(response);
    } catch (err) {
      console.error("Ошибка getGalleryFilters:", err);
      res.status(500).json({ 
        success: false, 
        data: ["Все"] 
      });
    }
  }

  async getGallery(req, res) {
    try {
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 24; // Оптимально для сетки
      const filter = req.query.filter;
      const offset = (page - 1) * limit;
      
      const cacheKey = `api:gallery:${filter || 'all'}:page:${page}:limit:${limit}`;
      
      const cached = await this.getFromCache(cacheKey);
      if (cached) {
        console.log(`📦 Gallery ${filter || 'all'} page ${page} from cache`);
        return res.json(cached);
      }

      let where = {};
      if (filter && filter !== 'Все') {
        where.filter = filter;
      }

      const { count, rows } = await Gallery.findAndCountAll({
        where,
        limit,
        offset,
        order: [['createdAt', 'DESC']],
        attributes: ['id', 'title', 'filter', 'fileUrl', 'createdAt']
      });

      const processedResult = rows.map((item) => ({
        id: item.id,
        title: item.title,
        filter: item.filter,
        fileUrl: buildFileUrl(item.fileUrl),
        thumbnailUrl: buildThumbnailUrl(item.fileUrl, '400x400'), // Меньше для списка
        createdAt: item.createdAt
      }));

      const response = {
        success: true,
        data: processedResult,
        pagination: {
          page,
          limit,
          total: count,
          pages: Math.ceil(count / limit),
          hasMore: page < Math.ceil(count / limit)
        },
        cached: false,
        timestamp: Date.now()
      };

      await this.setToCache(cacheKey, response);

      res.json(response);
    } catch (err) {
      console.error("Ошибка getGallery:", err);
      res.status(500).json({ 
        success: false, 
        message: "Ошибка сервера",
        error: process.env.NODE_ENV === 'development' ? err.message : undefined
      });
    }
  }

  async getVideo(req, res) {
    try {
      const cacheKey = 'api:videos:all';
      
      const cached = await this.getFromCache(cacheKey);
      if (cached) {
        console.log('📦 Videos from cache');
        return res.json(cached);
      }

      const videos = await Video.findAll({
        attributes: ['id', 'title', 'description', 'fileUrl', 'createdAt'],
        order: [['createdAt', 'DESC']],
        limit: 50
      });
      
      const result = videos.map((v) => ({
        id: v.id,
        title: v.title,
        description: v.description,
        fileUrl: buildFileUrl(v.fileUrl),
        thumbnailUrl: buildThumbnailUrl(v.fileUrl, '400x300'), // Соотношение для видео
        createdAt: v.createdAt
      }));

      const response = { 
        success: true, 
        data: result,
        cached: false,
        timestamp: Date.now()
      };

      await this.setToCache(cacheKey, response);

      res.json(response);
    } catch (err) {
      console.error("Ошибка getVideo:", err);
      res.status(500).json({ 
        success: false, 
        message: "Ошибка сервера",
        error: process.env.NODE_ENV === 'development' ? err.message : undefined
      });
    }
  }

  async postContactForm(req, res) {
    try {
      const { fullNameKid, fullNameAdult, age, phone, city, message } = req.body;

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

      const ADMINS_ID = process.env.ADMINS_ID ? 
        process.env.ADMINS_ID.split(",").map((id) => Number(id)) : [];
      
      const sendPromises = ADMINS_ID.map(adminId => 
        bot.telegram.sendMessage(adminId, text, {
          parse_mode: "Markdown",
        }).catch(e => console.error(`Ошибка отправки админу ${adminId}:`, e.message))
      );

      await Promise.all(sendPromises);

      res.json({ 
        success: true, 
        message: "Форма отправлена!" 
      });
    } catch (err) {
      console.error("Ошибка contactForm:", err);
      res.status(500).json({ 
        success: false, 
        message: "Ошибка сервера" 
      });
    }
  }
}

module.exports = new UserController();