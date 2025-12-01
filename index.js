const express = require("express");
const cors = require("cors");
const path = require("path");
const { exec } = require("child_process");
const util = require("util");
const os = require("os");
const sequelize = require("./config/db");
const photosRouter = require("./routes/router.js");
const bot = require("./bot/bot");
require("dotenv").config();

const app = express();
const execPromise = util.promisify(exec);

const allowedOrigins = ["https://bandana-dance.ru"];

app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin) return callback(null, true);

      if (allowedOrigins.indexOf(origin) === -1) {
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
console.log("Обслуживаю статику из:", uploadsPath); // ← посмотри в консоль!
app.use("/uploads", express.static(uploadsPath));
app.use("/api", photosRouter);

// Проверяем, установлен ли PostgreSQL
async function isPostgresInstalled() {
  try {
    await execPromise("pg_isready --version", { stdio: "ignore" });
    return true;
  } catch {
    try {
      await execPromise("postgres --version", { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  }
}

// Автоматическая установка PostgreSQL на Linux, если его нет
async function ensurePostgresOnLinux() {
  const platform = os.platform();

  if (platform !== "linux") {
    console.log(`ОС: ${platform} — автоустановка PostgreSQL не поддерживается`);
    return;
  }

  console.log("Проверка наличия PostgreSQL...");

  const installed = await isPostgresInstalled();

  if (installed) {
    console.log("PostgreSQL уже установлен");
    return;
  }

  console.log("PostgreSQL не найден → запускаем установку...");

  try {
    const { stdout, stderr } = await execPromise(
      "bash ./scripts/setup_postgres_linux.sh",
      {
        timeout: 600000, // 10 минут
      }
    );

    console.log("PostgreSQL успешно установлен!");
    console.log(stdout);
    if (stderr) console.warn("Предупреждения:", stderr);

    console.log("Ждём 10 секунд, чтобы служба PostgreSQL запустилась...");
    await new Promise((resolve) => setTimeout(resolve, 10000));
  } catch (err) {
    console.error("ОШИБКА: Не удалось установить PostgreSQL автоматически");
    console.error(err.message);
    console.error(
      "Установи вручную: sudo apt update && sudo apt install postgresql"
    );
    process.exit(1);
  }
}

const start = async () => {
  try {
    // Установка PostgreSQL (только Linux + если нет)
    await ensurePostgresOnLinux();

    // Подключение к БД
    console.log("Подключение к PostgreSQL...");
    await sequelize.authenticate();
    console.log("Подключение к БД успешно!");

    // Синхронизация моделей
    await sequelize.sync({ alter: process.env.NODE_ENV !== "production" });
    console.log("Таблицы синхронизированы");

    // bot.launch(); // раскомментируй, когда будешь готов

    const PORT = process.env.PORT || 3001;
    app.listen(PORT, () => {
      console.log(`Сервер запущен на http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error("Сервер не запустился:", err.message);

    if (err.name?.includes("Sequelize")) {
      console.error("\nПроверь:");
      console.error("  • sudo systemctl status postgresql");
      console.error("  • Правильные ли данные в .env?");
      console.error("  • Создан ли пользователь БД?");
    }

    process.exit(1);
  }
};

start();
