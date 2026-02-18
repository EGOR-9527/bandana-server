require("dotenv").config();

require("./models/user");
require("./models/chat");
require("./models/message");

const express = require("express");
const cors = require("cors");
const path = require("path");
const { startMessageMonitor } = require("./bot/utils/messageMonitor");

const sequelize = require("./config/db");
const router = require("./routes/router");
const bot = require("./bot/bot");

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
    await sequelize.authenticate();
    console.log("✅ PostgreSQL connected");
    
    // Не используйте force: true на продакшене
    await sequelize.sync({ alter: true });
    console.log("✅ Database synced");

    // Запуск бота (если нужен)
    if (bot && typeof bot.launch === "function") {
      bot.launch();
      console.log("✅ Telegram bot started");
    }

    console.log("🔄 Запуск Telegram Message Monitor...");
    await startMessageMonitor()

    app.listen(PORT, "0.0.0.0", () => {
      console.log(`🚀 Server running on port ${PORT}`);
      console.log(`📡 Health check: http://localhost:${PORT}/health`);
    });
  } catch (err) {
    console.error("❌ Startup error:", err);
    process.exit(1);
  }
}

start();