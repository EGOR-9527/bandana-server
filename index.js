const express = require("express");
const cors = require("cors");
const path = require("path");
const sequelize = require("./config/db");
const photosRouter = require("./routes/router");
const bot = require("./bot/bot");
require("dotenv").config();

const app = express();

const allowedOrigins = ["https://bandana-dance.ru"];
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (!allowedOrigins.includes(origin)) {
        const msg = `CORS ошибка: ${origin} не разрешён`;
        return callback(new Error(msg), false);
      }
      return callback(null, true);
    },
    credentials: true,
  })
);

app.use(express.json());

const uploadsPath = path.resolve(__dirname, "uploads");
console.log("Обслуживаю статику из:", uploadsPath);
app.use("/uploads", express.static(uploadsPath));

app.use("/api", photosRouter);

const start = async () => {
  try {
    console.log("Подключение к PostgreSQL...");
    await sequelize.authenticate();
    console.log("Подключение к БД успешно!");

    await sequelize.sync({ alter: process.env.NODE_ENV !== "production" });
    console.log("Таблицы синхронизированы");

    console.log(bot);
    console.log(typeof bot.launch);

    await bot.launch();
    console.log("Бот запущен");

    const PORT = process.env.PORT || 3001;
    app.listen(PORT, () => {
      console.log(`Сервер запущен на http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error("Сервер не запустился:", err.message);
    process.exit(1);
  }
};

start();
