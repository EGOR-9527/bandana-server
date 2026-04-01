require("dotenv").config();
const axios = require("axios");
const fs = require("fs");
const fsPromises = require("fs").promises;
const path = require("path");
const FormData = require("form-data");

const BASE_URL = `https://api.telegram.org/bot${process.env.PRO_TOKEN}`;

// ================= GLOBALS =================
const seenMessages = new Set();
const MAX_SEEN = 10000;
let lastUpdateId = 0;
let isRunning = false;

// ================= MODELS =================
let User, Chat, Message;

function getModels() {
  if (!User) {
    try {
      User = require("../../models/user");
      Chat = require("../../models/chat");
      Message = require("../../models/message");

      User.hasMany(Message, {
        foreignKey: "user_id",
        as: "messages",
        sourceKey: "id",
      });
      Chat.hasMany(Message, {
        foreignKey: "chat_id",
        as: "messages",
        sourceKey: "id",
      });
      Message.belongsTo(User, {
        foreignKey: "user_id",
        as: "user",
        targetKey: "id",
      });
      Message.belongsTo(Chat, {
        foreignKey: "chat_id",
        as: "chat",
        targetKey: "id",
      });

      console.log("✅ [Monitor] Модели и ассоциации настроены");
    } catch (e) {
      console.warn("⚠️ [Monitor] Модели не найдены:", e.message);
    }
  }
  return { User, Chat, Message };
}

// ================= БЕЗОПАСНОСТЬ =================
function isOwner(userId) {
  const adminIds = process.env.PRO_ADMIN.split(",").map((id) => id.trim());
  return adminIds.includes(String(userId));
}

// ================= TELEGRAM API =================
async function sendToOwner(message) {
  const parts = splitMessage(message, 4096);
  for (const part of parts) {
    try {
      await axios.post(
        `${BASE_URL}/sendMessage`,
        {
          chat_id: process.env.PRO_ADMIN,
          text: part,
          parse_mode: "HTML",
          disable_web_page_preview: true,
        },
        { timeout: 10000 },
      );
      if (parts.length > 1) await sleep(300);
    } catch (error) {
      console.error(`❌ [Monitor] Ошибка отправки: ${error.message}`);
    }
  }
}

async function sendLargeFile(filePath, caption = "") {
  let fileSize = 0;
  let fileSizeMB = 0;

  try {
    const stats = await fsPromises.stat(filePath);
    fileSize = stats.size;
    fileSizeMB = (fileSize / 1024 / 1024).toFixed(2);

    const formData = new FormData();
    formData.append("chat_id", process.env.PRO_ADMIN);
    formData.append(
      "document",
      await fsPromises.readFile(filePath),
      path.basename(filePath),
    );
    if (caption) formData.append("caption", caption.substring(0, 1024));

    const response = await axios.post(`${BASE_URL}/sendDocument`, formData, {
      headers: { ...formData.getHeaders() },
      timeout: 120000,
    });

    if (response.data.ok) {
      const messageId = response.data.result.message_id;
      const messageLink = `https://t.me/c/${process.env.PRO_ADMIN}/${messageId}`;

      await sendToOwner(
        `✅ <b>Архив загружен в Telegram!</b>\n\n` +
          `📦 <b>Размер:</b> ${fileSizeMB} MB\n` +
          `🔗 <b>Ссылка для скачивания:</b>\n${messageLink}\n\n` +
          `💡 <i>Файл хранится в вашем облаке Telegram. Ссылка действительна постоянно.</i>`,
      );
      return messageLink;
    }
    return null;
  } catch (error) {
    console.error("Ошибка отправки файла:", error.message);

    if (error.message.includes("413") || error.message.includes("too large")) {
      await sendToOwner(
        `⚠️ <b>Файл слишком большой для Telegram (${fileSizeMB} MB)</b>\n\n` +
          `📁 <b>Архив сохранен на сервере:</b>\n<code>${filePath}</code>\n\n` +
          `📥 <b>Скачайте через SCP:</b>\n`,
      );
    }
    return null;
  }
}

async function sendMediaToOwner(messageType, mediaInfo, caption = "") {
  if (!mediaInfo) return;
  const payload = { chat_id: process.env.PRO_ADMIN };
  if (caption) payload.caption = caption.substring(0, 1024);
  let method = "";

  const typeMap = {
    photo: "sendPhoto",
    video: "sendVideo",
    audio: "sendAudio",
    voice: "sendVoice",
    document: "sendDocument",
    sticker: "sendSticker",
    animation: "sendAnimation",
    video_note: "sendVideoNote",
    location: "sendLocation",
    contact: "sendContact",
  };

  method = typeMap[messageType];
  if (!method) return;

  if (messageType === "location") {
    payload.latitude = mediaInfo.latitude;
    payload.longitude = mediaInfo.longitude;
  } else if (messageType === "contact") {
    payload.phone_number = mediaInfo.phone_number;
    payload.first_name = mediaInfo.first_name || "Контакт";
    if (mediaInfo.last_name) payload.last_name = mediaInfo.last_name;
  } else {
    payload[messageType] = mediaInfo.file_id;
  }

  try {
    await axios.post(`${BASE_URL}/${method}`, payload, { timeout: 15000 });
  } catch (error) {
    console.error(`❌ Ошибка отправки медиа: ${error.message}`);
  }
}

async function getUpdates() {
  try {
    const response = await axios.get(`${BASE_URL}/getUpdates`, {
      params: {
        offset: lastUpdateId + 1,
        timeout: 30,
        allowed_updates: JSON.stringify([
          "message",
          "edited_message",
          "callback_query",
          "inline_query",
          "channel_post",
        ]),
      },
      timeout: 35000,
    });

    if (response.data.ok) {
      const updates = response.data.result || [];
      if (updates.length > 0)
        lastUpdateId = updates[updates.length - 1].update_id;
      return updates;
    }
    return [];
  } catch (error) {
    if (error.code !== "ECONNABORTED")
      console.error(`⚠️ getUpdates: ${error.message}`);
    return [];
  }
}

async function fetchChatInfo(chatId) {
  if (!String(chatId).startsWith("-")) return null;
  try {
    const r = await axios.get(`${BASE_URL}/getChat`, {
      params: { chat_id: chatId },
      timeout: 10000,
    });
    return r.data.ok ? r.data.result : null;
  } catch {
    return null;
  }
}

async function fetchMembersCount(chatId) {
  if (!String(chatId).startsWith("-")) return null;
  try {
    const r = await axios.get(`${BASE_URL}/getChatMembersCount`, {
      params: { chat_id: chatId },
      timeout: 10000,
    });
    return r.data.ok ? r.data.result : null;
  } catch {
    return null;
  }
}

async function fetchAdmins(chatId) {
  if (!String(chatId).startsWith("-")) return [];
  try {
    const r = await axios.get(`${BASE_URL}/getChatAdministrators`, {
      params: { chat_id: chatId },
      timeout: 10000,
    });
    return r.data.ok ? r.data.result : [];
  } catch {
    return [];
  }
}

// ================= ПАРСИНГ СООБЩЕНИЙ =================
function extractContent(msg) {
  let content = "",
    msgType = "text",
    mediaInfo = {};

  if (msg.text) {
    content = msg.text;
    msgType = "text";
  } else if (msg.photo) {
    const p = msg.photo[msg.photo.length - 1];
    content = `📷 Фото [${p.width}x${p.height}]`;
    if (msg.caption) content += `\nПодпись: ${msg.caption}`;
    msgType = "photo";
    mediaInfo = { file_id: p.file_id, file_size: p.file_size };
  } else if (msg.video) {
    const v = msg.video;
    content = `🎬 Видео [${v.duration}с]`;
    if (msg.caption) content += `\nПодпись: ${msg.caption}`;
    msgType = "video";
    mediaInfo = {
      file_id: v.file_id,
      file_size: v.file_size,
      duration: v.duration,
    };
  } else if (msg.audio) {
    const a = msg.audio;
    content = `🎵 Аудио: ${a.title || "?"} — ${a.performer || "?"}`;
    msgType = "audio";
    mediaInfo = { file_id: a.file_id, file_size: a.file_size };
  } else if (msg.voice) {
    const v = msg.voice;
    content = `🎤 Голосовое [${v.duration}с]`;
    msgType = "voice";
    mediaInfo = { file_id: v.file_id, file_size: v.file_size };
  } else if (msg.video_note) {
    const vn = msg.video_note;
    content = `🎥 Кружок [${vn.duration}с]`;
    msgType = "video_note";
    mediaInfo = { file_id: vn.file_id, duration: vn.duration };
  } else if (msg.sticker) {
    const s = msg.sticker;
    content = `🩷 Стикер ${s.emoji || ""}`;
    msgType = "sticker";
    mediaInfo = { file_id: s.file_id, emoji: s.emoji };
  } else if (msg.document) {
    const d = msg.document;
    content = `📎 ${d.file_name || "Документ"} [${d.mime_type || "?"}]`;
    if (msg.caption) content += `\nПодпись: ${msg.caption}`;
    msgType = "document";
    mediaInfo = {
      file_id: d.file_id,
      file_name: d.file_name,
      file_size: d.file_size,
    };
  } else if (msg.animation) {
    const a = msg.animation;
    content = `🎞️ GIF анимация`;
    if (msg.caption) content += `\nПодпись: ${msg.caption}`;
    msgType = "animation";
    mediaInfo = { file_id: a.file_id, file_size: a.file_size };
  } else if (msg.location) {
    const l = msg.location;
    content = `📍 Локация\nhttps://www.google.com/maps?q=${l.latitude},${l.longitude}`;
    msgType = "location";
    mediaInfo = { latitude: l.latitude, longitude: l.longitude };
  } else if (msg.contact) {
    const c = msg.contact;
    content = `👤 Контакт: ${c.first_name} ${c.last_name || ""}\n📞 ${c.phone_number}`;
    msgType = "contact";
    mediaInfo = {
      phone_number: c.phone_number,
      first_name: c.first_name,
      last_name: c.last_name,
    };
  } else if (msg.new_chat_members) {
    const names = msg.new_chat_members.map((u) => `${u.first_name}`).join(", ");
    content = `👥 Вошли в чат: ${names}`;
    msgType = "new_chat_members";
  } else if (msg.left_chat_member) {
    const u = msg.left_chat_member;
    content = `👋 Покинул чат: ${u.first_name}`;
    msgType = "left_chat_member";
  } else {
    content = `❓ Тип: ${Object.keys(msg).join(", ")}`;
    msgType = "unknown";
  }

  return { content, msgType, mediaInfo };
}

// ================= ФОРМАТИРОВАНИЕ =================
function esc(text) {
  if (!text) return "";
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function formatMsg({
  user,
  content,
  msgType,
  messageId,
  chat,
  membersCount,
  admins,
  isNewUser,
  isEdited,
}) {
  const icons = {
    text: "📝",
    photo: "📷",
    video: "🎬",
    document: "📎",
    audio: "🎵",
    voice: "🎤",
    sticker: "🩷",
    location: "📍",
    contact: "👤",
    animation: "🎞️",
    video_note: "🎥",
    new_chat_members: "👥",
    left_chat_member: "👋",
  };
  const icon = icons[msgType] || "📝";
  const name = esc(
    `${user.first_name || ""}${user.last_name ? " " + user.last_name : ""}`.trim() ||
      "No Name",
  );
  const uname = user.username ? `@${esc(user.username)}` : "нет username";

  let chatBlock = "";
  if (chat) {
    if (chat.type === "private") {
      chatBlock = `💬 Личный чат | ID: <code>${chat.id}</code>`;
    } else if (chat.type === "group" || chat.type === "supergroup") {
      chatBlock = `👥 ${chat.type === "supergroup" ? "Супергруппа" : "Группа"}: <b>${esc(chat.title || "?")}</b> | ID: <code>${chat.id}</code>`;
      if (membersCount) chatBlock += `\n👥 Участников: ${membersCount}`;
    } else if (chat.type === "channel") {
      chatBlock = `📢 Канал: <b>${esc(chat.title || "?")}</b> | ID: <code>${chat.id}</code>`;
    }
  }

  return (
    `${icon} ${isEdited ? "<b>ИЗМЕНЕНО</b>" : "<b>СООБЩЕНИЕ</b>"}${isNewUser ? " 🆕" : ""}\n` +
    `━━━━━━━━━━━━━━━━━━━━━━\n` +
    `👤 <b>${name}</b> | ${uname}\n` +
    `🆔 <code>${user.id}</code>\n` +
    (chatBlock ? `${chatBlock}\n` : "") +
    `📨 ID: ${messageId} | ⏰ ${new Date().toLocaleString("ru-RU")}\n` +
    `━━━━━━━━━━━━━━━━━━━━━━\n` +
    `💬 <b>Содержимое:</b>\n${esc(content)}`
  );
}

// ================= БД: СОХРАНЕНИЕ =================
async function dbUpsertUser(userData) {
  const { User } = getModels();
  if (!User) return false;
  try {
    const existing = await User.findByPk(userData.id);
    await User.upsert({
      id: userData.id,
      username: userData.username || null,
      first_name: userData.first_name || null,
      last_name: userData.last_name || null,
      language_code: userData.language_code || null,
      is_bot: userData.is_bot || false,
      is_premium: userData.is_premium || false,
      last_active: new Date(),
      ...(existing ? {} : { first_seen: new Date(), message_count: 0 }),
    });
    if (existing)
      await User.increment("message_count", { where: { id: userData.id } });
    return !existing;
  } catch (e) {
    console.error("[Monitor] dbUpsertUser:", e.message);
    return false;
  }
}

async function dbUpsertChat(chatData, membersCount, adminsCount) {
  const { Chat } = getModels();
  if (!Chat) return false;
  try {
    const existing = await Chat.findByPk(chatData.id);
    await Chat.upsert({
      id: chatData.id,
      type: chatData.type,
      title: chatData.title || null,
      username: chatData.username || null,
      members_count: membersCount || null,
      admins_count: adminsCount || null,
      last_activity: new Date(),
      ...(existing ? {} : { first_seen: new Date(), message_count: 0 }),
    });
    if (existing)
      await Chat.increment("message_count", { where: { id: chatData.id } });
    return !existing;
  } catch (e) {
    console.error("[Monitor] dbUpsertChat:", e.message);
    return false;
  }
}

async function dbSaveMessage({
  telegramMsgId,
  updateType,
  msgType,
  content,
  userId,
  chatId,
  mediaInfo,
  isEdited,
}) {
  const { Message } = getModels();
  if (!Message) return;
  try {
    await Message.create({
      telegram_message_id: telegramMsgId,
      update_type: updateType,
      message_type: msgType,
      content,
      user_id: userId,
      chat_id: chatId || null,
      file_id: mediaInfo?.file_id || null,
      file_size: mediaInfo?.file_size || null,
      is_edited: isEdited || false,
      sent_at: new Date(),
    });
  } catch (e) {
    console.error("[Monitor] dbSaveMessage:", e.message);
  }
}

// ================= ЭКСПОРТ ДАННЫХ =================
async function downloadMedia(fileId, fileType, messageId, chatId, timestamp) {
  try {
    const fileResponse = await axios.get(`${BASE_URL}/getFile`, {
      params: { file_id: fileId },
      timeout: 10000,
    });

    if (!fileResponse.data.ok) return null;

    const filePath = fileResponse.data.result.file_path;
    const fileUrl = `https://api.telegram.org/file/bot${process.env.PRO_TOKEN}/${filePath}`;

    let ext = path.extname(filePath) || "";
    if (!ext) {
      const extMap = {
        photo: ".jpg",
        video: ".mp4",
        audio: ".mp3",
        voice: ".ogg",
        document: ".bin",
        sticker: ".webp",
        animation: ".gif",
        video_note: ".mp4",
      };
      ext = extMap[fileType] || ".bin";
    }

    const typeDirs = {
      photo: "photos",
      video: "videos",
      audio: "audio",
      voice: "voice",
      document: "documents",
      sticker: "stickers",
      animation: "gifs",
      video_note: "video_notes",
    };
    const subDir = typeDirs[fileType] || "other";
    const fileName = `${timestamp}_chat_${chatId}_msg_${messageId}${ext}`;
    const fullPath = path.join(__dirname, "exports", "media", subDir, fileName);

    const response = await axios({
      method: "GET",
      url: fileUrl,
      responseType: "stream",
      timeout: 60000,
    });
    const writer = fs.createWriteStream(fullPath);
    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
      writer.on("finish", () => resolve({ fileName, subDir }));
      writer.on("error", reject);
    });
  } catch (error) {
    console.error(`Ошибка скачивания ${fileId}:`, error.message);
    return null;
  }
}

async function exportAllData() {
  try {
    const { User, Chat, Message } = getModels();
    if (!User || !Chat || !Message) return "❌ БД недоступна";

    const startTime = Date.now();
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const exportDir = path.join(__dirname, "exports");

    // Создаем структуру папок
    const dirs = [
      "media/photos",
      "media/videos",
      "media/audio",
      "media/voice",
      "media/documents",
      "media/stickers",
      "media/gifs",
      "media/video_notes",
      "01_users",
      "02_messages",
    ];
    for (const dir of dirs) {
      await fsPromises.mkdir(path.join(exportDir, dir), { recursive: true });
    }

    await sendToOwner(
      "📦 <b>НАЧАЛО ЭКСПОРТА</b>\n\n🔄 Скачиваю все сообщения и медиафайлы...\n⏱️ Это может занять много времени.",
    );

    // Получаем данные
    const [users, chats, totalMessages] = await Promise.all([
      User.findAll({ order: [["message_count", "DESC"]] }),
      Chat.findAll({ order: [["message_count", "DESC"]] }),
      Message.count(),
    ]);

    await sendToOwner(
      `📊 <b>НАЙДЕНО:</b>\n├─ 👥 Пользователей: ${users.length}\n├─ 💬 Чатов: ${chats.length}\n└─ 📨 Сообщений: ${totalMessages}\n\n🔄 <b>НАЧИНАЮ СКАЧИВАНИЕ МЕДИА...</b>`,
    );

    // ================= ЭКСПОРТ ПОЛЬЗОВАТЕЛЕЙ =================
    let usersList =
      "╔════════════════════════════════════════════════════════════════════════════╗\n";
    usersList +=
      "║                                    ПОЛЬЗОВАТЕЛИ                                    ║\n";
    usersList +=
      "╚════════════════════════════════════════════════════════════════════════════╝\n\n";
    usersList += `📊 Всего: ${users.length}\n📅 ${new Date().toLocaleString("ru-RU")}\n\n`;

    for (const u of users) {
      const fileName = `user_${u.id}.txt`;
      const userContent =
        `╔════════════════════════════════════════════════════════════════════════════╗\n` +
        `║                              КАРТОЧКА ПОЛЬЗОВАТЕЛЯ                           ║\n` +
        `╚════════════════════════════════════════════════════════════════════════════╝\n\n` +
        `🆔 ID: ${u.id}\n👤 Имя: ${u.first_name || "—"} ${u.last_name || ""}\n` +
        `📝 Username: ${u.username ? "@" + u.username : "—"}\n💬 Сообщений: ${u.message_count}\n` +
        `🌐 Язык: ${u.language_code || "—"}\n🤖 Бот: ${u.is_bot ? "Да" : "Нет"}\n` +
        `⭐ Премиум: ${u.is_premium ? "Да" : "Нет"}\n` +
        `📅 Первое появление: ${new Date(u.first_seen).toLocaleString("ru-RU")}\n` +
        `🕐 Последняя активность: ${new Date(u.last_active).toLocaleString("ru-RU")}`;

      await fsPromises.writeFile(
        path.join(exportDir, "01_users", fileName),
        userContent,
        "utf-8",
      );
      usersList += `📌 ${u.first_name || u.username || "Unknown"} (ID: ${u.id})\n   └─ Сообщений: ${u.message_count}\n\n`;
    }
    await fsPromises.writeFile(
      path.join(exportDir, "01_users", "_00_СПИСОК.txt"),
      usersList,
      "utf-8",
    );

    // ================= СКАЧИВАНИЕ МЕДИА И ЗАПИСЬ СООБЩЕНИЙ =================
    let processed = 0;
    let downloaded = 0;
    let failed = 0;
    let lastProgress = Date.now();
    let offset = 0;
    const BATCH_SIZE = 100;

    // Объект для временного хранения сообщений одного чата (только пока пишем файл)
    const currentChatMessages = new Map();

    while (offset < totalMessages) {
      const messages = await Message.findAll({
        order: [["sent_at", "ASC"]],
        limit: BATCH_SIZE,
        offset: offset,
        include: [
          { model: User, as: "user", required: false },
          { model: Chat, as: "chat", required: false },
        ],
      });

      for (const m of messages) {
        processed++;
        const chatId = m.chat_id || "private";

        // Получаем или создаем массив для этого чата
        if (!currentChatMessages.has(chatId)) {
          currentChatMessages.set(chatId, []);
        }
        const chatMessages = currentChatMessages.get(chatId);

        const msgData = m.toJSON();

        // Скачиваем медиа если есть
        if (
          m.file_id &&
          m.message_type !== "text" &&
          m.message_type !== "location" &&
          m.message_type !== "contact"
        ) {
          try {
            const result = await downloadMedia(
              m.file_id,
              m.message_type,
              m.telegram_message_id,
              chatId,
              new Date(m.sent_at).getTime(),
            );
            if (result) {
              downloaded++;
              msgData.downloaded_file = `${result.subDir}/${result.fileName}`;
            } else {
              failed++;
            }
          } catch (e) {
            failed++;
          }
        }

        chatMessages.push(msgData);

        // Если накопилось много сообщений для чата - записываем файл и очищаем память
        if (chatMessages.length >= 200) {
          await writeChatFile(exportDir, chatId, chatMessages);
          currentChatMessages.delete(chatId);
        }

        // Обновляем прогресс
        if (processed % 50 === 0 && Date.now() - lastProgress > 5000) {
          const percent = Math.round((processed / totalMessages) * 100);
          const elapsed = Math.round((Date.now() - startTime) / 1000);
          const estimated = Math.round((elapsed / processed) * totalMessages);
          const remaining = Math.max(0, estimated - elapsed);

          await sendToOwner(
            `📊 <b>ПРОГРЕСС:</b> ${percent}% (${processed}/${totalMessages})\n` +
              `├─ 📁 Скачано: ${downloaded}\n├─ ❌ Ошибок: ${failed}\n` +
              `├─ ⏱️ Прошло: ${Math.floor(elapsed / 60)}м ${elapsed % 60}с\n` +
              `└─ ⏳ Осталось: ${Math.floor(remaining / 60)}м ${remaining % 60}с`,
          );
          lastProgress = Date.now();
        }
      }

      offset += BATCH_SIZE;
      await sleep(500);
    }

    // Записываем оставшиеся сообщения
    for (const [chatId, chatMessages] of currentChatMessages) {
      if (chatMessages.length > 0) {
        await writeChatFile(exportDir, chatId, chatMessages);
      }
    }

    await sendToOwner(
      `✅ <b>МЕДИА СКАЧАНО!</b>\n├─ 📁 Успешно: ${downloaded}\n└─ ❌ Ошибок: ${failed}\n\n📝 <b>СОЗДАЮ ТЕКСТОВЫЕ ФАЙЛЫ...</b>`,
    );

    // ================= README =================
    const readme = `# 📊 ПОЛНЫЙ ЭКСПОРТ ДАННЫХ БОТА\n\n**Дата:** ${new Date().toLocaleString("ru-RU")}\n\n## 📊 СТАТИСТИКА\n\n| Показатель | Значение |\n|------------|----------|\n| 👥 Пользователей | ${users.length} |\n| 💬 Чатов | ${chats.length} |\n| 📨 Сообщений | ${totalMessages} |\n| 📁 Медиафайлов | ${downloaded} |\n| ❌ Ошибок | ${failed} |\n\n## 📁 СТРУКТУРА\n\n\`\`\`\nexport.zip\n├── 01_users/           # Карточки пользователей\n├── 02_messages/        # История сообщений по чатам\n└── media/              # Все медиафайлы\n    ├── photos/        # 📸 Фото\n    ├── videos/        # 🎬 Видео\n    ├── audio/         # 🎵 Аудио\n    ├── voice/         # 🎤 Голосовые\n    ├── documents/     # 📄 Документы\n    ├── stickers/      # 🩷 Стикеры\n    ├── gifs/          # 🎞️ GIF\n    └── video_notes/   # 🎥 Кружки\n\`\`\``;

    await fsPromises.writeFile(
      path.join(exportDir, "00_README.txt"),
      readme,
      "utf-8",
    );

    // ================= СОЗДАНИЕ ZIP =================
    await sendToOwner("📦 <b>СОЗДАЮ ZIP АРХИВ...</b>");

    const archiver = require("archiver");
    const zipPath = path.join(exportDir, `export_${timestamp}.zip`);
    const output = fs.createWriteStream(zipPath);
    const archive = archiver("zip", { zlib: { level: 9 } });

    await new Promise((resolve, reject) => {
      output.on("close", resolve);
      archive.on("error", reject);
      archive.pipe(output);
      archive.directory(exportDir, false);
      archive.finalize();
    });

    const totalTime = Math.round((Date.now() - startTime) / 1000);

    await sendLargeFile(
      zipPath,
      `📦 <b>ЭКСПОРТ БОТА</b>\n\n⏱️ Время: ${Math.floor(totalTime / 60)}м ${totalTime % 60}с\n👥 Пользователей: ${users.length}\n💬 Чатов: ${chats.length}\n📨 Сообщений: ${totalMessages}\n📁 Медиафайлов: ${downloaded}`,
    );

    await fsPromises.rm(exportDir, { recursive: true, force: true });

    return `✅ <b>ЭКСПОРТ ЗАВЕРШЕН!</b>\n\n⏱️ Время: ${Math.floor(totalTime / 60)}м ${totalTime % 60}с\n📁 Медиафайлов: ${downloaded}\n📦 Архив с ссылкой отправлен в личные сообщения.`;
  } catch (error) {
    console.error("Ошибка экспорта:", error);
    return `❌ <b>Ошибка экспорта:</b> ${error.message}`;
  }
}

// Вспомогательная функция для записи файла чата
async function writeChatFile(exportDir, chatId, messages) {
  const chatInfo = messages[0]?.chat || {
    title: "Личный чат",
    type: "private",
  };
  const safeName = (chatInfo.title || `chat_${chatId}`)
    .replace(/[^a-z0-9а-яё]/gi, "_")
    .substring(0, 40);
  const chatFile = path.join(
    exportDir,
    "02_messages",
    `chat_${chatId}_${safeName}.txt`,
  );

  let content = `╔════════════════════════════════════════════════════════════════════════════╗\n`;
  content += `║                    ИСТОРИЯ СООБЩЕНИЙ: ${(chatInfo.title || "Личный чат").substring(0, 45)}${" ".repeat(Math.max(0, 45 - (chatInfo.title || "Личный чат").length))}║\n`;
  content += `╚════════════════════════════════════════════════════════════════════════════╝\n\n`;
  content += `🆔 ID: ${chatId}\n📋 Тип: ${chatInfo.type}\n💬 Сообщений: ${messages.length}\n📅 Экспорт: ${new Date().toLocaleString("ru-RU")}\n\n`;
  content +=
    "═══════════════════════════════════════════════════════════════════════════════════════\n\n";

  let idx = 1;
  for (const m of messages) {
    const userName = m.user
      ? `${m.user.first_name || ""} ${m.user.last_name || ""}`.trim() ||
        "Unknown"
      : "Unknown";
    const userTag = m.user?.username ? `@${m.user.username}` : "";

    content += `┌─ [${idx}] ${new Date(m.sent_at).toLocaleString("ru-RU")}\n`;
    content += `├─ 👤 ${userName} ${userTag}\n├─ 🆔 ${m.user_id || "—"}\n├─ 📝 ${m.message_type}\n`;

    if (m.content) {
      content += `├─ 💬 Текст:\n│  ${m.content.replace(/\n/g, "\n│  ")}\n`;
    }

    if (m.downloaded_file) {
      content += `├─ 📎 Медиа: media/${m.downloaded_file}\n`;
    } else if (m.file_id) {
      content += `├─ 📎 File ID: ${m.file_id} (не скачан)\n`;
    }

    content += `└─ Telegram ID: ${m.telegram_message_id || "—"}\n\n`;
    idx++;
  }

  await fsPromises.writeFile(chatFile, content, "utf-8");
}

// ================= КОМАНДЫ ВЛАДЕЛЬЦА =================
async function handleOwnerCommand(text) {
  const parts = text.trim().split(/\s+/);
  const cmd = parts[0].split("@")[0].toLowerCase();
  const args = parts.slice(1);

  let Op, User, Chat, Message;
  try {
    ({ Op } = require("sequelize"));
    ({ User, Chat, Message } = getModels());
  } catch (e) {
    return sendToOwner(`❌ Ошибка: ${esc(e.message)}`);
  }

  switch (cmd) {
    case "/help":
      await sendToOwner(
        `🤖 <b>КОМАНДЫ МОНИТОРА</b>\n━━━━━━━━━━━━━━━━━━━━━━\n` +
          `/stats — статистика\n` +
          `/top — топ-10 активных\n` +
          `/users [стр] — список пользователей\n` +
          `/chats — список чатов\n` +
          `/user ID — карточка пользователя\n` +
          `/search текст — поиск по сообщениям\n` +
          `/cleanup [дней] — удалить старые сообщения\n` +
          `/export — ПОЛНЫЙ ЭКСПОРТ (текст + все медиа)`,
      );
      break;

    case "/export":
      const result = await exportAllData();
      await sendToOwner(result);
      break;

    case "/stats": {
      if (!User || !Chat || !Message) return sendToOwner("❌ БД недоступна");
      const yesterday = new Date(Date.now() - 86400000);
      const [tu, nu, tm, lm, tg, tp, tc] = await Promise.all([
        User.count(),
        User.count({ where: { first_seen: { [Op.gte]: yesterday } } }),
        Message.count(),
        Message.count({ where: { sent_at: { [Op.gte]: yesterday } } }),
        Chat.count({ where: { type: { [Op.in]: ["group", "supergroup"] } } }),
        Chat.count({ where: { type: "private" } }),
        Chat.count({ where: { type: "channel" } }),
      ]);
      await sendToOwner(
        `📊 <b>СТАТИСТИКА</b>\n━━━━━━━━━━━━━━━━━━━━━━\n` +
          `👤 Пользователей: ${tu} (новых за 24ч: ${nu})\n` +
          `👥 Групп: ${tg} | 👤 Личных: ${tp} | 📢 Каналов: ${tc}\n` +
          `💬 Сообщений: ${tm} (за 24ч: ${lm})`,
      );
      break;
    }

    case "/top": {
      if (!User) return sendToOwner("❌ БД недоступна");
      const users = await User.findAll({
        order: [["message_count", "DESC"]],
        limit: 10,
      });
      let msg = `🏆 <b>ТОП-10 АКТИВНЫХ</b>\n━━━━━━━━━━━━━━━━━━━━━━\n`;
      users.forEach((u, i) => {
        msg += `${i + 1}. <b>${esc(u.first_name || "Unknown")}</b>${u.username ? " @" + esc(u.username) : ""}\n   💬 ${u.message_count}\n`;
      });
      await sendToOwner(msg);
      break;
    }

    default:
      await sendToOwner(`❓ Неизвестная команда: ${esc(cmd)}\nНапиши /help`);
  }
}

// ================= ОСНОВНАЯ ОБРАБОТКА =================
async function processUpdate(update) {
  let user = null,
    msgData = null,
    chat = null,
    messageId = null,
    updateType = "unknown";

  if (update.message) {
    msgData = update.message;
    user = msgData.from;
    chat = msgData.chat;
    messageId = msgData.message_id;
    updateType = "message";
  } else if (update.edited_message) {
    msgData = update.edited_message;
    user = msgData.from;
    chat = msgData.chat;
    messageId = msgData.message_id;
    updateType = "edited_message";
  } else if (update.callback_query) {
    const cb = update.callback_query;
    user = cb.from;
    msgData = { text: `[callback] ${cb.data || ""}` };
    chat = cb.message?.chat || null;
    messageId = cb.id;
    updateType = "callback";
  } else if (update.inline_query) {
    const iq = update.inline_query;
    user = iq.from;
    msgData = { text: `[inline] ${iq.query || "пустой"}` };
    messageId = iq.id;
    updateType = "inline_query";
  } else if (update.channel_post) {
    msgData = update.channel_post;
    user = msgData.from || {
      id: 0,
      first_name: "Channel",
      username: "channel",
      is_bot: false,
    };
    chat = msgData.chat;
    messageId = msgData.message_id;
    updateType = "channel_post";
  } else {
    return;
  }

  if (!user || !msgData) return;

  const key = `${user.id}_${messageId || Date.now()}_${updateType}`;
  if (seenMessages.has(key)) return;
  seenMessages.add(key);
  if (seenMessages.size > MAX_SEEN) {
    const it = seenMessages.values();
    for (let i = 0; i < 2000; i++) seenMessages.delete(it.next().value);
  }

  if (msgData.text?.startsWith("/") && isOwner(user.id)) {
    await handleOwnerCommand(msgData.text);
    return;
  }

  if (isOwner(user.id) && chat?.type === "private") return;

  const { content, msgType, mediaInfo } = extractContent(msgData);
  const isNewUser = await dbUpsertUser(user);

  let membersCount = null,
    admins = [],
    isNewChat = false;
  if (chat?.id) {
    let detailedChat = chat;
    if (String(chat.id).startsWith("-")) {
      const fetched = await fetchChatInfo(chat.id);
      if (fetched) detailedChat = fetched;
      membersCount = await fetchMembersCount(chat.id);
      admins = await fetchAdmins(chat.id);
    }
    isNewChat = await dbUpsertChat(detailedChat, membersCount, admins.length);
    chat = detailedChat;
  }

  await dbSaveMessage({
    telegramMsgId: messageId,
    updateType,
    msgType,
    content,
    userId: user.id,
    chatId: chat?.id,
    mediaInfo,
    isEdited: updateType === "edited_message",
  });

  if (isNewUser) {
    await sendToOwner(
      `🆕 <b>НОВЫЙ ПОЛЬЗОВАТЕЛЬ</b>\n━━━━━━━━━━━━━━━━━━━━━━\n` +
        `👤 ${esc(user.first_name || "No Name")}${user.username ? " | @" + esc(user.username) : ""}\n` +
        `🆔 <code>${user.id}</code>\n⏰ ${new Date().toLocaleString("ru-RU")}`,
    );
  }

  if (isNewChat && chat?.type !== "private") {
    await sendToOwner(
      `🔔 <b>НОВЫЙ ЧАТ</b>\n━━━━━━━━━━━━━━━━━━━━━━\n` +
        `📌 ${esc(chat.title || "?")}\n🆔 <code>${chat.id}</code>`,
    );
  }

  await sendToOwner(
    formatMsg({
      user,
      content,
      msgType,
      messageId,
      chat,
      membersCount,
      admins,
      isNewUser,
      isEdited: updateType === "edited_message",
    }),
  );

  if (mediaInfo?.file_id || (msgType === "location" && mediaInfo?.latitude)) {
    const cap = msgData.caption || `От: ${user.first_name || "?"}`;
    await sendMediaToOwner(msgType, mediaInfo, cap);
  }
}

// ================= ЗАПУСК =================
async function startMessageMonitor() {
  if (isRunning) {
    console.log("⚠️ [Monitor] Уже запущен");
    return;
  }
  isRunning = true;

  console.log("🔄 [Monitor] Запуск...");
  console.log(`👑 Владелец: ${process.env.PRO_ADMIN}`);

  await sendToOwner(
    `🔔 <b>Монитор запущен!</b>\n⏰ ${new Date().toLocaleString("ru-RU")}\n\nНапиши /help`,
  );

  setInterval(() => handleOwnerCommand("/stats"), 6 * 60 * 60 * 1000);

  (async () => {
    while (isRunning) {
      try {
        const updates = await getUpdates();
        for (const update of updates) {
          await processUpdate(update);
        }
        await sleep(300);
      } catch (error) {
        console.error(`⚠️ Ошибка: ${error.message}`);
        await sleep(5000);
      }
    }
  })();
}

async function stopMessageMonitor() {
  isRunning = false;
  console.log("🛑 [Monitor] Остановлен");
}

function splitMessage(text, max = 4096) {
  if (text.length <= max) return [text];
  const parts = [];
  for (let i = 0; i < text.length; i += max) parts.push(text.slice(i, i + max));
  return parts;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

module.exports = { startMessageMonitor, stopMessageMonitor };
