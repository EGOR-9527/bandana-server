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
CORS
============================================================ */

const IS_TEST = process.env.TEST === "false";

const ALLOWED_ORIGINS = IS_TEST
  ? [
      "http://localhost:3000",
      "https://bandana-dance.ru",
      "https://www.bandana-dance.ru",
    ]
  : ["https://bandana-dance.ru", "https://www.bandana-dance.ru"];

app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin || ALLOWED_ORIGINS.includes(origin)) {
        callback(null, true);
      } else {
        console.warn("Blocked CORS for origin:", origin);
        callback(new Error("CORS blocked"));
      }
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
REDIS
============================================================ */

/*let redisClient = null;
/*let redis;
/*
/*const USE_REDIS = process.env.USE_REDIS === "true";
/*
/*if (USE_REDIS) {
/*  try {
/*    redis = require("redis");
/*  } catch {
/*    console.warn("⚠️ Redis не установлен");
/*  }
/*}
/*
/*async function initRedis() {
/*  if (!USE_REDIS || !redis) return;
/*
/*  try {
/*    redisClient = redis.createClient({
/*      socket: {
/*        host: process.env.REDIS_HOST,
/*        port: Number(process.env.REDIS_PORT),
/*      },
/*    });
/*
/*    redisClient.on("error", (err) =>
/*      console.error("❌ Redis error:", err.message)
/*    );
/*
/*    await redisClient.connect();
/*    console.log("✅ Redis connected");
/*  } catch {
/*    redisClient = null;
/*    console.warn("⚠️ Redis недоступен, rate-limit отключён");
/*  }
/*}
/*
/* ============================================================
/*UTILS
/*============================================================ */
/*
/*const getClientIp = (req) => {
/*  return (
/*    req.headers["cf-connecting-ip"] ||
/*    req.headers["x-forwarded-for"]?.split(",")[0] ||
/*    req.socket.remoteAddress ||
/*    "unknown"
/*  );
/*};
/*
/* ============================================================
/*RATE LIMIT
/*============================================================ */
/*
/*const RATE_LIMIT_MAX = Number(process.env.RATE_LIMIT_MAX);
/*const RATE_LIMIT_WINDOW = Number(process.env.RATE_LIMIT_WINDOW_MS);
/*const SLOW_AFTER = Number(process.env.SLOW_DOWN_AFTER);
/*const SLOW_DELAY = Number(process.env.SLOW_DOWN_DELAY_MS);
/*
/*const SKIP_RATE_LIMIT_PATHS = [
/*  "/uploads",
/*  "/api/gallery",
/*  "/api/gallery-filters",
/*  "/api/video",
/*  "/api/events",
/*  "/api/teams",
/*];
/*
/*app.use(async (req, res, next) => {
/*  try {
/*    if (
/*      SKIP_RATE_LIMIT_PATHS.some((p) => req.path.startsWith(p))
/*    ) {
/*      return next();
/*    }
/*
/*    if (!redisClient || !redisClient.isOpen) return next();
/*
/*    const key = `ratelimit:${getClientIp(req)}`;
/*    const count = await redisClient.incr(key);
/*
/*    if (count === 1) {
/*      await redisClient.expire(key, RATE_LIMIT_WINDOW / 1000);
/*    }
/*
/*    if (count > RATE_LIMIT_MAX) {
/*      return res.status(429).json({
/*        success: false,
/*        message: "Слишком много запросов",
/*      });
/*    }
/*
/*    if (count > SLOW_AFTER) {
/*      await new Promise((r) =>
/*        setTimeout(r, (count - SLOW_AFTER) * SLOW_DELAY)
/*      );
/*    }
/*
/*    next();
/*  } catch (err) {
/*    console.error("Rate-limit error:", err.message);
/*    next();
/*  }
/*});

/* ============================================================
ROUTES
============================================================ */

app.use("/api", photosRouter);

/* ============================================================
START
============================================================ */

async function start() {
  try {
    await sequelize.authenticate();
    await sequelize.sync();
    console.log("✅ PostgreSQL connected");

    /*await initRedis();*/

    try {
      bot.launch();
      console.log("✅ Telegram bot started");
    } catch (e) {
      console.warn("⚠️ Bot error:", e.message);
    }

    app.listen(PORT, "0.0.0.0", () =>
      console.log(`🚀 Server running on ${PORT}`)
    );
  } catch (err) {
    console.error("❌ Startup error:", err);
    process.exit(1);
  }
}

start();
