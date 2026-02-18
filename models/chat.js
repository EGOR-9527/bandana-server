const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const Chat = sequelize.define("Chat", {
  id: {
    type: DataTypes.BIGINT,
    primaryKey: true,
    autoIncrement: false,
  },
  type: {
    type: DataTypes.ENUM("private", "group", "supergroup", "channel"),
    allowNull: false,
  },
  title: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  username: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  invite_link: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  members_count: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  admins_count: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  message_count: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
  },
  first_seen: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW,
  },
  last_activity: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW,
  },
});

module.exports = Chat;