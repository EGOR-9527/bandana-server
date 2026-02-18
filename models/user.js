const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const User = sequelize.define("User", {
  id: {
    type: DataTypes.BIGINT,
    primaryKey: true,
    autoIncrement: false,
  },
  username: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  first_name: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  last_name: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  language_code: {
    type: DataTypes.STRING(10),
    allowNull: true,
  },
  is_bot: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },
  is_premium: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },
  message_count: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
  },
  first_seen: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW,
  },
  last_active: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW,
  },
  chats_seen_in: {
    type: DataTypes.ARRAY(DataTypes.BIGINT),
    defaultValue: [],
  },
});

module.exports = User;