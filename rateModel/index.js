const sequelize = require("../config/db");
const User = require("./User");
const Chat = require("./Chat");
const Message = require("./Message");

// Associations
User.hasMany(Message, { foreignKey: "user_id", as: "messages" });
Message.belongsTo(User, { foreignKey: "user_id", as: "user" });

Chat.hasMany(Message, { foreignKey: "chat_id", as: "messages" });
Message.belongsTo(Chat, { foreignKey: "chat_id", as: "chat" });

async function syncDatabase() {
  try {
    await sequelize.authenticate();
    console.log("✅ База данных подключена");
    await sequelize.sync({ alter: true });
    console.log("✅ Таблицы синхронизированы");
  } catch (error) {
    console.error("❌ Ошибка БД:", error.message);
    process.exit(1);
  }
}

module.exports = { sequelize, User, Chat, Message, syncDatabase };