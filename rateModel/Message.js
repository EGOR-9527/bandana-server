const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const Message = sequelize.define("Message", {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  telegram_message_id: {
    type: DataTypes.BIGINT,
    allowNull: true,
  },
  update_type: {
    type: DataTypes.STRING(30),
    allowNull: false,
    defaultValue: "message",
  },
  message_type: {
    type: DataTypes.STRING(30),
    allowNull: false,
    defaultValue: "text",
  },
  content: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  user_id: {
    type: DataTypes.BIGINT,
    allowNull: true,
  },
  chat_id: {
    type: DataTypes.BIGINT,
    allowNull: true,
  },
  file_id: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  file_size: {
    type: DataTypes.BIGINT,
    allowNull: true,
  },
  is_edited: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },
  sent_at: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW,
  },
});

module.exports = Message;