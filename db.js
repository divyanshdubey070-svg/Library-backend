import { Sequelize, DataTypes } from "sequelize";
import dotenv from "dotenv";
dotenv.config();

// Connect to SQLite Local Database
const sequelize = new Sequelize({
    dialect: "sqlite",
    storage: "./database.sqlite", // Data will be stored ONLY in this local file on the PC
    logging: false
});

export const connectDB = async () => {
    try {
        await sequelize.authenticate();
        console.log("✅ Local Offline Database Connected successfully");
        
        // Auto-create/update tables
        await sequelize.sync({ alter: true });
        console.log("✅ Offline Tables Synced");
    } catch (error) {
        console.error("❌ Local Database Connection Error:", error);
        process.exit(1);
    }
};

// User Model
export const User = sequelize.define("User", {
    uid: { type: DataTypes.STRING, primaryKey: true, unique: true },
    email: { type: DataTypes.STRING, allowNull: false, unique: true },
    passwordHash: { type: DataTypes.STRING, allowNull: false },
    fullName: { type: DataTypes.STRING },
    phone: { type: DataTypes.STRING },
    enrollment: { type: DataTypes.STRING },
    semester: { type: DataTypes.STRING },
    department: { type: DataTypes.STRING },
    role: { type: DataTypes.STRING, defaultValue: "user" }
});

// Book Model
export const Book = sequelize.define("Book", {
    isbn: { type: DataTypes.STRING, primaryKey: true, unique: true },
    title: { type: DataTypes.STRING, allowNull: false },
    author: { type: DataTypes.STRING },
    department: { type: DataTypes.STRING },
    description: { type: DataTypes.TEXT },
    quantity: { type: DataTypes.INTEGER, defaultValue: 1 },
    available: { type: DataTypes.INTEGER, defaultValue: 1 },
    eBookLink: { type: DataTypes.STRING }
});

// BorrowedBook Model
export const BorrowedBook = sequelize.define("BorrowedBook", {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    userId: { type: DataTypes.STRING, allowNull: false },
    bookId: { type: DataTypes.STRING, allowNull: false },
    title: { type: DataTypes.STRING },
    issuedAt: { type: DataTypes.DATE, defaultValue: Sequelize.NOW },
    dueDate: { type: DataTypes.DATE },
    returned: { type: DataTypes.BOOLEAN, defaultValue: false },
    returnedAt: { type: DataTypes.DATE },
    renewed: { type: DataTypes.BOOLEAN, defaultValue: false }
});

// ActivityLog Model
export const ActivityLog = sequelize.define("ActivityLog", {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    userId: { type: DataTypes.STRING, allowNull: false },
    action: { type: DataTypes.STRING, allowNull: false },
    timestamp: { type: DataTypes.DATE, defaultValue: Sequelize.NOW }
});
