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
    origin: ALLOWED_ORIGINS,
    credentials: true,
  })
);

/* ============================================================
Compression
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

// Логирование
app.use((req, res, next) => {
  console.log(`${new Date().toLocaleTimeString()} ${req.method} ${req.url}`);
  next();
});

/* ============================================================
Routes
============================================================ */

app.use("/api", photosRouter);

// Health check
app.get("/health", (req, res) => {
  res.json({ 
    status: "OK", 
    time: new Date().toISOString(),
    service: "bandana-server"
  });
});

// Test endpoint
app.get("/api/test", (req, res) => {
  res.json({
    success: true,
    message: "Сервер работает",
    timestamp: Date.now()
  });
});

/* ============================================================
Error handling
============================================================ */

app.use((err, req, res, next) => {
  console.error('❌ Ошибка сервера:', err.message);
  res.status(500).json({
    success: false,
    message: "Внутренняя ошибка сервера"
  });
});

/* ============================================================
Start server
============================================================ */

async function start() {
  try {
    // Подключаем базу данных
    await sequelize.authenticate();
    console.log("✅ PostgreSQL подключена");

    // Запускаем бота
    try {
      await bot.start();
      console.log("✅ Telegram-бот запущен");
    } catch (e) {
      console.error("⚠️ Ошибка Telegram-бота:", e.message);
    }

    // Запускаем сервер
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`🚀 Сервер запущен на порту ${PORT}`);
      console.log(`📦 Сжатие GZIP: включено`);
      console.log(`🌐 Разрешенные домены: ${ALLOWED_ORIGINS.join(', ')}`);
      console.log(`📍 Health check: http://localhost:${PORT}/health`);
      console.log(`📍 API Test: http://localhost:${PORT}/api/test`);
    });
  } catch (err) {
    console.error("❌ Критическая ошибка запуска:", err);
    process.exit(1);
  }
}

// Обработка необработанных ошибок
process.on('uncaughtException', (err) => {
  console.error('💥 Необработанная ошибка:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('💥 Необработанный промис:', reason);
});

start();