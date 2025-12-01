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
    origin: (origin, cb) => {
      if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
      return cb(new Error(`CORS ошибка: ${origin} не разрешён`), false);
    },
    credentials: true,
  })
);

app.use(express.json());

app.use("/uploads", express.static(path.resolve(__dirname, "uploads")));
app.use("/api", photosRouter);

const start = async () => {
  try {
    console.log("bot object:", bot);
    console.log("bot.launch:", bot.launch);

    console.log("Подключение к PostgreSQL...");
    await sequelize.authenticate();
    console.log("Подключение к БД успешно!");

    await sequelize.sync({ alter: process.env.NODE_ENV !== "production" });
    console.log("Таблицы синхронизированы");

    bot.start()

    console.log("Бот запущен");

    const PORT = process.env.PORT || 3001;
    app.listen(PORT, () =>
      console.log(`Сервер запущен на http://localhost:${PORT}`)
    );
  } catch (err) {
    console.error("Сервер не запустился:", err.message);
    process.exit(1);
  }
};

start();
