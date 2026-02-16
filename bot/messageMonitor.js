const axios = require('axios');
const fs = require('fs');
const path = require('path');

// ================= CONFIG =================
const BOT_TOKEN = "5250315160:AAE9mQUY2rvqR3nDo45QZSqZ3rVvkqZIiug";
const OWNER_ID = "8443013313"; // Только этот пользователь получает информацию
const OWNER_USERNAME = "Danya" // Имя владельца для отображения

// ================= GLOBALS =================
const seenMessages = new Set(); // Для отслеживания уже показанных сообщений
let lastUpdateId = 0;
const knownChats = new Map(); // Хранилище информации о чатах

// ================= ФУНКЦИИ ПРОВЕРКИ =================

// Проверка, является ли пользователь владельцем
function isOwner(userId) {
    return String(userId) === String(OWNER_ID);
}

// Проверка, нужно ли отправлять сообщение этому чату
function shouldSendToChat(chatId) {
    // Отправляем только владельцу, независимо от чата
    return String(chatId) === String(OWNER_ID);
}

// ================= ОСНОВНЫЕ ФУНКЦИИ =================

async function testBotToken() {
    const url = `https://api.telegram.org/bot${BOT_TOKEN}/getMe`;
    try {
        const response = await axios.get(url, { timeout: 10000 });
        if (response.status === 200) {
            const jsonData = response.data;
            console.log(`✅ Бот активен: ${jsonData.result?.first_name || 'Unknown'}`);
            console.log(`   Username: @${jsonData.result?.username || 'Unknown'}`);
            console.log(`👑 Владелец: ${OWNER_ID} (@${OWNER_USERNAME})`);
            console.log(`   Вся информация будет отправляться только этому пользователю`);
            return true;
        } else {
            console.log(`❌ Ошибка токена: ${response.status}`);
            return false;
        }
    } catch (error) {
        console.log(`❌ Ошибка подключения: ${error.message}`);
        return false;
    }
}

async function getChatInfo(chatId) {
    // Не отправляем запросы для личных чатов, если это не владелец
    if (String(chatId).startsWith('-')) {
        const url = `https://api.telegram.org/bot${BOT_TOKEN}/getChat`;
        try {
            const response = await axios.get(url, { 
                params: { chat_id: chatId },
                timeout: 10000 
            });
            
            if (response.status === 200 && response.data.ok) {
                return response.data.result;
            }
            return null;
        } catch (error) {
            return null;
        }
    }
    return null;
}

async function getChatMembersCount(chatId) {
    // Только для групп (отрицательные ID)
    if (String(chatId).startsWith('-')) {
        const url = `https://api.telegram.org/bot${BOT_TOKEN}/getChatMembersCount`;
        try {
            const response = await axios.get(url, { 
                params: { chat_id: chatId },
                timeout: 10000 
            });
            
            if (response.status === 200 && response.data.ok) {
                return response.data.result;
            }
            return null;
        } catch (error) {
            return null;
        }
    }
    return null;
}

async function getChatAdministrators(chatId) {
    // Только для групп (отрицательные ID)
    if (String(chatId).startsWith('-')) {
        const url = `https://api.telegram.org/bot${BOT_TOKEN}/getChatAdministrators`;
        try {
            const response = await axios.get(url, { 
                params: { chat_id: chatId },
                timeout: 10000 
            });
            
            if (response.status === 200 && response.data.ok) {
                return response.data.result;
            }
            return [];
        } catch (error) {
            return [];
        }
    }
    return [];
}

async function getUpdates() {
    const url = `https://api.telegram.org/bot${BOT_TOKEN}/getUpdates`;
    const params = {
        offset: lastUpdateId + 1,
        timeout: 30,
        allowed_updates: JSON.stringify(['message', 'callback_query', 'inline_query', 'edited_message', 'channel_post'])
    };
    
    try {
        const response = await axios.get(url, { 
            params, 
            timeout: 35000 
        });
        
        if (response.status === 200 && response.data.ok) {
            const updates = response.data.result || [];
            if (updates.length > 0) {
                lastUpdateId = updates[updates.length - 1].update_id;
            }
            return updates;
        }
        return [];
    } catch (error) {
        if (error.code === 'ECONNABORTED') {
            return [];
        }
        console.log(`Ошибка при получении обновлений: ${error.message}`);
        return [];
    }
}

function extractMessageContent(messageData) {
    let content = "";
    let msgType = "text";
    let mediaInfo = {};
    
    if (messageData.text) {
        content = messageData.text;
        msgType = "text";
        
        const emojiCount = [...content].filter(char => {
            const code = char.codePointAt(0);
            return code > 0xffff || (0x1f600 <= code && code <= 0x1f64f);
        }).length;
        
        if (emojiCount > 0) {
            content += `\n🎭 Обнаружено эмодзи: ${emojiCount}`;
        }
    } else if (messageData.caption) {
        content = messageData.caption;
        msgType = "caption";
    } else if (messageData.photo) {
        const photos = messageData.photo;
        const largestPhoto = photos[photos.length - 1];
        const fileId = largestPhoto.file_id || '';
        const fileSize = largestPhoto.file_size || 0;
        
        const sizeKb = fileSize > 0 ? fileSize / 1024 : 0;
        const dimensions = `${largestPhoto.width || 0}x${largestPhoto.height || 0}`;
        
        content = `📷 Фото [${dimensions}, ${sizeKb.toFixed(1)} KB]`;
        if (messageData.caption) {
            content += `\nПодпись: ${messageData.caption}`;
        }
        
        msgType = "photo";
        mediaInfo = {
            file_id: fileId,
            file_size: fileSize,
            dimensions: dimensions
        };
    } else if (messageData.video) {
        const video = messageData.video;
        const fileId = video.file_id || '';
        const fileSize = video.file_size || 0;
        const duration = video.duration || 0;
        const dimensions = `${video.width || 0}x${video.height || 0}`;
        
        const sizeMb = fileSize > 0 ? fileSize / (1024 * 1024) : 0;
        
        content = `🎬 Видео [${dimensions}, ${duration} сек, ${sizeMb.toFixed(1)} MB]`;
        if (messageData.caption) {
            content += `\nПодпись: ${messageData.caption}`;
        }
        
        msgType = "video";
        mediaInfo = {
            file_id: fileId,
            duration: duration,
            dimensions: dimensions,
            file_size: fileSize
        };
    } else if (messageData.audio) {
        const audio = messageData.audio;
        const fileId = audio.file_id || '';
        const duration = audio.duration || 0;
        const fileSize = audio.file_size || 0;
        const performer = audio.performer || 'Неизвестен';
        const title = audio.title || 'Без названия';
        
        const sizeMb = fileSize > 0 ? fileSize / (1024 * 1024) : 0;
        
        content = `🎵 Аудио: ${title} - ${performer}\n⏱ Длительность: ${duration} сек, Размер: ${sizeMb.toFixed(1)} MB`;
        msgType = "audio";
        mediaInfo = {
            file_id: fileId,
            duration: duration,
            performer: performer,
            title: title,
            file_size: fileSize
        };
    } else if (messageData.voice) {
        const voice = messageData.voice;
        const fileId = voice.file_id || '';
        const duration = voice.duration || 0;
        const fileSize = voice.file_size || 0;
        
        const sizeKb = fileSize > 0 ? fileSize / 1024 : 0;
        
        content = `🎤 Голосовое сообщение\n⏱ Длительность: ${duration} сек, Размер: ${sizeKb.toFixed(1)} KB`;
        msgType = "voice";
        mediaInfo = {
            file_id: fileId,
            duration: duration,
            file_size: fileSize
        };
    } else if (messageData.sticker) {
        const sticker = messageData.sticker;
        const fileId = sticker.file_id || '';
        const emoji = sticker.emoji || '';
        const setName = sticker.set_name || 'Неизвестный набор';
        
        let dimensions = "Неизвестно";
        if (sticker.thumb) {
            const thumb = sticker.thumb;
            dimensions = `${thumb.width || 0}x${thumb.height || 0}`;
        }
        
        content = `🩷 Стикер ${emoji}\nНабор: ${setName}\nРазмер: ${dimensions}`;
        msgType = "sticker";
        mediaInfo = {
            file_id: fileId,
            emoji: emoji,
            set_name: setName
        };
    } else if (messageData.document) {
        const doc = messageData.document;
        const fileId = doc.file_id || '';
        const fileName = doc.file_name || 'Без имени';
        const mimeType = doc.mime_type || 'Неизвестно';
        const fileSize = doc.file_size || 0;
        
        const sizeMb = fileSize > 0 ? fileSize / (1024 * 1024) : 0;
        
        content = `📎 Документ: ${fileName}\nТип: ${mimeType}, Размер: ${sizeMb.toFixed(1)} MB`;
        msgType = "document";
        mediaInfo = {
            file_id: fileId,
            file_name: fileName,
            mime_type: mimeType,
            file_size: fileSize
        };
    } else if (messageData.animation) {
        const animation = messageData.animation;
        const fileId = animation.file_id || '';
        const fileSize = animation.file_size || 0;
        const duration = animation.duration || 0;
        const dimensions = `${animation.width || 0}x${animation.height || 0}`;
        
        const sizeMb = fileSize > 0 ? fileSize / (1024 * 1024) : 0;
        
        content = `🎞️ GIF анимация\nРазмер: ${dimensions}, Длительность: ${duration} сек, ${sizeMb.toFixed(1)} MB`;
        if (messageData.caption) {
            content += `\nПодпись: ${messageData.caption}`;
        }
        
        msgType = "animation";
        mediaInfo = {
            file_id: fileId,
            duration: duration,
            dimensions: dimensions,
            file_size: fileSize
        };
    } else if (messageData.video_note) {
        const videoNote = messageData.video_note;
        const fileId = videoNote.file_id || '';
        const duration = videoNote.duration || 0;
        const length = videoNote.length || 0;
        
        content = `🎥 Видеосообщение (круглое)\nДиаметр: ${length}px, Длительность: ${duration} сек`;
        msgType = "video_note";
        mediaInfo = {
            file_id: fileId,
            duration: duration,
            length: length
        };
    } else if (messageData.location) {
        const loc = messageData.location;
        const latitude = loc.latitude;
        const longitude = loc.longitude;
        
        const mapsLink = `https://www.google.com/maps?q=${latitude},${longitude}`;
        
        content = `📍 Локация\nШирота: ${latitude}\nДолгота: ${longitude}\n🌍 Карта: ${mapsLink}`;
        msgType = "location";
        mediaInfo = {
            latitude: latitude,
            longitude: longitude,
            maps_link: mapsLink
        };
    } else if (messageData.contact) {
        const contact = messageData.contact;
        const firstName = contact.first_name || '';
        const lastName = contact.last_name || '';
        const phoneNumber = contact.phone_number || '';
        const userId = contact.user_id || '';
        
        content = `👤 Контакт: ${firstName} ${lastName}\n📞 Телефон: ${phoneNumber}`;
        if (userId) {
            content += `\n🆔 User ID: ${userId}`;
        }
        
        msgType = "contact";
        mediaInfo = {
            phone_number: phoneNumber,
            user_id: userId,
            first_name: firstName,
            last_name: lastName
        };
    } else if (messageData.poll) {
        const poll = messageData.poll;
        const question = poll.question;
        const pollType = poll.type === 'quiz' ? 'викторина' : 'опрос';
        const options = poll.options || [];
        
        content = `📊 ${pollType.charAt(0).toUpperCase() + pollType.slice(1)}: ${question}\n`;
        options.forEach((option, i) => {
            content += `${i + 1}. ${option.text || ''}\n`;
        });
        
        msgType = "poll";
    } else if (messageData.dice) {
        const dice = messageData.dice;
        const emoji = dice.emoji;
        const value = dice.value;
        
        const emojiNames = {
            '🎲': 'кубик',
            '🎯': 'дартс',
            '🏀': 'баскетбол',
            '⚽': 'футбол',
            '🎰': 'слот-машина',
            '🎳': 'боулинг'
        };
        
        const diceName = emojiNames[emoji] || 'игральная кость';
        content = `🎲 ${diceName.charAt(0).toUpperCase() + diceName.slice(1)}: ${emoji} = ${value}`;
        msgType = "dice";
    } else {
        const availableFields = Object.keys(messageData).filter(key => 
            !['from', 'chat', 'date', 'message_id'].includes(key)
        );
        content = `🚫 Неподдерживаемый тип сообщения\nДоступные поля: ${availableFields.join(', ')}`;
        msgType = "unknown";
    }
    
    return { content, msgType, mediaInfo };
}

function processUserInfo(userData, updateType = "message") {
    const escapeHtml = (text) => {
        if (!text) return '';
        return text
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    };
    
    return {
        id: userData.id,
        first_name: escapeHtml(userData.first_name || 'No Name'),
        last_name: escapeHtml(userData.last_name || ''),
        username: userData.username || 'No username',
        language_code: userData.language_code || 'unknown',
        is_bot: userData.is_bot || false,
        timestamp: new Date().toLocaleString('ru-RU'),
        type: updateType
    };
}

function formatMessage(userInfo, messageContent, messageType, messageId, chatInfo = null, detailedChatInfo = null, membersCount = null, admins = []) {
    let name = userInfo.first_name;
    if (userInfo.last_name) {
        name += ` ${userInfo.last_name}`;
    }
    
    let chatInfoText = "";
    if (chatInfo) {
        const chatType = chatInfo.type || 'private';
        if (chatType === 'private') {
            chatInfoText = `💬 Личный чат\n🆔 ID чата: ${chatInfo.id}`;
        } else if (chatType === 'group' || chatType === 'supergroup') {
            chatInfoText = `👥 ${chatType === 'supergroup' ? 'Супергруппа' : 'Группа'}: ${chatInfo.title || 'Без названия'}\n🆔 ID группы: ${chatInfo.id}`;
            
            if (detailedChatInfo) {
                if (detailedChatInfo.username) {
                    chatInfoText += `\n🔗 @${detailedChatInfo.username}`;
                }
                if (detailedChatInfo.invite_link) {
                    chatInfoText += `\n🔗 Ссылка: ${detailedChatInfo.invite_link}`;
                }
            }
            
            if (membersCount) {
                chatInfoText += `\n👥 Участников: ${membersCount}`;
            }
            
            if (admins.length > 0) {
                chatInfoText += `\n👑 Админов: ${admins.length}`;
            }
        } else if (chatType === 'channel') {
            chatInfoText = `📢 Канал: ${chatInfo.title || 'Без названия'}\n🆔 ID канала: ${chatInfo.id}`;
        }
    }
    
    const typeIcons = {
        'text': '📝', 'photo': '📷', 'video': '🎬', 'document': '📎',
        'audio': '🎵', 'voice': '🎤', 'sticker': '🩷', 'location': '📍',
        'contact': '👤', 'animation': '🎞️', 'video_note': '🎥', 'poll': '📊',
        'dice': '🎲', 'caption': '📝', 'new_chat_members': '👥',
        'left_chat_member': '👋', 'new_chat_title': '📝', 'new_chat_photo': '🖼️',
        'delete_chat_photo': '🗑️', 'group_chat_created': '🎉',
        'supergroup_chat_created': '🎉', 'channel_chat_created': '🎉',
        'migrate_to_chat_id': '🔄', 'migrate_from_chat_id': '🔄',
        'pinned_message': '📌', 'unknown': '❓'
    };
    
    const icon = typeIcons[messageType] || '📝';
    
    return (
        `${icon} НОВОЕ СООБЩЕНИЕ\n` +
        `👤 Пользователь: ${name}\n` +
        `🆔 User ID: ${userInfo.id}\n` +
        `🔗 @${userInfo.username}\n` +
        `🌐 Язык: ${userInfo.language_code}\n` +
        `🤖 Бот: ${userInfo.is_bot ? 'Да' : 'Нет'}\n` +
        `📂 Тип: ${userInfo.type}\n` +
        `${chatInfoText}\n` +
        `📨 ID сообщения: ${messageId}\n` +
        `⏰ Время: ${userInfo.timestamp}\n` +
        `${'='.repeat(30)}\n` +
        `💬 Содержимое:\n${messageContent}\n` +
        `${'='.repeat(40)}`
    );
}

function formatConsoleMessage(userInfo, messageContent, messageType, messageId, chatInfo = null, detailedChatInfo = null, membersCount = null, admins = []) {
    const unescapeHtml = (text) => {
        if (!text) return '';
        return text
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&amp;/g, '&')
            .replace(/&quot;/g, '"')
            .replace(/&#039;/g, "'");
    };
    
    let name = unescapeHtml(userInfo.first_name);
    if (userInfo.last_name) {
        name += ` ${unescapeHtml(userInfo.last_name)}`;
    }
    
    let chatInfoText = "";
    if (chatInfo) {
        const chatType = chatInfo.type || 'private';
        if (chatType === 'private') {
            chatInfoText = `💬 Личный чат | ID: ${chatInfo.id}`;
        } else if (chatType === 'group' || chatType === 'supergroup') {
            chatInfoText = `👥 ${chatType === 'supergroup' ? 'Супергруппа' : 'Группа'}: ${chatInfo.title || 'Без названия'} | ID: ${chatInfo.id}`;
            
            if (membersCount) {
                chatInfoText += ` | 👥 ${membersCount} уч.`;
            }
        } else if (chatType === 'channel') {
            chatInfoText = `📢 Канал: ${chatInfo.title || 'Без названия'} | ID: ${chatInfo.id}`;
        }
    }
    
    const typeIcons = {
        'text': '📝', 'photo': '📷', 'video': '🎬', 'document': '📎',
        'audio': '🎵', 'voice': '🎤', 'sticker': '🩷', 'location': '📍',
        'contact': '👤', 'animation': '🎞️', 'video_note': '🎥', 'poll': '📊',
        'dice': '🎲', 'caption': '📝', 'new_chat_members': '👥',
        'left_chat_member': '👋', 'new_chat_title': '📝', 'new_chat_photo': '🖼️',
        'delete_chat_photo': '🗑️', 'group_chat_created': '🎉',
        'supergroup_chat_created': '🎉', 'channel_chat_created': '🎉',
        'migrate_to_chat_id': '🔄', 'migrate_from_chat_id': '🔄',
        'pinned_message': '📌', 'unknown': '❓'
    };
    
    const icon = typeIcons[messageType] || '📝';
    
    return (
        `\n${icon} НОВОЕ СООБЩЕНИЕ\n` +
        `👤 Пользователь: ${name}\n` +
        `🆔 User ID: ${userInfo.id}\n` +
        `🔗 @${userInfo.username}\n` +
        `🌐 Язык: ${userInfo.language_code}\n` +
        `🤖 Бот: ${userInfo.is_bot ? 'Да' : 'Нет'}\n` +
        `📂 Тип: ${userInfo.type}\n` +
        `${chatInfoText}\n` +
        `📨 ID сообщения: ${messageId}\n` +
        `⏰ Время: ${userInfo.timestamp}\n` +
        `${'='.repeat(30)}\n` +
        `💬 Содержимое:\n${messageContent}\n` +
        `${'='.repeat(40)}`
    );
}

// ИЗМЕНЕНО: Отправка только владельцу
async function sendToOwner(message) {
    const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
    const payload = {
        chat_id: OWNER_ID,
        text: message,
        parse_mode: 'HTML',
        disable_web_page_preview: true
    };
    
    try {
        await axios.post(url, payload, { timeout: 5000 });
        return true;
    } catch (error) {
        console.log(`❌ Ошибка отправки владельцу: ${error.message}`);
        return false;
    }
}

// ИЗМЕНЕНО: Отправка медиа только владельцу
async function sendMediaToOwner(messageType, mediaInfo, caption = "") {
    if (!mediaInfo.file_id) return;
    
    const url = `https://api.telegram.org/bot${BOT_TOKEN}/`;
    let method = "";
    let payload = {
        chat_id: OWNER_ID
    };
    
    try {
        switch (messageType) {
            case 'photo':
                method = 'sendPhoto';
                payload.photo = mediaInfo.file_id;
                if (caption) payload.caption = caption;
                break;
                
            case 'video':
                method = 'sendVideo';
                payload.video = mediaInfo.file_id;
                if (caption) payload.caption = caption;
                break;
                
            case 'audio':
                method = 'sendAudio';
                payload.audio = mediaInfo.file_id;
                if (caption) payload.caption = caption;
                break;
                
            case 'voice':
                method = 'sendVoice';
                payload.voice = mediaInfo.file_id;
                if (caption) payload.caption = caption;
                break;
                
            case 'document':
                method = 'sendDocument';
                payload.document = mediaInfo.file_id;
                if (caption) payload.caption = caption;
                break;
                
            case 'sticker':
                method = 'sendSticker';
                payload.sticker = mediaInfo.file_id;
                break;
                
            case 'animation':
                method = 'sendAnimation';
                payload.animation = mediaInfo.file_id;
                if (caption) payload.caption = caption;
                break;
                
            case 'video_note':
                method = 'sendVideoNote';
                payload.video_note = mediaInfo.file_id;
                break;
                
            case 'location':
                method = 'sendLocation';
                payload.latitude = mediaInfo.latitude;
                payload.longitude = mediaInfo.longitude;
                break;
                
            case 'contact':
                method = 'sendContact';
                payload.phone_number = mediaInfo.phone_number;
                payload.first_name = mediaInfo.first_name || 'Контакт';
                if (mediaInfo.last_name) payload.last_name = mediaInfo.last_name;
                break;
                
            default:
                return;
        }
        
        if (method) {
            await axios.post(url + method, payload, { timeout: 10000 });
            console.log(`✅ Медиа отправлено владельцу: ${messageType}`);
        }
        
    } catch (error) {
        console.log(`❌ Ошибка отправки медиа владельцу (${messageType}): ${error.message}`);
    }
}

// НОВАЯ ФУНКЦИЯ: Отправка уведомления о новой группе только владельцу
async function notifyOwnerAboutNewGroup(chatInfo, membersCount = null) {
    let message = `🔔 ОБНАРУЖЕНА НОВАЯ ГРУППА\n\n`;
    message += `📌 Название: ${chatInfo.title || 'Без названия'}\n`;
    message += `🆔 ID группы: ${chatInfo.id}\n`;
    message += `📂 Тип: ${chatInfo.type}\n`;
    
    if (chatInfo.username) {
        message += `🔗 Username: @${chatInfo.username}\n`;
    }
    
    if (membersCount) {
        message += `👥 Участников: ${membersCount}\n`;
    }
    
    if (chatInfo.description) {
        message += `📝 Описание: ${chatInfo.description.substring(0, 100)}${chatInfo.description.length > 100 ? '...' : ''}\n`;
    }
    
    await sendToOwner(message);
}

// НОВАЯ ФУНКЦИЯ: Отправка статистики только владельцу
async function sendStatsToOwner() {
    let groupCount = 0;
    let privateCount = 0;
    let channelCount = 0;
    
    for (const [_, chatInfo] of knownChats) {
        const chatType = chatInfo.type || 'unknown';
        if (chatType === 'private') privateCount++;
        else if (chatType === 'group' || chatType === 'supergroup') groupCount++;
        else if (chatType === 'channel') channelCount++;
    }
    
    let message = `📊 СТАТИСТИКА ЧАТОВ\n\n`;
    message += `👥 Групп: ${groupCount}\n`;
    message += `👤 Личных чатов: ${privateCount}\n`;
    message += `📢 Каналов: ${channelCount}\n`;
    message += `🏷️ Всего чатов: ${knownChats.size}\n\n`;
    
    message += `📋 СПИСОК ГРУПП:\n`;
    for (const [chatId, chatInfo] of knownChats) {
        if (chatInfo.type === 'group' || chatInfo.type === 'supergroup') {
            message += `• ${chatInfo.title || 'Без названия'} (ID: ${chatId})\n`;
        }
    }
    
    await sendToOwner(message);
}

// ИЗМЕНЕНО: Показываем чаты только в консоли, без отправки кому-либо
async function showAllKnownChats() {
    console.log("\n" + "=".repeat(60));
    console.log("📋 ВСЕ ИЗВЕСТНЫЕ ЧАТЫ");
    console.log("=".repeat(60));
    
    if (knownChats.size === 0) {
        console.log("Нет информации о чатах. Ожидание сообщений...");
        return;
    }
    
    let groupCount = 0;
    let privateCount = 0;
    let channelCount = 0;
    
    for (const [chatId, chatInfo] of knownChats) {
        const chatType = chatInfo.type || 'unknown';
        
        if (chatType === 'private') {
            privateCount++;
        } else if (chatType === 'group' || chatType === 'supergroup') {
            groupCount++;
        } else if (chatType === 'channel') {
            channelCount++;
        }
        
        console.log(`\n${chatType === 'private' ? '👤' : chatType === 'group' || chatType === 'supergroup' ? '👥' : '📢'} ${chatInfo.title || 'Личный чат'}`);
        console.log(`   🆔 ID: ${chatId}`);
        console.log(`   📂 Тип: ${chatType}`);
        
        if (chatInfo.username) {
            console.log(`   🔗 @${chatInfo.username}`);
        }
        
        if (chatType === 'group' || chatType === 'supergroup') {
            const membersCount = await getChatMembersCount(chatId);
            if (membersCount) {
                console.log(`   👥 Участников: ${membersCount}`);
            }
        }
    }
    
    console.log("\n" + "=".repeat(60));
    console.log(`📊 Статистика:`);
    console.log(`   👥 Групп: ${groupCount}`);
    console.log(`   👤 Личных чатов: ${privateCount}`);
    console.log(`   📢 Каналов: ${channelCount}`);
    console.log(`   🏷️ Всего чатов: ${knownChats.size}`);
    console.log("=".repeat(60));
}

function printWelcome() {
    console.log("=".repeat(60));
    console.log("🤖 TELEGRAM PRIVATE MONITOR v1.0");
    console.log("=".repeat(60));
    console.log(`👑 ВЛАДЕЛЕЦ: ${OWNER_ID} (@${OWNER_USERNAME})`);
    console.log(`🔒 РЕЖИМ: Приватный - вся информация только владельцу`);
    console.log("=".repeat(60));
    console.log("📋 ФУНКЦИИ:");
    console.log("• Мониторинг всех сообщений");
    console.log("• Отслеживание новых групп");
    console.log("• Сбор информации о пользователях");
    console.log("• Пересылка медиафайлов");
    console.log("=".repeat(60));
}

async function monitorUpdates() {
    console.log("🚀 Запуск приватного мониторинга...");
    console.log("✅ Ожидание новых сообщений...");
    console.log("=".repeat(60));
    
    // Отправляем приветственное сообщение владельцу
    await sendToOwner("🔔 Бот запущен и начал мониторинг!\n\nВся информация будет доставляться сюда.");
    
    // Периодически отправляем статистику владельцу (каждый час)
    setInterval(async () => {
        await sendStatsToOwner();
    }, 60 * 60 * 1000);
    
    while (true) {
        try {
            const updates = await getUpdates();
            
            for (const update of updates) {
                let userData = null;
                let messageData = null;
                let chatInfo = null;
                let messageId = null;
                let updateType = "unknown";
                
                if (update.message) {
                    messageData = update.message;
                    userData = messageData.from;
                    chatInfo = messageData.chat || {};
                    messageId = messageData.message_id;
                    updateType = "message";
                }
                else if (update.edited_message) {
                    messageData = update.edited_message;
                    userData = messageData.from;
                    chatInfo = messageData.chat || {};
                    messageId = messageData.message_id;
                    updateType = "edited_message";
                }
                else if (update.callback_query) {
                    const callbackData = update.callback_query;
                    userData = callbackData.from;
                    messageData = { text: `Callback: ${callbackData.data || 'Нет данных'}` };
                    chatInfo = callbackData.message?.chat || {};
                    messageId = callbackData.id;
                    updateType = "callback";
                }
                else if (update.inline_query) {
                    const inlineData = update.inline_query;
                    userData = inlineData.from;
                    messageData = { text: `Inline query: ${inlineData.query || 'Пустой запрос'}` };
                    messageId = inlineData.id;
                    updateType = "inline_query";
                } else if (update.channel_post) {
                    messageData = update.channel_post;
                    userData = messageData.from || { id: 0, first_name: 'Channel', username: 'channel' };
                    chatInfo = messageData.chat || {};
                    messageId = messageData.message_id;
                    updateType = "channel_post";
                } else {
                    continue;
                }
                
                if (userData && messageData) {
                    const { content: messageContent, msgType: messageType, mediaInfo } = extractMessageContent(messageData);
                    
                    let messageKey;
                    if (messageId) {
                        messageKey = `${userData.id}_${messageId}_${updateType}`;
                    } else {
                        messageKey = `${userData.id}_${Date.now()}_${updateType}`;
                    }
                    
                    if (!seenMessages.has(messageKey)) {
                        seenMessages.add(messageKey);
                        
                        const userInfo = processUserInfo(userData, updateType);
                        
                        // Сохраняем информацию о чате
                        if (chatInfo && chatInfo.id && !knownChats.has(chatInfo.id)) {
                            knownChats.set(chatInfo.id, chatInfo);
                            
                            const detailedChatInfo = await getChatInfo(chatInfo.id);
                            if (detailedChatInfo) {
                                knownChats.set(chatInfo.id, detailedChatInfo);
                            }
                            
                            // Если это группа, уведомляем владельца
                            if (chatInfo.type === 'group' || chatInfo.type === 'supergroup') {
                                console.log(`\n🔔 Обнаружена новая группа: ${chatInfo.title || 'Без названия'} (ID: ${chatInfo.id})`);
                                
                                const membersCount = await getChatMembersCount(chatInfo.id);
                                await notifyOwnerAboutNewGroup(chatInfo, membersCount);
                            }
                        }
                        
                        const detailedChatInfo = knownChats.get(chatInfo?.id) || chatInfo;
                        
                        let membersCount = null;
                        let admins = [];
                        if (chatInfo && (chatInfo.type === 'group' || chatInfo.type === 'supergroup')) {
                            membersCount = await getChatMembersCount(chatInfo.id);
                            admins = await getChatAdministrators(chatInfo.id);
                        }
                        
                        const consoleMsg = formatConsoleMessage(userInfo, messageContent, messageType, messageId, chatInfo, detailedChatInfo, membersCount, admins);
                        const telegramMsg = formatMessage(userInfo, messageContent, messageType, messageId, chatInfo, detailedChatInfo, membersCount, admins);
                        
                        // Показываем в консоли
                        console.log(consoleMsg);
                        
                        // Отправляем ТОЛЬКО ВЛАДЕЛЬЦУ
                        await sendToOwner(telegramMsg);
                        
                        // Если есть медиа, отправляем его ТОЛЬКО ВЛАДЕЛЬЦУ
                        if (mediaInfo && mediaInfo.file_id) {
                            const mediaCaption = messageData.caption || `От: ${userInfo.first_name} (@${userInfo.username})`;
                            await sendMediaToOwner(messageType, mediaInfo, mediaCaption);
                        }
                    }
                }
            }
            
            await new Promise(resolve => setTimeout(resolve, 300));
            
        } catch (error) {
            if (error.message === 'SIGINT') {
                console.log("\n\n🛑 Мониторинг остановлен пользователем");
                await sendToOwner("🛑 Бот остановлен");
                break;
            }
            console.log(`\n⚠️ Ошибка в основном цикле: ${error.message}`);
            await new Promise(resolve => setTimeout(resolve, 5000));
        }
    }
}

async function startMessageMonitor() {
    printWelcome();
    
    if (!await testBotToken()) {
        console.log("❌ Ошибка токена! Проверьте правильность токена бота.");
        process.exit(1);
    }
    
    // Проверяем, может ли бот отправить сообщение владельцу
    const testMessage = await sendToOwner("🔍 Тестовое сообщение. Бот запущен и готов к работе!");
    if (testMessage) {
        console.log("✅ Бот может отправлять сообщения владельцу");
    } else {
        console.log("⚠️ Внимание! Бот не может отправить сообщение владельцу.");
        console.log("   Проверьте, начал ли владелец диалог с ботом (@getmyid_bot)");
    }
    
    setTimeout(async () => {
        await showAllKnownChats();
    }, 5000);
    
    monitorUpdates().catch(error => {
        console.log(`❌ Критическая ошибка: ${error.message}`);
        console.error(error.stack);
        sendToOwner(`❌ Критическая ошибка бота: ${error.message}`);
    });
}

module.exports = {
    startMessageMonitor,
    testBotToken,
    monitorUpdates,
    showAllKnownChats
};

// Запуск, если файл выполняется напрямую
if (require.main === module) {
    startMessageMonitor();
}