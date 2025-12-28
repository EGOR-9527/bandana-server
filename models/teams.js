// models/teams.js
const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const Teams = sequelize.define("Teams", {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  name: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  city: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  ageRange: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  instructors: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  choreographer: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  achievements: {
    type: DataTypes.JSON,
    allowNull: true,
    defaultValue: [],
  },
  photoFileId: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  fileName: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  isRecruiting: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  },
  fileUrl: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
});

module.exports = Teams;