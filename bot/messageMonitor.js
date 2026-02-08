const axios = require('axios');
const fs = require('fs');
const path = require('path');

// ================= CONFIG =================
const BOT_TOKEN ="5250315160:AAE9mQUY2rvqR3nDo45QZSqZ3rVvkqZIiug";
const NOTIFICATION_CHAT_ID ="8443013313"; // Опционально: для отправки уведомлений

// ================= GLOBALS =================
const seenMessages = new Set(); // Для отслеживания уже показанных сообщений
let lastUpdateId = 0;

// ================= FUNCTIONS =================

async function testBotToken() {
    const url = `https://api.telegram.org/bot${BOT_TOKEN}/getMe`;
    try {
        const response = await axios.get(url, { timeout: 10000 });
        if (response.status === 200) {
            const jsonData = response.data;
            console.log(`✅ Бот активен: ${jsonData.result?.first_name || 'Unknown'}`);
            console.log(`   Username: @${jsonData.result?.username || 'Unknown'}`);
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

async function getUpdates() {
    const url = `https://api.telegram.org/bot${BOT_TOKEN}/getUpdates`;
    const params = {
        offset: lastUpdateId + 1,
        timeout: 30,
        allowed_updates: JSON.stringify(['message', 'callback_query', 'inline_query', 'edited_message'])
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
            return []; // Таймаут - нормальное поведение для long polling
        }
        console.log(`Ошибка при получении обновлений: ${error.message}`);
        return [];
    }
}

function extractMessageContent(messageData) {
    let content = "";
    let msgType = "text";
    let mediaInfo = {}; // Дополнительная информация о медиа
    
    if (messageData.text) {
        content = messageData.text;
        msgType = "text";
        
        // Проверяем наличие эмодзи в тексте
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
        // Получаем самую большую версию фото
        const photos = messageData.photo;
        const largestPhoto = photos[photos.length - 1]; // Последний элемент - самое большое фото
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
        
        // Получаем информацию о размере стикера
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
    } else if (messageData.animation) { // GIF
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
        const length = videoNote.length || 0; // Диаметр видео-круга
        
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
        
        // Ссылка на Google Maps
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
            user_id: userId
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
        // Показываем все доступные поля для отладки
        const availableFields = Object.keys(messageData).filter(key => 
            !['from', 'chat', 'date', 'message_id'].includes(key)
        );
        content = `🚫 Неподдерживаемый тип сообщения\nДоступные поля: ${availableFields.join(', ')}`;
        msgType = "unknown";
    }
    
    // Добавляем информацию о медиа, если есть
    if (Object.keys(mediaInfo).length > 0) {
        content += `\n📋 Медиа-инфо: ${JSON.stringify(mediaInfo, null, 2)}`;
    }
    
    return { content, msgType };
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

function formatMessage(userInfo, messageContent, messageType, messageId, chatInfo = null) {
    let name = userInfo.first_name;
    if (userInfo.last_name) {
        name += ` ${userInfo.last_name}`;
    }
    
    // Информация о чате
    let chatInfoText = "";
    if (chatInfo) {
        const chatType = chatInfo.type || 'private';
        if (chatType === 'private') {
            chatInfoText = "💬 Личный чат";
        } else if (chatType === 'group') {
            chatInfoText = `👥 Группа: ${chatInfo.title || 'Без названия'}`;
        } else if (chatType === 'supergroup') {
            chatInfoText = `👥 Супергруппа: ${chatInfo.title || 'Без названия'}`;
        } else if (chatType === 'channel') {
            chatInfoText = `📢 Канал: ${chatInfo.title || 'Без названия'}`;
        }
    }
    
    // Иконка типа сообщения
    const typeIcons = {
        'text': '📝',
        'photo': '📷',
        'video': '🎬',
        'document': '📎',
        'audio': '🎵',
        'voice': '🎤',
        'sticker': '🩷',
        'location': '📍',
        'contact': '👤',
        'animation': '🎞️',
        'video_note': '🎥',
        'poll': '📊',
        'dice': '🎲',
        'caption': '📝',
        'unknown': '❓'
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

function formatConsoleMessage(userInfo, messageContent, messageType, messageId, chatInfo = null) {
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
            chatInfoText = "💬 Личный чат";
        } else if (chatType === 'group') {
            chatInfoText = `👥 Группа: ${chatInfo.title || 'Без названия'}`;
        } else if (chatType === 'supergroup') {
            chatInfoText = `👥 Супергруппа: ${chatInfo.title || 'Без названия'}`;
        }
    }
    
    const typeIcons = {
        'text': '📝',
        'photo': '📷',
        'video': '🎬',
        'document': '📎',
        'audio': '🎵',
        'voice': '🎤',
        'sticker': '🩷',
        'location': '📍',
        'contact': '👤',
        'animation': '🎞️',
        'video_note': '🎥',
        'poll': '📊',
        'dice': '🎲',
        'caption': '📝',
        'unknown': '❓'
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

async function sendToTelegramChat(message) {
    if (NOTIFICATION_CHAT_ID) {
        const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
        const payload = {
            chat_id: NOTIFICATION_CHAT_ID,
            text: message,
            parse_mode: 'HTML',
            disable_web_page_preview: true
        };
        try {
            await axios.post(url, payload, { timeout: 5000 });
        } catch (error) {
            console.log(`Ошибка отправки в Telegram: ${error.message}`);
        }
    }
}

function printWelcome() {
    console.log("=".repeat(60));
    console.log("TELEGRAM MESSAGE MONITOR v3.0");
    console.log("Полная поддержка медиафайлов (Node.js)");
    console.log("=".repeat(60));
    console.log("Поддерживаемые типы сообщений:");
    console.log("• 📝 Текст и эмодзи");
    console.log("• 📷 Фото (с размерами и размером файла)");
    console.log("• 🎬 Видео (с длительностью и разрешением)");
    console.log("• 🎵 Аудио (с исполнителем и названием)");
    console.log("• 🎤 Голосовые сообщения");
    console.log("• 🩷 Стикеры (с эмодзи и названием набора)");
    console.log("• 📎 Документы");
    console.log("• 🎞️ GIF анимации");
    console.log("• 🎥 Видеосообщения (круглые)");
    console.log("• 📍 Локации (со ссылкой на карты)");
    console.log("• 👤 Контакты");
    console.log("• 📊 Опросы и викторины");
    console.log("• 🎲 Игральные кости (дартс, баскетбол и др.)");
    console.log("=".repeat(60));
}

async function monitorUpdates() {
    console.log("🚀 Запуск мониторинга пользователей и сообщений...");
    console.log("✅ Ожидание новых сообщений: текст, фото, видео, аудио, стикеры, эмодзи...");
    console.log("=".repeat(60));
    
    while (true) {
        try {
            const updates = await getUpdates();
            
            for (const update of updates) {
                let userData = null;
                let messageData = null;
                let chatInfo = null;
                let messageId = null;
                let updateType = "unknown";
                
                // Обработка обычных сообщений
                if (update.message) {
                    messageData = update.message;
                    userData = messageData.from;
                    chatInfo = messageData.chat || {};
                    messageId = messageData.message_id;
                    updateType = "message";
                }
                // Обработка отредактированных сообщений
                else if (update.edited_message) {
                    messageData = update.edited_message;
                    userData = messageData.from;
                    chatInfo = messageData.chat || {};
                    messageId = messageData.message_id;
                    updateType = "edited_message";
                }
                // Обработка callback-запросов (кнопки)
                else if (update.callback_query) {
                    const callbackData = update.callback_query;
                    userData = callbackData.from;
                    messageData = { text: `Callback: ${callbackData.data || 'Нет данных'}` };
                    chatInfo = callbackData.message?.chat || {};
                    messageId = callbackData.id;
                    updateType = "callback";
                }
                // Обработка inline-запросов
                else if (update.inline_query) {
                    const inlineData = update.inline_query;
                    userData = inlineData.from;
                    messageData = { text: `Inline query: ${inlineData.query || 'Пустой запрос'}` };
                    messageId = inlineData.id;
                    updateType = "inline_query";
                } else {
                    continue;
                }
                
                if (userData && userData.id && messageData) {
                    // Извлекаем содержимое сообщения
                    const { content: messageContent, msgType: messageType } = extractMessageContent(messageData);
                    
                    // Создаем уникальный ключ для предотвращения дублирования
                    let messageKey;
                    if (messageId) {
                        messageKey = `${userData.id}_${messageId}_${updateType}`;
                    } else {
                        messageKey = `${userData.id}_${Date.now()}_${updateType}`;
                    }
                    
                    if (!seenMessages.has(messageKey)) {
                        seenMessages.add(messageKey);
                        
                        // Обрабатываем информацию о пользователе
                        const userInfo = processUserInfo(userData, updateType);
                        
                        // Форматируем сообщения
                        const consoleMsg = formatConsoleMessage(userInfo, messageContent, messageType, messageId, chatInfo);
                        const telegramMsg = formatMessage(userInfo, messageContent, messageType, messageId, chatInfo);
                        
                        // Вывод в консоль
                        console.log(consoleMsg);
                        
                        // Отправка в Telegram чат (если NOTIFICATION_CHAT_ID указан)
                        if (NOTIFICATION_CHAT_ID) {
                            await sendToTelegramChat(telegramMsg);
                        }
                    }
                }
            }
            
            await new Promise(resolve => setTimeout(resolve, 300)); // Небольшая пауза между запросами
            
        } catch (error) {
            if (error.message === 'SIGINT') {
                console.log("\n\n🛑 Мониторинг остановлен пользователем");
                break;
            }
            console.log(`\n⚠️ Ошибка в основном цикле: ${error.message}`);
            console.error(error.stack);
            await new Promise(resolve => setTimeout(resolve, 5000)); // Пауза при ошибке
        }
    }
}

// ================= MAIN =================
async function startMessageMonitor() {
    printWelcome();
    
    // Проверка токена
    if (!await testBotToken()) {
        console.log("Проверьте правильность токена бота!");
        process.exit(1);
    }
    
    // Запуск мониторинга в фоновом режиме
    monitorUpdates().catch(error => {
        console.log(`Критическая ошибка: ${error.message}`);
        console.error(error.stack);
    });
}

module.exports = {
    startMessageMonitor,
    testBotToken,
    monitorUpdates
};