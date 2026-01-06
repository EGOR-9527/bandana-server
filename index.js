require("dotenv").config();

const express = require("express");
const cors = require("cors");
const path = require("path");

const sequelize = require("./config/db");
const photosRouter = require("./routes/router");
const bot = require("./bot/bot");

const app = express();
const PORT = Number(process.env.PORT) || 5000;

/* ============================================================
TRUST PROXY (ОБЯЗАТЕЛЬНО ДЛЯ MOB / CLOUDFLARE / NGINX)
============================================================ */
app.set("trust proxy", true);

/* ============================================================
CORS
============================================================ */

const ALLOWED_ORIGINS = process.env.TEST
  ? [
      "https://bandana-dance.ru",
      "https://www.bandana-dance.ru",
      "http://localhost:3000",
    ]
  : ["https://bandana-dance.ru", "https://www.bandana-dance.ru"];

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (ALLOWED_ORIGINS.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error("CORS blocked"), false);
    },
    credentials: true,
  })
);

/* ============================================================
MIDDLEWARE
============================================================ */

app.use(express.json({ limit: "50mb" }));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

/* ============================================================
REDIS (OPTIONAL)
============================================================ */

let redisClient = null;
let redis;

const USE_REDIS = process.env.USE_REDIS !== "false";

if (USE_REDIS) {
  try {
    redis = require("redis");
  } catch {
    console.warn("⚠️ Redis package not installed");
  }
}

async function initRedis() {
  if (!USE_REDIS || !redis) return;

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
    console.log("✅ Redis connected");
  } catch (err) {
    console.warn("⚠️ Redis unavailable, rate-limit disabled");
    redisClient = null;
  }
}

/* ============================================================
UTILS
============================================================ */

const getClientIp = (req) => {
  const cfIp = req.headers["cf-connecting-ip"];
  if (cfIp) return cfIp;

  const xff = req.headers["x-forwarded-for"];
  if (xff) return xff.split(",")[0].trim();

  return req.socket.remoteAddress || "unknown";
};

/* ============================================================
RATE LIMIT (SAFE FOR MOBILE)
============================================================ */

const RATE_LIMIT_MAX = Number(process.env.RATE_LIMIT_MAX) || 1000;
const RATE_LIMIT_WINDOW = Number(process.env.RATE_LIMIT_WINDOW_MS) || 60000;
const SLOW_AFTER = Number(process.env.SLOW_DOWN_AFTER) || 300;
const SLOW_DELAY = Number(process.env.SLOW_DOWN_DELAY_MS) || 20;

// публичные пути — НЕ ЛИМИТИМ
const SKIP_RATE_LIMIT_PATHS = [
  "/uploads",
  "/api/gallery",
  "/api/video",
  "/api/events",
  "/api/teams",
];

app.use(async (req, res, next) => {
  try {
    if (
      SKIP_RATE_LIMIT_PATHS.some((p) => req.path.startsWith(p))
    ) {
      return next();
    }

    if (!USE_REDIS || !redisClient || !redisClient.isOpen) {
      return next();
    }

    const ip = getClientIp(req);
    const key = `ratelimit:${ip}`;

    const requests = await redisClient.incr(key);

    if (requests === 1) {
      await redisClient.expire(key, RATE_LIMIT_WINDOW / 1000);
    }

    if (requests > RATE_LIMIT_MAX) {
      return res.status(429).json({
        success: false,
        message: "Слишком много запросов, попробуйте позже",
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
ROUTES
============================================================ */

app.use("/api", photosRouter);

/* ============================================================
START SERVER
============================================================ */

async function start() {
  try {
    await sequelize.authenticate();
    console.log("✅ PostgreSQL connected");

    await sequelize.sync();

    await initRedis();

    try {
      bot.start();
      console.log("✅ Telegram bot started");
    } catch (e) {
      console.warn("⚠️ Telegram bot error:", e.message);
    }

    app.listen(PORT, "0.0.0.0", () => {
      console.log(`🚀 Server running on port ${PORT}`);
    });
  } catch (err) {
    console.error("❌ Critical startup error:", err);
    process.exit(1);
  }
}

start();
