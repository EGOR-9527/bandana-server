const express = require("express");
const cors = require("cors");
const path = require("path");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const slowDown = require("express-slow-down");
const RedisStore = require("rate-limit-redis");
const Redis = require("ioredis");
require("dotenv").config();

const sequelize = require("./config/db");
const photosRouter = require("./routes/router");
const bot = require("./bot/bot");

const app = express();
const PORT = process.env.PORT || 5000;

// Redis клиент
const redisClient = new Redis({
  host: process.env.REDIS_HOST,
  port: process.env.REDIS_PORT,
});

// Helmet + безопасность заголовков
app.use(helmet({
  contentSecurityPolicy: false,
  hsts: { maxAge: 31536000, includeSubDomains: true },
  referrerPolicy: { policy: "no-referrer" }
}));

// CORS
const allowedOrigins = "https://bandana-dance.ru";
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    callback(new Error("CORS blocked"));
  },
  credentials: true,
}));

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// Замедление после 80 запросов
const speedLimiter = slowDown({
  windowMs: 15000,
  delayAfter: Number(process.env.SLOW_DOWN_AFTER) || 80,
  delayMs: (hits) => hits * (Number(process.env.SLOW_DOWN_DELAY_MS) || 100),
  store: new RedisStore({ sendCommand: (...args) => redisClient.call(...args) }),
});
app.use(speedLimiter);

// Глобальный rate-limit
const globalLimiter = rateLimit({
  windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS) || 60000,
  max: Number(process.env.RATE_LIMIT_MAX) || 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: false, message: process.env.RATE_LIMIT_MESSAGE },
  keyGenerator: (req) => req.headers['cf-connecting-ip'] || req.ip,
  store: new RedisStore({ sendCommand: (...args) => redisClient.call(...args) }),
});
app.use(globalLimiter);

// Лимит на тяжёлые эндпоинты
const heavyLimiter = rateLimit({
  windowMs: 60000,
  max: Number(process.env.HEAVY_ROUTE_MAX) || 60,
  message: { success: false, message: "Слишком много запросов к медиа" },
  store: new RedisStore({ sendCommand: (...args) => redisClient.call(...args) }),
});
app.use("/api/gallery", heavyLimiter);
app.use("/api/video", heavyLimiter);
app.use("/api/events", heavyLimiter);

// Статические файлы
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// API роуты
app.use("/api", photosRouter);

// 404
app.use("*", (req, res) => res.status(404).json({ success: false, message: "Not found" }));

// Запуск
const start = async () => {
  try {
    await sequelize.authenticate();
    console.log("PostgreSQL подключён");
    await sequelize.sync({ alter: false });

    bot.start();
    console.log("Telegram-бот запущен");

    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Сервер работает: https://bandana-dance.ru:${PORT}`);
    });
  } catch (err) {
    console.error("Ошибка запуска:", err);
    process.exit(1);
  }
};

start();