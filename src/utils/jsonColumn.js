const { DataTypes } = require('sequelize');

// Stores JSON in a TEXT column. Portable across MySQL 5.7/8 and MariaDB
// (MariaDB's JSON type is a LONGTEXT alias that mysql2 returns as a string).
function jsonColumn(name, defaultValue = []) {
  return {
    type: DataTypes.TEXT('long'),
    allowNull: true,
    get() {
      const raw = this.getDataValue(name);
      if (raw === null || raw === undefined || raw === '') return structuredClone(defaultValue);
      try {
        return JSON.parse(raw);
      } catch {
        return structuredClone(defaultValue);
      }
    },
    set(value) {
      this.setDataValue(name, value === null || value === undefined ? null : JSON.stringify(value));
    },
  };
}

module.exports = jsonColumn;
