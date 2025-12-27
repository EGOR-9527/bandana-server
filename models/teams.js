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
    type: DataTypes.STRING,
    allowNull: true,
  },
  instructors: { 
    type: DataTypes.STRING,
    allowNull: true,
  },
  choreographer: { 
    type: DataTypes.STRING,
    allowNull: true,
  },
  achievements: {
    type: DataTypes.JSON,
    allowNull: true,
    defaultValue: [],
  },
  photoFileId: {   
    type: DataTypes.STRING,
    allowNull: true,
  },
  fileName: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  fileUrl: {
    type: DataTypes.STRING,
    allowNull: true,
  },
});

module.exports = Teams;
