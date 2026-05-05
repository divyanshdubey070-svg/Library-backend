import mongoose from "mongoose";

// Connect to MongoDB
export const connectDB = async () => {
    try {
        const uri = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/edushelf";
        await mongoose.connect(uri);
        console.log("✅ MongoDB Connected successfully");
    } catch (error) {
        console.error("❌ MongoDB Connection Error:", error);
        process.exit(1);
    }
};

// User Schema
const userSchema = new mongoose.Schema({
    uid: { type: String, required: true, unique: true },
    email: { type: String, required: true, unique: true },
    passwordHash: { type: String, required: true },
    fullName: { type: String },
    phone: { type: String },
    enrollment: { type: String },
    semester: { type: String },
    department: { type: String },
    role: { type: String, default: "user" }
});
export const User = mongoose.model("User", userSchema);

// BorrowedBook Schema
const borrowedBookSchema = new mongoose.Schema({
    userId: { type: String, required: true },
    bookId: { type: String, required: true },
    title: { type: String },
    issuedAt: { type: Date, default: Date.now },
    dueDate: { type: Date },
    returned: { type: Boolean, default: false },
    returnedAt: { type: Date },
    renewed: { type: Boolean, default: false }
});
export const BorrowedBook = mongoose.model("BorrowedBook", borrowedBookSchema);

// ActivityLog Schema
const activityLogSchema = new mongoose.Schema({
    userId: { type: String, required: true },
    action: { type: String, required: true },
    timestamp: { type: Date, default: Date.now }
});
export const ActivityLog = mongoose.model("ActivityLog", activityLogSchema);

// Book Schema (Inventory)
const bookSchema = new mongoose.Schema({
    isbn: { type: String, required: true, unique: true },
    title: { type: String, required: true },
    author: { type: String },
    department: { type: String },
    description: { type: String },
    quantity: { type: Number, default: 1 },
    available: { type: Number, default: 1 },
    eBookLink: { type: String },
    createdAt: { type: Date, default: Date.now }
});
export const Book = mongoose.model("Book", bookSchema);
