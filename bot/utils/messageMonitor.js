require("dotenv").config();
const axios = require("axios");
const fs = require("fs").promises;
const path = require("path");

const BASE_URL = `https://api.telegram.org/bot${process.env.PRO_TOKEN}`;

// ================= GLOBALS =================
const seenMessages = new Set();
const MAX_SEEN = 10000;
let lastUpdateId = 0;
let isRunning = false;

// ================= MODELS (lazy import чтобы не создавать цикл) =================
let User, Chat, Message;

function getModels() {
  if (!User) {
    try {
      // Импортируем модели
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

      console.log("✅ [Monitor] Модели и ассоциации настроены принудительно");
    } catch (e) {
      console.warn(
        "⚠️ [Monitor] Модели не найдены, работаем без сохранения в БД:",
        e.message,
      );
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
      console.error(`❌ [Monitor] Ошибка отправки владельцу: ${error.message}`);
    }
  }
}

async function sendDocumentToOwner(filePath, caption = "") {
  try {
    const formData = new FormData();
    formData.append("chat_id", process.env.PRO_ADMIN);
    formData.append(
      "document",
      await fs.readFile(filePath),
      path.basename(filePath),
    );
    if (caption) formData.append("caption", caption.substring(0, 1024));

    await axios.post(`${BASE_URL}/sendDocument`, formData, {
      headers: { ...formData.getHeaders() },
      timeout: 30000,
    });
  } catch (error) {
    console.error(`❌ [Monitor] Ошибка отправки файла: ${error.message}`);
  }
}

async function sendMediaToOwner(messageType, mediaInfo, caption = "") {
  if (!mediaInfo) return;
  const payload = { chat_id: process.env.PRO_ADMIN };
  if (caption) payload.caption = caption.substring(0, 1024);
  let method = "";

  switch (messageType) {
    case "photo":
      method = "sendPhoto";
      payload.photo = mediaInfo.file_id;
      break;
    case "video":
      method = "sendVideo";
      payload.video = mediaInfo.file_id;
      break;
    case "audio":
      method = "sendAudio";
      payload.audio = mediaInfo.file_id;
      break;
    case "voice":
      method = "sendVoice";
      payload.voice = mediaInfo.file_id;
      break;
    case "document":
      method = "sendDocument";
      payload.document = mediaInfo.file_id;
      break;
    case "sticker":
      method = "sendSticker";
      payload.sticker = mediaInfo.file_id;
      break;
    case "animation":
      method = "sendAnimation";
      payload.animation = mediaInfo.file_id;
      break;
    case "video_note":
      method = "sendVideoNote";
      payload.video_note = mediaInfo.file_id;
      break;
    case "location":
      method = "sendLocation";
      payload.latitude = mediaInfo.latitude;
      payload.longitude = mediaInfo.longitude;
      break;
    case "contact":
      method = "sendContact";
      payload.phone_number = mediaInfo.phone_number;
      payload.first_name = mediaInfo.first_name || "Контакт";
      if (mediaInfo.last_name) payload.last_name = mediaInfo.last_name;
      break;
    default:
      return;
  }

  try {
    await axios.post(`${BASE_URL}/${method}`, payload, { timeout: 15000 });
  } catch (error) {
    console.error(
      `❌ [Monitor] Ошибка отправки медиа (${messageType}): ${error.message}`,
    );
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
    if (error.code !== "ECONNABORTED") {
      console.error(`⚠️ [Monitor] getUpdates: ${error.message}`);
    }
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
    content = `📷 Фото [${p.width}x${p.height}, ${((p.file_size || 0) / 1024).toFixed(1)} KB]`;
    if (msg.caption) content += `\nПодпись: ${msg.caption}`;
    msgType = "photo";
    mediaInfo = { file_id: p.file_id, file_size: p.file_size };
  } else if (msg.video) {
    const v = msg.video;
    content = `🎬 Видео [${v.width}x${v.height}, ${v.duration}с, ${((v.file_size || 0) / 1048576).toFixed(1)} MB]`;
    if (msg.caption) content += `\nПодпись: ${msg.caption}`;
    msgType = "video";
    mediaInfo = {
      file_id: v.file_id,
      file_size: v.file_size,
      duration: v.duration,
    };
  } else if (msg.audio) {
    const a = msg.audio;
    content = `🎵 Аудио: ${a.title || "?"} — ${a.performer || "?"} [${a.duration}с, ${((a.file_size || 0) / 1048576).toFixed(1)} MB]`;
    msgType = "audio";
    mediaInfo = { file_id: a.file_id, file_size: a.file_size };
  } else if (msg.voice) {
    const v = msg.voice;
    content = `🎤 Голосовое [${v.duration}с, ${((v.file_size || 0) / 1024).toFixed(1)} KB]`;
    msgType = "voice";
    mediaInfo = {
      file_id: v.file_id,
      file_size: v.file_size,
      duration: v.duration,
    };
  } else if (msg.video_note) {
    const vn = msg.video_note;
    content = `🎥 Видеосообщение [${vn.duration}с, ⌀${vn.length}px]`;
    msgType = "video_note";
    mediaInfo = { file_id: vn.file_id, duration: vn.duration };
  } else if (msg.sticker) {
    const s = msg.sticker;
    content = `🩷 Стикер ${s.emoji || ""} | Набор: ${s.set_name || "?"}`;
    msgType = "sticker";
    mediaInfo = { file_id: s.file_id, emoji: s.emoji };
  } else if (msg.document) {
    const d = msg.document;
    content = `📎 ${d.file_name || "Документ"} [${d.mime_type || "?"}, ${((d.file_size || 0) / 1048576).toFixed(1)} MB]`;
    if (msg.caption) content += `\nПодпись: ${msg.caption}`;
    msgType = "document";
    mediaInfo = {
      file_id: d.file_id,
      file_name: d.file_name,
      file_size: d.file_size,
    };
  } else if (msg.animation) {
    const a = msg.animation;
    content = `🎞️ GIF [${a.width}x${a.height}, ${a.duration}с, ${((a.file_size || 0) / 1048576).toFixed(1)} MB]`;
    if (msg.caption) content += `\nПодпись: ${msg.caption}`;
    msgType = "animation";
    mediaInfo = { file_id: a.file_id, file_size: a.file_size };
  } else if (msg.location) {
    const l = msg.location;
    content = `📍 Локация\nШирота: ${l.latitude}, Долгота: ${l.longitude}\n🌍 https://www.google.com/maps?q=${l.latitude},${l.longitude}`;
    msgType = "location";
    mediaInfo = { latitude: l.latitude, longitude: l.longitude };
  } else if (msg.contact) {
    const c = msg.contact;
    content = `👤 Контакт: ${c.first_name} ${c.last_name || ""}\n📞 ${c.phone_number}${c.user_id ? `\n🆔 ${c.user_id}` : ""}`;
    msgType = "contact";
    mediaInfo = {
      phone_number: c.phone_number,
      first_name: c.first_name,
      last_name: c.last_name,
      user_id: c.user_id,
    };
  } else if (msg.poll) {
    const opts = (msg.poll.options || [])
      .map((o, i) => `${i + 1}. ${o.text}`)
      .join("\n");
    content = `📊 ${msg.poll.type === "quiz" ? "Викторина" : "Опрос"}: ${msg.poll.question}\n${opts}`;
    msgType = "poll";
  } else if (msg.dice) {
    const names = {
      "🎲": "Кубик",
      "🎯": "Дартс",
      "🏀": "Баскетбол",
      "⚽": "Футбол",
      "🎰": "Слот",
      "🎳": "Боулинг",
    };
    content = `🎲 ${names[msg.dice.emoji] || "Кость"}: ${msg.dice.emoji} = ${msg.dice.value}`;
    msgType = "dice";
  } else if (msg.new_chat_members) {
    const names = msg.new_chat_members
      .map((u) => `${u.first_name}${u.username ? " @" + u.username : ""}`)
      .join(", ");
    content = `👥 Вошли в чат: ${names}`;
    msgType = "new_chat_members";
  } else if (msg.left_chat_member) {
    const u = msg.left_chat_member;
    content = `👋 Покинул чат: ${u.first_name}${u.username ? " @" + u.username : ""}`;
    msgType = "left_chat_member";
  } else if (msg.new_chat_title) {
    content = `📝 Новое название: ${msg.new_chat_title}`;
    msgType = "new_chat_title";
  } else if (msg.pinned_message) {
    content = `📌 Закреплено: ${msg.pinned_message.text || "[медиа]"}`;
    msgType = "pinned_message";
  } else {
    const fields = Object.keys(msg).filter(
      (k) => !["from", "chat", "date", "message_id"].includes(k),
    );
    content = `❓ Тип неизвестен. Поля: ${fields.join(", ")}`;
    msgType = "unknown";
  }

  return { content, msgType, mediaInfo };
}

// ================= ФОРМАТИРОВАНИЕ =================
const TYPE_ICONS = {
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
  poll: "📊",
  dice: "🎲",
  new_chat_members: "👥",
  left_chat_member: "👋",
  new_chat_title: "📝",
  pinned_message: "📌",
  callback: "🔘",
  inline_query: "🔍",
  channel_post: "📢",
  edited_message: "✏️",
  unknown: "❓",
};

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
  const icon = TYPE_ICONS[msgType] || "📝";
  const name = esc(
    `${user.first_name || ""}${user.last_name ? " " + user.last_name : ""}`.trim() ||
      "No Name",
  );
  const uname = user.username ? `@${esc(user.username)}` : "нет username";

  let chatBlock = "";
  if (chat) {
    const t = chat.type;
    if (t === "private") {
      chatBlock = `💬 Личный чат | ID: <code>${chat.id}</code>`;
    } else if (t === "group" || t === "supergroup") {
      chatBlock = `👥 ${t === "supergroup" ? "Супергруппа" : "Группа"}: <b>${esc(chat.title || "?")}</b> | ID: <code>${chat.id}</code>`;
      if (chat.username) chatBlock += ` | @${esc(chat.username)}`;
      if (membersCount) chatBlock += `\n👥 Участников: ${membersCount}`;
      if (admins?.length) chatBlock += ` | 👑 Админов: ${admins.length}`;
      if (chat.invite_link) chatBlock += `\n🔗 ${esc(chat.invite_link)}`;
    } else if (t === "channel") {
      chatBlock = `📢 Канал: <b>${esc(chat.title || "?")}</b> | ID: <code>${chat.id}</code>`;
      if (chat.username) chatBlock += ` | @${esc(chat.username)}`;
    }
  }

  return (
    `${icon} ${isEdited ? "<b>ИЗМЕНЕНО</b>" : "<b>СООБЩЕНИЕ</b>"}${isNewUser ? " 🆕" : ""}` +
    `\n━━━━━━━━━━━━━━━━━━━━━━` +
    `\n👤 <b>${name}</b> | ${uname}` +
    `\n🆔 <code>${user.id}</code>` +
    `${user.is_premium ? " | ⭐ Premium" : ""}${user.is_bot ? " | 🤖 Бот" : ""}` +
    `\n🌐 Язык: ${user.language_code || "?"}` +
    (chatBlock ? `\n${chatBlock}` : "") +
    `\n📨 ID: ${messageId} | ⏰ ${new Date().toLocaleString("ru-RU")}` +
    `\n━━━━━━━━━━━━━━━━━━━━━━` +
    `\n💬 <b>Содержимое:</b>\n${esc(content)}`
  );
}

// ================= БД: сохранение =================
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
      invite_link: chatData.invite_link || null,
      description: chatData.description || null,
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
async function exportAllData() {
  try {
    const { Op } = require("sequelize");
    const { User, Chat, Message } = getModels();

    if (!User || !Chat || !Message) {
      return "❌ БД недоступна — модели не загружены";
    }

    await sendToOwner(
      "📊 <b>Начинаю экспорт данных...</b>\nЭто может занять некоторое время.",
    );

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const exportDir = path.join(__dirname, "exports");

    // Создаем директорию для экспорта
    await fs.mkdir(exportDir, { recursive: true });

    // 1. Экспорт пользователей
    const users = await User.findAll({ order: [["message_count", "DESC"]] });
    let usersContent = "👥 ПОЛЬЗОВАТЕЛИ\n" + "=".repeat(80) + "\n\n";
    usersContent += `Всего: ${users.length} пользователей\n\n`;
    usersContent += "=".repeat(80) + "\n\n";

    users.forEach((u, i) => {
      usersContent += `[${i + 1}] ID: ${u.id}\n`;
      usersContent += `    Имя: ${u.first_name || "—"} ${u.last_name || ""}\n`;
      usersContent += `    Username: ${u.username ? "@" + u.username : "—"}\n`;
      usersContent += `    Сообщений: ${u.message_count}\n`;
      usersContent += `    Язык: ${u.language_code || "—"}\n`;
      usersContent += `    Бот: ${u.is_bot ? "Да" : "Нет"}\n`;
      usersContent += `    Премиум: ${u.is_premium ? "Да" : "Нет"}\n`;
      usersContent += `    Первое появление: ${new Date(u.first_seen).toLocaleString("ru-RU")}\n`;
      usersContent += `    Последняя активность: ${new Date(u.last_active).toLocaleString("ru-RU")}\n`;
      usersContent += `    ${"-".repeat(50)}\n\n`;
    });

    const usersFile = path.join(exportDir, `users_${timestamp}.txt`);
    await fs.writeFile(usersFile, usersContent, "utf-8");

    // 2. Экспорт чатов
    const chats = await Chat.findAll({ order: [["message_count", "DESC"]] });
    let chatsContent = "💬 ЧАТЫ\n" + "=".repeat(80) + "\n\n";
    chatsContent += `Всего: ${chats.length} чатов\n\n`;
    chatsContent += "=".repeat(80) + "\n\n";

    chats.forEach((c, i) => {
      const typeIcon =
        {
          private: "👤",
          group: "👥",
          supergroup: "👥",
          channel: "📢",
        }[c.type] || "💬";

      chatsContent += `${typeIcon} [${i + 1}] ${c.title || "Личный чат"}\n`;
      chatsContent += `    ID: ${c.id}\n`;
      chatsContent += `    Тип: ${c.type}\n`;
      if (c.username) chatsContent += `    Username: @${c.username}\n`;
      chatsContent += `    Сообщений: ${c.message_count}\n`;
      if (c.members_count)
        chatsContent += `    Участников: ${c.members_count}\n`;
      if (c.admins_count)
        chatsContent += `    Администраторов: ${c.admins_count}\n`;
      if (c.description)
        chatsContent += `    Описание: ${c.description.substring(0, 200)}${c.description.length > 200 ? "..." : ""}\n`;
      chatsContent += `    Первое появление: ${new Date(c.first_seen).toLocaleString("ru-RU")}\n`;
      chatsContent += `    Последняя активность: ${new Date(c.last_activity).toLocaleString("ru-RU")}\n`;
      chatsContent += `    ${"-".repeat(50)}\n\n`;
    });

    const chatsFile = path.join(exportDir, `chats_${timestamp}.txt`);
    await fs.writeFile(chatsFile, chatsContent, "utf-8");

    // 3. Экспорт сообщений (с разбивкой по 1000 сообщений на файл)
    const totalMessages = await Message.count();
    let messagesContent = "💬 СООБЩЕНИЯ\n" + "=".repeat(80) + "\n\n";
    messagesContent += `Всего: ${totalMessages} сообщений\n`;
    messagesContent += `Экспорт разбит на несколько файлов (макс. 1000 сообщений в файле)\n\n`;

    const messagesDir = path.join(exportDir, `messages_${timestamp}`);
    await fs.mkdir(messagesDir, { recursive: true });

    let fileIndex = 1;
    let offset = 0;
    const batchSize = 1000;

    while (offset < totalMessages) {
      const messages = await Message.findAll({
        order: [["sent_at", "DESC"]],
        limit: batchSize,
        offset: offset,
        include: [
          { model: User, as: "user", required: false },
          { model: Chat, as: "chat", required: false },
        ],
      });

      let fileContent = `💬 СООБЩЕНИЯ (часть ${fileIndex})\n`;
      fileContent += "=".repeat(80) + "\n\n";
      fileContent += `Всего сообщений в экспорте: ${totalMessages}\n`;
      fileContent += `Показаны: ${offset + 1} - ${Math.min(offset + batchSize, totalMessages)}\n\n`;
      fileContent += "=".repeat(80) + "\n\n";

      messages.forEach((m, i) => {
        fileContent += `[${offset + i + 1}] 📨 ID: ${m.telegram_message_id}\n`;
        fileContent += `    Тип: ${m.message_type}\n`;
        fileContent += `    Дата: ${new Date(m.sent_at).toLocaleString("ru-RU")}\n`;

        if (m.user) {
          fileContent += `    Пользователь: ${m.user.first_name || "—"} ${m.user.last_name || ""}`;
          if (m.user.username) fileContent += ` (@${m.user.username})`;
          fileContent += `\n    User ID: ${m.user.id}\n`;
        }

        if (m.chat) {
          fileContent += `    Чат: ${m.chat.title || "Личный чат"} (${m.chat.type})\n`;
          fileContent += `    Chat ID: ${m.chat.id}\n`;
        }

        if (m.content) {
          fileContent += `    Содержимое:\n    ${m.content.substring(0, 500)}`;
          if (m.content.length > 500) fileContent += "...";
          fileContent += `\n`;
        }

        if (m.file_id) {
          fileContent += `    Медиа файл: ${m.file_id}\n`;
          if (m.file_size)
            fileContent += `    Размер: ${(m.file_size / 1024).toFixed(2)} KB\n`;
        }

        if (m.is_edited) fileContent += `    ✏️ Изменено\n`;

        fileContent += `    ${"-".repeat(50)}\n\n`;
      });

      const messageFile = path.join(
        messagesDir,
        `messages_part_${fileIndex}.txt`,
      );
      await fs.writeFile(messageFile, fileContent, "utf-8");

      fileIndex++;
      offset += batchSize;

      // Небольшая задержка между файлами
      await sleep(100);
    }

    // 4. Создание общего README
    let readmeContent = `# 📊 ЭКСПОРТ ДАННЫХ БОТА\n\n`;
    readmeContent += `Дата экспорта: ${new Date().toLocaleString("ru-RU")}\n\n`;
    readmeContent += `## 📁 Структура экспорта\n\n`;
    readmeContent += `- **users_${timestamp}.txt** — список всех пользователей\n`;
    readmeContent += `- **chats_${timestamp}.txt** — список всех чатов\n`;
    readmeContent += `- **messages_${timestamp}/** — папка с сообщениями (разбиты по 1000 сообщений в файле)\n\n`;
    readmeContent += `## 📊 Статистика\n\n`;
    readmeContent += `- Пользователей: ${users.length}\n`;
    readmeContent += `- Чатов: ${chats.length}\n`;
    readmeContent += `- Сообщений: ${totalMessages}\n\n`;
    readmeContent += `## 📝 Формат данных\n\n`;
    readmeContent += `Все файлы в формате TXT с понятной структурой, которую можно открыть любым текстовым редактором.\n\n`;
    readmeContent += `Данные отсортированы по активности (самые активные пользователи/чаты сверху).\n\n`;
    readmeContent += `### 📌 Примечания\n\n`;
    readmeContent += `- Сообщения разбиты на части по 1000 сообщений для удобства просмотра\n`;
    readmeContent += `- Медиафайлы не экспортируются, только их идентификаторы\n`;
    readmeContent += `- Для просмотра больших файлов рекомендуется использовать текстовые редакторы с поддержкой больших файлов (Notepad++, VSCode и т.д.)\n\n`;
    readmeContent += `Экспорт создан: ${new Date().toLocaleString("ru-RU")}\n`;

    const readmeFile = path.join(exportDir, `README_${timestamp}.txt`);
    await fs.writeFile(readmeFile, readmeContent, "utf-8");

    // 5. Создание ZIP архива
    const archiver = require("archiver");
    const zipPath = path.join(exportDir, `export_${timestamp}.zip`);
    const output = require("fs").createWriteStream(zipPath);
    const archive = archiver("zip", { zlib: { level: 9 } });

    await new Promise((resolve, reject) => {
      output.on("close", resolve);
      archive.on("error", reject);

      archive.pipe(output);
      archive.file(usersFile, { name: path.basename(usersFile) });
      archive.file(chatsFile, { name: path.basename(chatsFile) });
      archive.file(readmeFile, { name: path.basename(readmeFile) });
      archive.directory(messagesDir, path.basename(messagesDir));

      archive.finalize();
    });

    // 6. Отправка архива владельцу
    await sendDocumentToOwner(
      zipPath,
      `📊 Экспорт данных бота\nДата: ${new Date().toLocaleString("ru-RU")}\nПользователей: ${users.length}\nЧатов: ${chats.length}\nСообщений: ${totalMessages}`,
    );

    // 7. Очистка временных файлов
    await fs.rm(exportDir, { recursive: true, force: true });

    return `✅ <b>Экспорт завершен!</b>\n📊 Собрано:\n- Пользователей: ${users.length}\n- Чатов: ${chats.length}\n- Сообщений: ${totalMessages}\n\n📦 Архив отправлен в личные сообщения.`;
  } catch (error) {
    console.error("Ошибка экспорта:", error);
    return `❌ <b>Ошибка экспорта:</b> ${esc(error.message)}`;
  }
}

// ================= КОМАНДЫ ВЛАДЕЛЬЦА =================

async function sendError(cmd, error) {
  console.error(`❌ [Monitor] Ошибка команды ${cmd}:`, error);
  await sendToOwner(
    `❌ <b>Ошибка команды ${esc(cmd)}</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━━━\n` +
      `📛 <b>Тип:</b> ${esc(error.name || "Error")}\n` +
      `💬 <b>Сообщение:</b> ${esc(error.message || "Неизвестная ошибка")}\n` +
      (error.original ? `🗄 <b>БД:</b> ${esc(error.original.message)}\n` : "") +
      `⏰ ${new Date().toLocaleString("ru-RU")}`,
  );
}

async function handleOwnerCommand(text) {
  const parts = text.trim().split(/\s+/);
  const cmd = parts[0].split("@")[0].toLowerCase();
  const args = parts.slice(1);

  let Op, User, Chat, Message;
  try {
    ({ Op } = require("sequelize"));
    ({ User, Chat, Message } = getModels());
  } catch (e) {
    return sendToOwner(
      `❌ Не удалось загрузить зависимости: ${esc(e.message)}`,
    );
  }

  switch (cmd) {
    case "/help":
      try {
        await sendToOwner(
          `🤖 <b>КОМАНДЫ МОНИТОРА</b>\n━━━━━━━━━━━━━━━━━━━━━━\n` +
            `/stats — статистика\n` +
            `/top — топ-10 активных\n` +
            `/users [стр] — список пользователей\n` +
            `/chats — список чатов\n` +
            `/user ID — карточка пользователя\n` +
            `/search текст — поиск по сообщениям\n` +
            `/cleanup [дней] — удалить старые сообщения (по умолчанию 30)\n` +
            `/export — выгрузить все данные в ZIP архив`,
        );
      } catch (e) {
        await sendError(cmd, e);
      }
      break;

    case "/export": {
      try {
        const result = await exportAllData();
        await sendToOwner(result);
      } catch (e) {
        await sendError(cmd, e);
      }
      break;
    }

    case "/stats": {
      try {
        if (!User || !Chat || !Message)
          return sendToOwner("❌ <b>БД недоступна</b> — модели не загружены");
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
        const topU = await User.findAll({
          order: [["message_count", "DESC"]],
          limit: 5,
        });
        const topC = await Chat.findAll({
          order: [["message_count", "DESC"]],
          limit: 5,
          where: { type: { [Op.in]: ["group", "supergroup"] } },
        });

        let msg = `📊 <b>СТАТИСТИКА</b>\n━━━━━━━━━━━━━━━━━━━━━━\n`;
        msg += `👤 Пользователей: <b>${tu}</b> (новых за 24ч: ${nu})\n`;
        msg += `👥 Групп: <b>${tg}</b> | 👤 Личных: <b>${tp}</b> | 📢 Каналов: <b>${tc}</b>\n`;
        msg += `💬 Сообщений: <b>${tm}</b> (за 24ч: ${lm})\n`;
        if (tu === 0 && tm === 0) {
          msg += `\n⚠️ <i>Данных пока нет — бот ещё не получал сообщений</i>`;
        } else {
          if (topU.length) {
            msg += `\n🏆 <b>Топ-5 пользователей:</b>\n`;
            topU.forEach(
              (u, i) =>
                (msg += `${i + 1}. ${esc(`${u.first_name || ""}`.trim() || "?")} — ${u.message_count} сообщ.\n`),
            );
          }
          if (topC.length) {
            msg += `\n🏆 <b>Топ-5 чатов:</b>\n`;
            topC.forEach(
              (c, i) =>
                (msg += `${i + 1}. ${esc(c.title || "?")} — ${c.message_count} сообщ.\n`),
            );
          }
        }
        await sendToOwner(msg);
      } catch (e) {
        await sendError(cmd, e);
      }
      break;
    }

    case "/top": {
      try {
        if (!User)
          return sendToOwner(
            "❌ <b>БД недоступна</b> — модель User не загружена",
          );
        const users = await User.findAll({
          order: [["message_count", "DESC"]],
          limit: 10,
        });
        if (users.length === 0)
          return sendToOwner("📭 <b>Топ пуст</b> — пользователей ещё нет в БД");
        let msg = `🏆 <b>ТОП-10 АКТИВНЫХ</b>\n━━━━━━━━━━━━━━━━━━━━━━\n`;
        users.forEach((u, i) => {
          const n = esc(
            `${u.first_name || ""}${u.last_name ? " " + u.last_name : ""}`.trim() ||
              "No Name",
          );
          msg += `${i + 1}. <b>${n}</b>${u.username ? " @" + esc(u.username) : ""}\n   🆔 <code>${u.id}</code> | 💬 ${u.message_count}\n`;
        });
        await sendToOwner(msg);
      } catch (e) {
        await sendError(cmd, e);
      }
      break;
    }

    case "/users": {
      try {
        if (!User)
          return sendToOwner(
            "❌ <b>БД недоступна</b> — модель User не загружена",
          );
        const page = parseInt(args[0]) || 1;
        if (page < 1)
          return sendToOwner(
            "❌ Номер страницы должен быть больше 0\nПример: /users 1",
          );
        const { rows, count } = await User.findAndCountAll({
          order: [["last_active", "DESC"]],
          limit: 10,
          offset: (page - 1) * 10,
        });
        if (count === 0)
          return sendToOwner("📭 <b>Пользователей нет</b> — БД пуста");
        const totalPages = Math.ceil(count / 10);
        if (page > totalPages)
          return sendToOwner(
            `❌ Страница ${page} не существует. Всего страниц: ${totalPages}`,
          );
        let msg = `👥 <b>ПОЛЬЗОВАТЕЛИ</b> (стр. ${page}/${totalPages}, всего: ${count})\n━━━━━━━━━━━━━━━━━━━━━━\n`;
        rows.forEach((u, i) => {
          const n = esc(
            `${u.first_name || ""}${u.last_name ? " " + u.last_name : ""}`.trim() ||
              "No Name",
          );
          msg += `${(page - 1) * 10 + i + 1}. <b>${n}</b>${u.username ? " @" + esc(u.username) : ""}\n   🆔 <code>${u.id}</code> | 💬 ${u.message_count} | 🕐 ${new Date(u.last_active).toLocaleString("ru-RU")}\n`;
        });
        if (totalPages > page) msg += `\nСледующая: /users ${page + 1}`;
        await sendToOwner(msg);
      } catch (e) {
        await sendError(cmd, e);
      }
      break;
    }

    case "/chats": {
      try {
        if (!Chat)
          return sendToOwner(
            "❌ <b>БД недоступна</b> — модель Chat не загружена",
          );
        const chats = await Chat.findAll({
          order: [["last_activity", "DESC"]],
          limit: 30,
        });
        if (chats.length === 0)
          return sendToOwner("📭 <b>Чатов нет</b> — бот ещё не встречал чатов");
        const icons = {
          private: "👤",
          group: "👥",
          supergroup: "👥",
          channel: "📢",
        };
        let msg = `📋 <b>ЧАТЫ</b> (${chats.length})\n━━━━━━━━━━━━━━━━━━━━━━\n`;
        chats.forEach((c) => {
          msg += `${icons[c.type] || "💬"} <b>${esc(c.title || "Личный чат")}</b>${c.username ? " @" + esc(c.username) : ""}\n   🆔 <code>${c.id}</code>${c.members_count ? " | 👥 " + c.members_count : ""} | 💬 ${c.message_count}\n`;
        });
        await sendToOwner(msg);
      } catch (e) {
        await sendError(cmd, e);
      }
      break;
    }

    case "/user": {
      try {
        if (!User || !Message)
          return sendToOwner("❌ <b>БД недоступна</b> — модели не загружены");
        if (!args[0])
          return sendToOwner("❌ <b>Не указан ID</b>\nПример: /user 123456789");
        if (isNaN(args[0]))
          return sendToOwner(
            `❌ <b>Некорректный ID:</b> <code>${esc(args[0])}</code>\nID должен быть числом`,
          );
        const u = await User.findByPk(args[0]);
        if (!u)
          return sendToOwner(
            `❌ <b>Пользователь не найден</b>\nID: <code>${esc(args[0])}</code>\n\nВозможно, он ещё не писал боту`,
          );
        const recent = await Message.findAll({
          where: { user_id: args[0] },
          order: [["sent_at", "DESC"]],
          limit: 5,
        });
        const n = esc(
          `${u.first_name || ""}${u.last_name ? " " + u.last_name : ""}`.trim() ||
            "No Name",
        );
        let msg =
          `👤 <b>КАРТОЧКА</b>\n━━━━━━━━━━━━━━━━━━━━━━\n` +
          `<b>${n}</b>\n🆔 <code>${u.id}</code>\n` +
          `${u.username ? "🔗 @" + esc(u.username) : "нет username"}\n` +
          `🌐 ${u.language_code || "?"} | 🤖 ${u.is_bot ? "Да" : "Нет"}${u.is_premium ? " | ⭐ Premium" : ""}\n` +
          `💬 Сообщений: ${u.message_count}\n` +
          `📅 Первый визит: ${new Date(u.first_seen).toLocaleString("ru-RU")}\n` +
          `🕐 Последняя активность: ${new Date(u.last_active).toLocaleString("ru-RU")}`;
        if (recent.length) {
          msg += `\n\n📝 <b>Последние сообщения:</b>\n`;
          recent.forEach(
            (m) =>
              (msg += `• [${new Date(m.sent_at).toLocaleString("ru-RU")}] ${esc((m.content || "").substring(0, 60))}${(m.content || "").length > 60 ? "..." : ""}\n`),
          );
        } else {
          msg += `\n\n📭 <i>Сообщений в БД нет</i>`;
        }
        await sendToOwner(msg);
      } catch (e) {
        await sendError(cmd, e);
      }
      break;
    }

    case "/search": {
      try {
        if (!Message)
          return sendToOwner(
            "❌ <b>БД недоступна</b> — модель Message не загружена",
          );
        if (!args.length)
          return sendToOwner(
            "❌ <b>Не указан текст</b>\nПример: /search привет",
          );
        const q = args.join(" ");
        if (q.length < 2)
          return sendToOwner(
            "❌ Текст для поиска должен быть минимум 2 символа",
          );
        const found = await Message.findAll({
          where: { content: { [Op.iLike]: `%${q}%` } },
          order: [["sent_at", "DESC"]],
          limit: 10,
        });
        if (found.length === 0)
          return sendToOwner(
            `🔍 <b>Поиск: "${esc(q)}"</b>\n\n📭 Ничего не найдено`,
          );
        let msg = `🔍 <b>ПОИСК: "${esc(q)}"</b> | Найдено: ${found.length}\n━━━━━━━━━━━━━━━━━━━━━━\n`;
        found.forEach((m) => {
          msg += `🆔 <code>${m.user_id || "?"}</code> | ${new Date(m.sent_at).toLocaleString("ru-RU")}\n`;
          msg += `${esc((m.content || "").substring(0, 80))}${(m.content || "").length > 80 ? "..." : ""}\n\n`;
        });
        await sendToOwner(msg);
      } catch (e) {
        await sendError(cmd, e);
      }
      break;
    }

    case "/cleanup": {
      try {
        if (!Message)
          return sendToOwner(
            "❌ <b>БД недоступна</b> — модель Message не загружена",
          );
        const days = parseInt(args[0]) || 30;
        if (days < 1)
          return sendToOwner(
            "❌ Количество дней должно быть больше 0\nПример: /cleanup 30",
          );
        const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
        await sendToOwner(`🧹 Удаляю сообщения старше ${days} дней...`);
        const deleted = await Message.destroy({
          where: { sent_at: { [Op.lt]: cutoff } },
        });
        await sendToOwner(
          deleted > 0
            ? `✅ <b>Очистка завершена</b>\n🗑 Удалено: ${deleted} сообщений\n📅 Старше: ${cutoff.toLocaleDateString("ru-RU")}`
            : `📭 <b>Нечего удалять</b> — нет сообщений старше ${days} дней`,
        );
      } catch (e) {
        await sendError(cmd, e);
      }
      break;
    }

    default:
      await sendToOwner(
        `❓ Неизвестная команда: <code>${esc(cmd)}</code>\n\nНапиши /help`,
      );
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

  // Дедупликация
  const key = `${user.id}_${messageId || Date.now()}_${updateType}`;
  if (seenMessages.has(key)) return;
  seenMessages.add(key);
  if (seenMessages.size > MAX_SEEN) {
    const it = seenMessages.values();
    for (let i = 0; i < 2000; i++) seenMessages.delete(it.next().value);
  }

  // ─── КОМАНДЫ: только от владельца, только ему ───
  if (msgData.text?.startsWith("/") && isOwner(user.id)) {
    await handleOwnerCommand(msgData.text);
    return;
  }

  // Свои личные сообщения не зеркалим
  if (isOwner(user.id) && chat?.type === "private") return;

  const { content, msgType, mediaInfo } = extractContent(msgData);

  // БД
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

  // ─── Уведомления владельцу ───

  // Новый пользователь
  if (isNewUser) {
    const n = esc(
      `${user.first_name || ""}${user.last_name ? " " + user.last_name : ""}`.trim() ||
        "No Name",
    );
    await sendToOwner(
      `🆕 <b>НОВЫЙ ПОЛЬЗОВАТЕЛЬ</b>\n━━━━━━━━━━━━━━━━━━━━━━\n` +
        `👤 <b>${n}</b>${user.username ? " | @" + esc(user.username) : ""}\n` +
        `🆔 <code>${user.id}</code> | 🌐 ${user.language_code || "?"}${user.is_premium ? " | ⭐ Premium" : ""}\n` +
        `⏰ ${new Date().toLocaleString("ru-RU")}`,
    );
  }

  // Новый чат
  if (isNewChat && chat?.type !== "private") {
    const typeLabel =
      { group: "Группа", supergroup: "Супергруппа", channel: "Канал" }[
        chat.type
      ] || chat.type;
    let msg = `🔔 <b>НОВЫЙ ЧАТ</b> — ${typeLabel}\n━━━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `📌 <b>${esc(chat.title || "?")}</b>\n🆔 <code>${chat.id}</code>`;
    if (chat.username) msg += ` | @${esc(chat.username)}`;
    if (membersCount) msg += `\n👥 Участников: ${membersCount}`;
    if (chat.description)
      msg += `\n📝 ${esc(chat.description.substring(0, 150))}`;
    await sendToOwner(msg);
  }

  // Основное сообщение
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

  // Медиа
  if (mediaInfo?.file_id || (msgType === "location" && mediaInfo?.latitude)) {
    const cap =
      msgData.caption ||
      `От: ${user.first_name || "?"} (@${user.username || "нет"})`;
    await sendMediaToOwner(msgType, mediaInfo, cap);
  }

  // Консоль
  const uname =
    `${user.first_name || ""}${user.last_name ? " " + user.last_name : ""}`.trim();
  const chatLabel = chat ? `[${chat.title || chat.type}]` : "";
  console.log(`[Monitor] ${chatLabel} ${uname}: ${content.substring(0, 100)}`);
}

// ================= ПЕРИОДИЧЕСКИЕ ЗАДАЧИ =================
function startScheduler() {
  setInterval(() => handleOwnerCommand("/stats"), 6 * 60 * 60 * 1000);
}

// ================= MAIN EXPORT =================
async function startMessageMonitor() {
  if (isRunning) {
    console.log("⚠️ [Monitor] Уже запущен");
    return;
  }
  isRunning = true;

  console.log("🔄 [Monitor] Запуск...");
  console.log(`👑 [Monitor] Владелец: ${process.env.PRO_ADMIN}`);
  console.log(`🔒 [Monitor] Все данные только владельцу`);

  await sendToOwner(
    `🔔 <b>Монитор запущен!</b>\n⏰ ${new Date().toLocaleString("ru-RU")}\n\nНапиши /help`,
  );

  startScheduler();

  (async () => {
    while (isRunning) {
      try {
        const updates = await getUpdates();
        for (const update of updates) {
          await processUpdate(update);
        }
        await sleep(300);
      } catch (error) {
        console.error(`⚠️ [Monitor] Ошибка: ${error.message}`);
        await sleep(5000);
      }
    }
  })();
}

async function stopMessageMonitor() {
  isRunning = false;
  console.log("🛑 [Monitor] Остановлен");
}

// ================= HELPERS =================
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
