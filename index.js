require("dotenv").config();

const express = require("express");
const cors = require("cors");
const path = require("path");
const compression = require("compression");

const sequelize = require("./config/db");
const photosRouter = require("./routes/router");
const bot = require("./bot/bot");

const app = express();
const PORT = Number(process.env.PORT) || 5000;

/* ============================================================
CORS
============================================================ */

const ALLOWED_ORIGINS = [
  "https://bandana-dance.ru",
  "https://www.bandana-dance.ru",
];

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) {
        return callback(null, true);
      }

      if (ALLOWED_ORIGINS.includes(origin)) {
        return callback(null, true);
      }

      try {
        const originHostname = new URL(origin).hostname;
        const allowedHostnames = ALLOWED_ORIGINS.map(
          (url) => new URL(url).hostname
        );

        if (allowedHostnames.includes(originHostname)) {
          return callback(null, true);
        }
      } catch (e) {}

      console.warn(`CORS заблокирован: ${origin}`);
      return callback(new Error("Not allowed by CORS"), false);
    },
    credentials: true,
    exposedHeaders: ["Content-Range", "X-Content-Range"],
    maxAge: 86400,
  })
);

/* ============================================================
Compression (СЖАТИЕ GZIP - уменьшает размер данных в 5-10 раз!)
============================================================ */
app.use(compression({
  level: 6,
  threshold: 1024,
}));

/* ============================================================
Express middleware
============================================================ */

app.use(express.json({ limit: "20mb" }));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

app.use((req, res, next) => {
  if (req.url.startsWith('/api') && !req.url.includes('/test')) {
    console.log(`${new Date().toLocaleTimeString()} ${req.method} ${req.url}`);
  }
  next();
});

app.use('/uploads', (req, res, next) => {
  res.set('Cache-Control', 'public, max-age=300');
  next();
});

/* ============================================================
Redis
============================================================ */

let redisClient = null;
let redis;

const USE_REDIS = process.env.USE_REDIS !== "false";

if (USE_REDIS) {
  try {
    redis = require("redis");
  } catch (err) {
    console.warn("⚠️ Пакет 'redis' не установлен, Redis отключён");
  }
}

async function initRedis() {
  if (!USE_REDIS || !redis) {
    console.log("⚠️ Redis отключён (тестовый режим)");
    return;
  }

  try {
    redisClient = redis.createClient({
      socket: {
        host: process.env.REDIS_HOST || "127.0.0.1",
        port: Number(process.env.REDIS_PORT) || 6379,
      },
    });

    redisClient.on("error", (err) => {
      console.error("❌ Redis error:", err.message);
    });

    await redisClient.connect();
    console.log("✅ Redis подключён");
  } catch (err) {
    console.warn("⚠️ Redis недоступен, rate-limit отключён");
    redisClient = null;
  }
}

global.redisClient = null;

/* ============================================================
Rate limit
============================================================ */

const RATE_LIMIT_MAX = Number(process.env.RATE_LIMIT_MAX) || 200;
const RATE_LIMIT_WINDOW = Number(process.env.RATE_LIMIT_WINDOW_MS) || 60000;
const SLOW_AFTER = Number(process.env.SLOW_DOWN_AFTER) || 100;
const SLOW_DELAY = Number(process.env.SLOW_DOWN_DELAY_MS) || 50;

app.use(async (req, res, next) => {
  if (!USE_REDIS || !redisClient || !redisClient.isOpen) {
    return next();
  }

  try {
    const ip =
      req.headers["cf-connecting-ip"] ||
      req.headers["x-forwarded-for"] ||
      req.socket.remoteAddress;

    const key = `ratelimit:${ip}`;
    const requests = await redisClient.incr(key);

    if (requests === 1) {
      await redisClient.expire(key, RATE_LIMIT_WINDOW / 1000);
    }

    if (requests > RATE_LIMIT_MAX) {
      return res.status(429).json({
        success: false,
        message:
          process.env.RATE_LIMIT_MESSAGE ||
          "Слишком много запросов, попробуйте позже",
      });
    }

    if (requests > SLOW_AFTER) {
      const delay = (requests - SLOW_AFTER) * SLOW_DELAY;
      await new Promise((r) => setTimeout(r, delay));
    }

    next();
  } catch (err) {
    console.error("Rate-limit error:", err.message);
    next();
  }
});

/* ============================================================
Routes
============================================================ */

app.use("/api", photosRouter);

app.get("/api/test-speed", (req, res) => {
  res.json({
    success: true,
    message: "Сервер работает",
    timestamp: Date.now(),
    compressed: true
  });
});

app.get("/health", (req, res) => {
  res.json({
    status: "OK",
    time: new Date().toISOString(),
    redis: redisClient && redisClient.isOpen ? "connected" : "disconnected",
    memory: process.memoryUsage()
  });
});

/* ============================================================
Start server
============================================================ */

async function start() {
  try {
    await sequelize.authenticate();
    console.log("✅ PostgreSQL подключена");

    await sequelize.sync();

    await initRedis();
    global.redisClient = redisClient;

    try {
      bot.start();
      console.log("✅ Telegram-бот запущен");
    } catch (e) {
      console.error("⚠️ Ошибка Telegram-бота:", e.message);
    }

    app.listen(PORT, "0.0.0.0", () => {
      console.log(`🚀 Сервер запущен на порту ${PORT}`);
      console.log(`📦 Сжатие GZIP: включено`);
      console.log(`🔄 Кэширование Redis: ${redisClient ? 'включено' : 'выключено'}`);
    });
  } catch (err) {
    console.error("❌ Критическая ошибка запуска:", err);
    process.exit(1);
  }
}

start();