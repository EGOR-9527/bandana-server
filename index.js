require("dotenv").config();

const express = require("express");
const cors = require("cors");
const path = require("path");

const sequelize = require("./config/db");
const router = require("./routes/router");
const { startMessageMonitor } = require("./bot/messageMonitor");

const app = express();
const PORT = Number(process.env.PORT) || 5000;

/* ============================================================
CORS
============================================================ */

app.use(
  cors({
    origin: "https://bandana-dance.ru",
  })
);

/* ============================================================
MIDDLEWARE
============================================================ */

app.use(express.json({ limit: "50mb" }));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// Логирование запросов
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
  next();
});

/* ============================================================
ROUTES
============================================================ */

app.use("/api", router);

// Проверка здоровья сервера
app.get("/health", (req, res) => {
  res.status(200).json({ 
    status: "OK", 
    timestamp: new Date().toISOString(),
    services: {
      database: "connected",
      telegram_monitor: "running",
      api: "operational"
    }
  });
});

// Статус монитора Telegram
app.get("/api/telegram-monitor/status", (req, res) => {
  res.status(200).json({
    success: true,
    message: "Telegram message monitor is running",
    timestamp: new Date().toISOString()
  });
});

// Обработка 404
app.use((req, res) => {
  res.status(404).json({ 
    success: false, 
    message: "Route not found" 
  });
});

// Обработка ошибок
app.use((err, req, res, next) => {
  console.error("Server error:", err.stack);
  res.status(500).json({ 
    success: false, 
    message: "Internal server error" 
  });
});

/* ============================================================
START
============================================================ */

async function start() {
  try {
    // Подключение к базе данных
    await sequelize.authenticate();
    console.log("✅ PostgreSQL connected");
    
    // Синхронизация базы данных (alter вместо force)
    await sequelize.sync({ alter: true });
    console.log("✅ Database synced");

    // Запуск монитора сообщений Telegram
    console.log("🔄 Запуск Telegram Message Monitor...");
    await startMessageMonitor();
    console.log("✅ Telegram Message Monitor started");

    // Запуск сервера
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`🚀 Server running on port ${PORT}`);
      console.log(`📡 Health check: http://localhost:${PORT}/health`);
      console.log(`📱 Telegram Monitor status: http://localhost:${PORT}/api/telegram-monitor/status`);
    });

    // Обработка завершения работы
    process.on('SIGINT', async () => {
      console.log("\n🛑 Получен сигнал завершения...");
      console.log("👋 До свидания!");
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      console.log("\n🛑 Получен сигнал терминации...");
      console.log("👋 До свидания!");
      process.exit(0);
    });

  } catch (err) {
    console.error("❌ Startup error:", err);
    process.exit(1);
  }
}

start();