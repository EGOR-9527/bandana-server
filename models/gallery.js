const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const Gallery = sequelize.define("Gallery", {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  fileName: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  fileUrl: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  filter: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  footer: {
    type: DataTypes.STRING,
    allowNull: false,
  },
});

module.exports = Gallery;
