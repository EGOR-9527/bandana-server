const express = require("express");
const cors = require("cors");
const path = require("path");
const redis = require("redis");
require("dotenv").config();

const sequelize = require("./config/db");
const photosRouter = require("./routes/router");
const bot = require("./bot/bot");

const app = express();
const PORT = process.env.PORT || 5000;

const redisClient = redis.createClient({
  socket: {
    host: process.env.REDIS_HOST,
    port: process.env.REDIS_PORT
  }
});
redisClient.connect();
redisClient.on("connect", () => console.log("Redis подключён"));
redisClient.on("error", (err) => console.error("Ошибка Redis:", err));

const ALLOWED_ORIGINS = [
  "https://bandana-dance.ru",
  "https://www.bandana-dance.ru"
];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
    return callback(new Error("Forbidden Origin"));
  },
  credentials: true
}));

app.use((req, res, next) => {
  const origin = req.headers.origin;
  const referer = req.headers.referer;

  const allowed =
    (!origin || ALLOWED_ORIGINS.includes(origin)) &&
    (!referer || ALLOWED_ORIGINS.some(url => referer.startsWith(url)));

  if (!allowed) {
    return res.status(403).json({
      success: false,
      message: "Запросы разрешены только с https://bandana-dance.ru"
    });
  }

  next();
});
 
const MAX = parseInt(process.env.RATE_LIMIT_MAX);
const WINDOW = parseInt(process.env.RATE_LIMIT_WINDOW_MS);
const SLOW_AFTER = parseInt(process.env.SLOW_DOWN_AFTER);
const SLOW_DELAY = parseInt(process.env.SLOW_DOWN_DELAY_MS);

app.use(async (req, res, next) => {
  try {
    const ip =
      req.headers["cf-connecting-ip"] ||
      req.headers["x-forwarded-for"] ||
      req.ip;

    const redisKey = `ratelimit:${ip}`;

    const requests = await redisClient.incr(redisKey);

    if (requests === 1) {
      await redisClient.expire(redisKey, WINDOW / 1000);
    }

    if (requests > MAX) {
      return res.status(429).json({
        success: false,
        message: process.env.RATE_LIMIT_MESSAGE
      });
    }

    if (requests > SLOW_AFTER) {
      const extraDelay = (requests - SLOW_AFTER) * SLOW_DELAY;
      await new Promise(r => setTimeout(r, extraDelay));
    }

    next();
  } catch (err) {
    console.error("Ошибка rate-limit:", err);
    next();
  }
});

app.use(express.json({ limit: "20mb" }));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));
app.use("/api", photosRouter);

const start = async () => {
  try {
    await sequelize.authenticate();
    console.log("PostgreSQL подключена");
    await sequelize.sync();

    bot.start();
    console.log("Telegram-бот запущен");

    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Сервер запущен на ${PORT}`);
    });
  } catch (err) {
    console.error("Ошибка запуска:", err);
    process.exit(1);
  }
};

start();
