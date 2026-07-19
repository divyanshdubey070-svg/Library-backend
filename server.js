import dotenv from "dotenv";
dotenv.config();

import express from "express";
import cookieParser from "cookie-parser";
import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";
import multer from "multer";
import fs from "fs";

import { randomBytes } from "crypto";
import { createServer } from "http";
import { Server } from "socket.io";
import path from "path";
import { fileURLToPath } from "url";
import { connectDB, User, BorrowedBook, ActivityLog, Book, ReturnedBook, Whitelist } from "./db.js";
import { Op } from "sequelize";

// Initialize Database
await connectDB();

// Ensure default Admin user exists in SQLite
try {
  const adminEmail = "admin@example.com";
  const adminUser = await User.findOne({ where: { email: adminEmail } });
  if (!adminUser) {
    const hash = await bcrypt.hash("admin123", 10);
    await User.create({
      uid: "uid-admin",
      email: adminEmail,
      passwordHash: hash,
      fullName: "System Admin",
      role: "admin",
      isVerified: true
    });
    console.log("✅ Default admin user created in database");
  }
} catch (err) {
  console.error("❌ Admin seeding error:", err);
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Serve static files from the public directory
app.use(express.static(path.join(__dirname, "public")));

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "*", 
    methods: ["GET", "POST"]
  }
});

/* -------------------- Socket.io -------------------- */
io.on("connection", (socket) => {
  console.log("A user connected via WebSocket:", socket.id);

  socket.on("message", (msg) => {
    io.emit("message", msg);
  });

  socket.on("signup", async (data, callback) => {
    try {
      const { email, password, fullName, phone, enrollment, semester, department } = data;
      const existingUser = await User.findOne({ where: { email } });
      if (existingUser) return callback({ error: "Email already exists" });

      // Whitelist Verification
      const whitelistStudent = await Whitelist.findOne({ where: { enrollment } });
      if (!whitelistStudent) {
        return callback({ error: "Verification Failed: Your Enrollment Number is not in the approved college database." });
      }

      if (whitelistStudent.email.toLowerCase() !== email.toLowerCase()) {
        return callback({ error: `Security Alert: The email address provided does not match the official records for Enrollment ${enrollment}. Please use your registered college email.` });
      }

      if (whitelistStudent.isClaimed) {
        return callback({ error: "Security Alert: An account has already been registered with this Enrollment Number." });
      }

      const passwordHash = await bcrypt.hash(password, 10);
      const uid = randomBytes(16).toString("hex");

      const newUser = await User.create({
        uid, email, passwordHash, fullName, phone, enrollment, semester, department, isVerified: true
      });

      await whitelistStudent.update({ isClaimed: true });

      const accessToken = signAccessToken(uid, newUser.role);
      callback({ success: true, accessToken, user: { uid, role: newUser.role, fullName } });
    } catch (err) {
      console.error(err);
      callback({ error: "Signup failed" });
    }
  });

  socket.on("login", async (data, callback) => {
    try {
      const { email, password } = data;
      const user = await User.findOne({ where: { email } });
      if (!user) return callback({ error: "Invalid credentials" });

      if (user.suspended) return callback({ error: "Your account is suspended. Please contact the administrator." });

      const ok = await bcrypt.compare(password, user.passwordHash);
      if (!ok) return callback({ error: "Invalid credentials" });

      const accessToken = signAccessToken(user.uid, user.role);
      callback({ success: true, accessToken, user: { uid: user.uid, role: user.role, fullName: user.fullName } });
    } catch (err) {
      console.error(err);
      callback({ error: "Login failed" });
    }
  });

  const otpStore = new Map();

  socket.on("sendForgotPasswordOTP", async (data, callback) => {
    try {
      const { email, enrollment, phone } = data;
      const user = await User.findOne({ 
        where: { 
          email: email.toLowerCase().trim(), 
          enrollment: enrollment.trim(), 
          phone: phone.trim() 
        } 
      });
      
      if (!user) {
        return callback({ error: "No student profile matches these details." });
      }

      // Generate random 6-digit OTP
      const otp = Math.floor(100000 + Math.random() * 900000).toString();
      otpStore.set(email.toLowerCase().trim(), otp);
      
      // Auto-delete OTP after 5 minutes
      setTimeout(() => {
        otpStore.delete(email.toLowerCase().trim());
      }, 5 * 60 * 1000);

      // Log OTP to server console for testing
      console.log(`\n========================================\n[OTP RESET ALERT] OTP for ${email}: ${otp}\n========================================\n`);
      
      callback({ success: true });
    } catch (err) {
      console.error("sendForgotPasswordOTP error:", err);
      callback({ error: "Failed to generate OTP" });
    }
  });

  socket.on("verifyForgotPasswordOTP", async (data, callback) => {
    try {
      const { email, otp, newPassword } = data;
      const cachedOtp = otpStore.get(email.toLowerCase().trim());
      
      // Allow 123456 as a default test bypass OTP
      if (otp !== "123456" && (!cachedOtp || cachedOtp !== otp.trim())) {
        return callback({ error: "Invalid or expired OTP." });
      }

      const user = await User.findOne({ where: { email: email.toLowerCase().trim() } });
      if (!user) {
        return callback({ error: "Student not found." });
      }

      const passwordHash = await bcrypt.hash(newPassword, 10);
      await user.update({ passwordHash });
      
      // Clean up OTP cache
      otpStore.delete(email.toLowerCase().trim());
      
      callback({ success: true });
    } catch (err) {
      console.error("verifyForgotPasswordOTP error:", err);
      callback({ error: "Failed to reset password" });
    }
  });

  socket.on("fetchDashboardData", async (data, callback) => {
    try {
      const { uid } = data;
      const books = await BorrowedBook.findAll({ 
        where: { userId: uid, returned: { [Op.or]: [false, 0] } } 
      });
      callback({ success: true, books });
    } catch (err) {
      callback({ error: "Failed to fetch dashboard data" });
    }
  });

  socket.on("fetchLogs", async (data, callback) => {
    try {
      const { uid } = data;
      const logs = await ActivityLog.findAll({
        where: { userId: uid },
        order: [['timestamp', 'DESC']]
      });
      callback({ success: true, logs });
    } catch (err) {
      callback({ error: "Failed to fetch logs" });
    }
  });

  socket.on("renewBook", async (data, callback) => {
    try {
      const { bookId, currentDueDateStr } = data;
      const currentDueDate = new Date(currentDueDateStr);
      const newDueDate = new Date(currentDueDate);
      newDueDate.setDate(newDueDate.getDate() + 7);

      await BorrowedBook.update(
        { dueDate: newDueDate, renewed: true },
        { where: { id: bookId } }
      );

      io.emit("bookUpdated");
      callback({ success: true, newDueDate });
    } catch (err) {
      callback({ error: "Failed to renew book" });
    }
  });

  socket.on("fetchAllBooks", async (callback) => {
    try {
      const books = await Book.findAll();
      callback({ success: true, books });
    } catch (err) {
      callback({ error: "Failed to fetch books" });
    }
  });

  socket.on("addBook", async (data, callback) => {
    try {
      const { isbn, title, author, department, description, quantity, eBookLink } = data;
      const existing = await Book.findOne({ where: { isbn } });
      if (existing) {
        existing.quantity += quantity;
        existing.available += quantity;
        await existing.save();
      } else {
        await Book.create({
          isbn, title, author, department, description, quantity, available: quantity, eBookLink
        });
      }
      const books = await Book.findAll();
      io.emit("booksUpdated", books);
      callback({ success: true });
    } catch (err) {
      callback({ error: "Failed to add book" });
    }
  });

  socket.on("updateBook", async (data, callback) => {
    try {
      const { isbn, title, author, department, description, quantity, eBookLink } = data;
      const book = await Book.findOne({ where: { isbn } });
      if (!book) {
        return callback({ error: "Book not found" });
      }
      
      const diff = quantity - book.quantity;
      const newAvailable = Math.max(0, book.available + diff);
      
      await book.update({
        title,
        author,
        department,
        description,
        quantity,
        available: newAvailable,
        eBookLink
      });

      const books = await Book.findAll();
      io.emit("booksUpdated", books);
      callback({ success: true });
    } catch (err) {
      console.error("updateBook Error:", err);
      callback({ error: "Failed to update book" });
    }
  });

  socket.on("deleteBook", async (data, callback) => {
    try {
      const { isbn } = data;
      const book = await Book.findOne({ where: { isbn } });
      if (!book) {
        return callback({ error: "Book not found" });
      }
      await book.destroy();
      const books = await Book.findAll();
      io.emit("booksUpdated", books);
      callback({ success: true });
    } catch (err) {
      console.error("deleteBook Error:", err);
      callback({ error: "Failed to delete book" });
    }
  });

  // --- BARCODE SCANNER ENDPOINTS (FIXED) ---
  socket.on("scanBook", async (data, callback) => {
    try {
      const { isbn, uid } = data;
      const book = await Book.findOne({ where: { isbn } });
      if (!book) return callback({ success: false, found: false });

      // Find user role
      const user = await User.findOne({ where: { uid } });
      const isAdmin = user && user.role === "admin";

      // Check if THIS user has borrowed this book
      const myActiveBorrow = await BorrowedBook.findOne({
        where: { 
          bookId: isbn, 
          userId: uid, 
          returned: { [Op.or]: [false, 0] } 
        }
      });

      // Check if ANYONE has borrowed this book
      const anyActiveBorrow = await BorrowedBook.findOne({
        where: {
          bookId: isbn,
          returned: { [Op.or]: [false, 0] }
        }
      });

      callback({
        success: true,
        found: true,
        book,
        isReturn: isAdmin ? !!anyActiveBorrow : !!myActiveBorrow, // Admin can return if anyone borrowed it
        myBorrow: !!myActiveBorrow,
        anyBorrow: !!anyActiveBorrow
      });
    } catch (err) {
      console.error("scanBook Error:", err);
      callback({ error: "Scanner error" });
    }
  });

  socket.on("transactionBook", async (data, callback) => {
    try {
      const { isbn, uid, actionType } = data;
      const book = await Book.findOne({ where: { isbn } });
      if (!book) return callback({ error: "Book not found" });

      if (actionType === "issue") {
        // Prevent double borrowing
        const alreadyBorrowed = await BorrowedBook.findOne({
          where: { bookId: isbn, userId: uid, returned: { [Op.or]: [false, 0] } }
        });
        if (alreadyBorrowed) return callback({ error: "You already have this book" });

        // 24-hour borrow limit check
        const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const recentlyBorrowed = await BorrowedBook.findOne({
          where: {
            bookId: isbn,
            userId: uid,
            issuedAt: { [Op.gte]: twentyFourHoursAgo }
          }
        });
        if (recentlyBorrowed) {
          return callback({ error: "This book can only be borrowed once every 24 hours. Please return tomorrow." });
        }

        if (book.available <= 0) return callback({ error: "Book is out of stock" });

        book.available -= 1;
        await book.save();

        const dueDate = new Date();
        dueDate.setDate(dueDate.getDate() + 14);

        await BorrowedBook.create({
          userId: uid,
          bookId: isbn,
          title: book.title,
          dueDate,
          returned: false,
          issuedAt: new Date()
        });

      } else if (actionType === "return") {
        // Find user to check role
        const user = await User.findOne({ where: { uid } });
        const isAdmin = user && user.role === "admin";

        let borrowRecord;
        if (isAdmin) {
          // If admin is returning it, find the active borrow record (oldest first)
          borrowRecord = await BorrowedBook.findOne({
            where: { 
              bookId: isbn, 
              returned: { [Op.or]: [false, 0] } 
            },
            order: [['issuedAt', 'ASC']]
          });
        } else {
          // If student is returning it, find their own active borrow record
          borrowRecord = await BorrowedBook.findOne({
            where: { 
              bookId: isbn, 
              userId: uid, 
              returned: { [Op.or]: [false, 0] } 
            }
          });
        }

        if (!borrowRecord) {
          return callback({ error: isAdmin ? "No active borrow record found for this book in the library" : "No active borrow record found for your account" });
        }

        book.available = Math.min(book.available + 1, book.quantity);
        await book.save();

        const now = new Date();
        await borrowRecord.update({ returned: true, returnedAt: now });

        await ReturnedBook.create({
          userId: borrowRecord.userId, // Save the actual borrower's userId, not the admin's uid!
          bookId: isbn,
          title: book.title,
          issuedAt: borrowRecord.issuedAt,
          returnedAt: now
        });
      }

      const books = await Book.findAll();
      io.emit("booksUpdated", books);
      io.emit("bookUpdated"); 

      callback({ success: true });
    } catch (err) {
      console.error("transactionBook Error:", err);
      callback({ error: "Transaction failed" });
    }
  });

  socket.on("fetchReturnedBooks", async (data, callback) => {
    try {
      const { uid } = data;
      const books = await ReturnedBook.findAll({
        where: { userId: uid },
        order: [['returnedAt', 'DESC']]
      });
      callback({ success: true, books });
    } catch (err) {
      callback({ error: "Failed to fetch returned books" });
    }
  });

  // --- Student Profile Handlers ---
  socket.on("fetchProfile", async (data, callback) => {
    try {
      const { uid } = data;
      const user = await User.findOne({ where: { uid } });
      if (!user) return callback({ error: "User not found" });
      callback({
        success: true,
        user: {
          fullName: user.fullName,
          enrollment: user.enrollment,
          semester: user.semester,
          department: user.department,
          email: user.email,
          phone: user.phone
        }
      });
    } catch (err) {
      callback({ error: "Failed to fetch profile" });
    }
  });

  socket.on("updateProfile", async (data, callback) => {
    try {
      const { uid, fullName, enrollment, semester, department } = data;
      const user = await User.findOne({ where: { uid } });
      if (!user) return callback({ error: "User not found" });
      await user.update({ fullName, enrollment, semester, department });
      callback({ success: true });
    } catch (err) {
      callback({ error: "Failed to update profile" });
    }
  });

  // --- Admin Dashboard Handlers ---
  socket.on("adminFetchAllData", async (callback) => {
    try {
      const users = await User.findAll({ order: [['createdAt', 'DESC']] });
      const books = await Book.findAll({ order: [['createdAt', 'DESC']] });
      const borrowedBooks = await BorrowedBook.findAll({ order: [['issuedAt', 'DESC']] });
      const activityLogs = await ActivityLog.findAll({ order: [['timestamp', 'DESC']] });
      const whitelist = await Whitelist.findAll({ order: [['enrollment', 'ASC']] });
      callback({ success: true, users, books, borrowedBooks, activityLogs, whitelist });
    } catch (err) {
      console.error("adminFetchAllData error:", err);
      callback({ error: "Failed to fetch admin data" });
    }
  });

  socket.on("adminToggleSuspend", async (data, callback) => {
    try {
      const { uid, currentStatus } = data;
      const user = await User.findOne({ where: { uid } });
      if (!user) return callback({ error: "User not found" });
      await user.update({ suspended: !currentStatus });
      io.emit("adminDataUpdated");
      callback({ success: true });
    } catch (err) {
      callback({ error: "Failed to update user status" });
    }
  });

  socket.on("adminForceExit", async (data, callback) => {
    try {
      const { uid } = data;
      const activeLog = await ActivityLog.findOne({
        where: { userId: uid, status: 1 }
      });
      if (!activeLog) return callback({ error: "User is not inside library" });
      const timeStr = new Date().toLocaleTimeString('en-US', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: true });
      await activeLog.update({ status: 0, timeOut: timeStr });
      io.emit("adminDataUpdated");
      callback({ success: true });
    } catch (err) {
      callback({ error: "Failed to force exit student" });
    }
  });

  socket.on("adminDeleteBook", async (data, callback) => {
    try {
      const { isbn } = data;
      const book = await Book.findOne({ where: { isbn } });
      if (!book) return callback({ error: "Book not found" });
      const borrowed = book.quantity - book.available;
      if (borrowed > 0) return callback({ error: `Cannot delete. ${borrowed} copies are currently borrowed.` });
      await book.destroy();
      const books = await Book.findAll();
      io.emit("booksUpdated", books);
      io.emit("adminDataUpdated");
      callback({ success: true });
    } catch (err) {
      callback({ error: "Failed to delete book" });
    }
  });

  socket.on("adminEditBook", async (data, callback) => {
    try {
      const { isbn, title, quantity, available } = data;
      const book = await Book.findOne({ where: { isbn } });
      if (!book) return callback({ error: "Book not found" });
      await book.update({ title, quantity, available });
      const books = await Book.findAll();
      io.emit("booksUpdated", books);
      io.emit("adminDataUpdated");
      callback({ success: true });
    } catch (err) {
      callback({ error: "Failed to edit book" });
    }
  });

  socket.on("findStudentByEnrollment", async (data, callback) => {
    try {
      const { enrollment } = data;
      const user = await User.findOne({ where: { enrollment } });
      if (!user) {
        return callback({ error: "Student not registered. Please sign up first." });
      }
      callback({
        success: true,
        user: {
          uid: user.uid,
          fullName: user.fullName,
          enrollment: user.enrollment,
          department: user.department,
          semester: user.semester
        }
      });
    } catch (err) {
      console.error("findStudentByEnrollment error:", err);
      callback({ error: "Database error during student lookup" });
    }
  });

  socket.on("adminDeleteWhitelist", async (data, callback) => {
    try {
      const { enrollment } = data;
      const student = await Whitelist.findOne({ where: { enrollment } });
      if (!student) return callback({ error: "Student not found in whitelist" });
      await student.destroy();
      io.emit("adminDataUpdated");
      callback({ success: true });
    } catch (err) {
      callback({ error: "Failed to delete whitelist student" });
    }
  });

  socket.on("adminAddWhitelist", async (data, callback) => {
    try {
      const { enrollment, name, email, phone, department } = data;
      const existing = await Whitelist.findOne({ where: { enrollment } });
      if (existing) return callback({ error: "Enrollment already whitelisted" });
      await Whitelist.create({ enrollment, name, email, phone, department, isClaimed: false });
      io.emit("adminDataUpdated");
      callback({ success: true });
    } catch (err) {
      callback({ error: "Failed to add student to whitelist" });
    }
  });

  socket.on("adminBulkUploadWhitelist", async (data, callback) => {
    try {
      const { students } = data;
      for (const student of students) {
        const { enrollment, name, email, phone, department } = student;
        if (!enrollment) continue;
        const existing = await Whitelist.findOne({ where: { enrollment } });
        if (existing) {
          await existing.update({ name, email, phone, department });
        } else {
          await Whitelist.create({ enrollment, name, email, phone, department, isClaimed: false });
        }
      }
      io.emit("adminDataUpdated");
      callback({ success: true, count: students.length });
    } catch (err) {
      console.error("adminBulkUploadWhitelist error:", err);
      callback({ error: "Failed to bulk upload whitelist" });
    }
  });

  socket.on("adminScanGateQR", async (data, callback) => {
    try {
      const { enrollment, name, branch, sem, isVerifiedChecked } = data;
      
      if (!enrollment || enrollment === "N/A") {
        return callback({ error: "Invalid QR: Enrollment number is missing." });
      }

      const user = await User.findOne({ where: { enrollment } });
      let correctUserId = user ? user.uid : enrollment;

      if (user && user.isVerified === false) {
        if (!isVerifiedChecked) {
          return callback({ success: true, needsVerification: true, user: { uid: user.uid, fullName: user.fullName, enrollment: user.enrollment } });
        } else {
          await user.update({ isVerified: true });
        }
      }

      const activeLog = await ActivityLog.findOne({
        where: { enrollment, status: 1 }
      });

      const now = new Date();
      const timeStr = now.toLocaleTimeString('en-US', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: true });

      if (!activeLog) {
        // CHECK IN
        await ActivityLog.create({
          userId: correctUserId,
          enrollment: enrollment,
          name: name || "Unknown",
          branch: branch || "-",
          sem: sem || "-",
          status: 1,
          timeIn: timeStr,
          timeOut: null,
          action: "in"
        });
        io.emit("adminDataUpdated");
        callback({ success: true, action: "in", name: name || enrollment });
      } else {
        // CHECK OUT
        const checkInTime = activeLog.createdAt ? new Date(activeLog.createdAt) : now;
        const timeDiffMs = now - checkInTime;
        const COOLDOWN_MS = 1 * 60 * 1000; // 1 minute cooldown

        if (timeDiffMs < COOLDOWN_MS) {
          const remainingMinutes = Math.ceil((COOLDOWN_MS - timeDiffMs) / 60000);
          return callback({ error: `⏳ Wait ${remainingMinutes} min(s) before checking out.` });
        }

        await activeLog.update({
          status: 0,
          timeOut: timeStr,
          action: "out"
        });
        io.emit("adminDataUpdated");
        callback({ success: true, action: "out", name: name || enrollment });
      }
    } catch (error) {
      console.error("adminScanGateQR Error:", error);
      callback({ error: "Database error: " + (error.message || "Unknown error during scan") });
    }
  });

  socket.on("aiChat", async (data, callback) => {
    try {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey || apiKey === "YOUR_GEMINI_API_KEY_HERE" || apiKey.trim() === "") {
        return callback({ error: "Gemini API Key is not set in the server's .env file. Please add GEMINI_API_KEY=your_key to activate the AI." });
      }

      const { message, chatHistory } = data;

      // Fetch library context from SQLite database
      const books = await Book.findAll();
      const activeBorrows = await BorrowedBook.findAll({ where: { returned: { [Op.or]: [false, 0] } } });
      const users = await User.findAll({ where: { role: "user" } });
      
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const todayLogs = await ActivityLog.findAll({
        where: {
          timestamp: {
            [Op.gte]: today
          }
        }
      });

      // Prepare database summary for the system instructions
      const booksSummary = books.map(b => `- ${b.title} (ISBN: ${b.isbn}, Author: ${b.author || 'N/A'}, Dept: ${b.department || 'N/A'}, Stock: ${b.quantity}, Available: ${b.available})`).join("\n");
      const borrowsSummary = activeBorrows.map(b => `- UserID: ${b.userId}, Book: ${b.title} (ISBN: ${b.bookId}), Issued: ${b.issuedAt ? new Date(b.issuedAt).toLocaleDateString() : 'N/A'}, Due: ${b.dueDate ? new Date(b.dueDate).toLocaleDateString() : 'N/A'}`).join("\n");
      const usersSummary = users.map(u => `- Name: ${u.fullName}, Email: ${u.email}, Enroll: ${u.enrollment || 'N/A'}, Dept: ${u.department || 'N/A'}, Status: ${u.suspended ? 'Suspended' : 'Active'}`).join("\n");
      const logsSummary = todayLogs.map(l => `- Student: ${l.name || 'Unknown'}, Enroll: ${l.enrollment || 'N/A'}, IN: ${l.timeIn || '--:--'}, OUT: ${l.timeOut || 'Still Inside'}`).join("\n");

      // Construct system instruction prompt
      const systemPrompt = `You are "AutoLib AI Assistant", a smart, helpful library bot for the AutoLib Ecosystem.
You help library administrators and students analyze statistics, check book availability, monitor active loans, query logs, and understand the platform features.
Speak politely and professionally. If the user chats in Hindi/Hinglish, reply in Hindi/Hinglish. If in English, reply in English.
Today is: ${new Date().toDateString()} (Format: Day Month Date Year).

=== PLATFORM FEATURES ===

[ADMIN WEBSITE (Web Dashboard)]
The AutoLib Admin Website is a full-featured library management portal accessible from a browser. It includes:
- **Login & Authentication**: Secure JWT-based login for admins and students. Only whitelisted students (pre-approved by the college) can register.
- **Admin Dashboard** (admin-dashboard.html): Shows total books count, borrowed count, and provides tabs for:
  - Today's Gate logs (students who entered/exited the library today)
  - Gate History (past check-in/out records)
  - Active Borrows (currently issued books with due dates)
  - Return History (past returns)
  - Waitlists
  - Inventory Management
  - Approved Students list
  - Manual Issue/Return of books
  - QR Code scanner for student gate check-in/check-out
- **Books Catalog** (book.html): Browse, search, and filter all library books by department. Admins can:
  - Add new books (with ISBN, title, author, department, quantity, description, and optional E-Book/PDF URL)
  - Edit existing books (update title, author, quantity, department, description, and E-Book URL via the Edit Stock button)
  - Delete books
  - Scan barcodes to add books
  - View book details including availability, current borrowers, and digital copy links
- **Student Dashboard** (dashboard.html): Students can view their own borrow history, active loans, and profile.
- **Profile Page** (profile.html): Users can view and update their profile info (name, phone, enrollment, semester, department).
- **Email Verification** (verification.html): OTP-based email verification for new accounts.
- **AI Chatbot**: This assistant (you!) is available on every page to help with library queries.

[MOBILE APP (AutoLib App - React Native/Expo)]
The AutoLib Mobile App is built with React Native and Expo. It includes:
- **Login Screen**: Students log in with email and password.
- **Register Screen**: New students can register with full name, email, password, phone, enrollment number, semester, and department. Only whitelisted students can register.
- **Home Screen**: Shows a welcome dashboard with quick stats and recent activity.
- **Books Screen**: Browse the full library catalog with search and department filters. Each book shows:
  - Title, author, department, ISBN
  - Availability status (available count or "Not Available")
  - E-Book/PDF badge — tapping "📱 Read PDF" opens the Google Drive or PDF link in the phone browser
- **QR Screen**: Displays the student's personal QR code (Library ID card). Students show this at the library entrance for the librarian to scan for entry/exit logging.
- **History Screen**: View personal borrow history and past transactions.
- **Profile Screen**: View and edit personal profile information.

[KEY FEATURES SUMMARY]
- Students can borrow and return books (managed by admin via Manual Issue/Return or barcode scanning)
- Gate check-in/check-out via QR code scanning
- Real-time updates via WebSocket (Socket.IO) — all connected clients see changes instantly
- E-Book/PDF support: If a physical book is not available, students can read the digital PDF copy
- Books can have 0 physical quantity (digital-only books with PDF links)
- Barcode scanner for quick ISBN entry when adding books
- Department-based filtering on both website and app

=== LIVE DATABASE STATE ===

[INVENTORY]
${booksSummary || "No books in catalog."}

[ACTIVE BORROWS]
${borrowsSummary || "No books currently borrowed."}

[REGISTERED STUDENTS]
${usersSummary || "No students registered."}

[TODAY'S VISIT LOGS]
${logsSummary || "No students visited the library today."}
---

Use this context to answer user questions. For example:
- If asked about "overdue books", look at the [ACTIVE BORROWS] section and check if any borrow due date is before today (${new Date().toDateString()}).
- If asked about book availability, look at the [INVENTORY] section and check if 'Available' is greater than 0.
- If asked about check-in/out logs, look at [TODAY'S VISIT LOGS] or explain recent activity.
- If asked "what can this app/website do?" or "what features are available?", refer to the [PLATFORM FEATURES] sections above.
- If asked about "study" or features unrelated to library data, explain the platform's features from the sections above.
Keep your answers clear, concise, and highlight critical items. If the question is not about the library, its stats, or platform features, answer politely but try to guide them back to library assistance. Do not make up fake books or borrows that are not listed in the context.`;

      // Build payload for Gemini API
      const contents = [];
      
      // Feed chat history to maintain conversation state
      if (chatHistory && Array.isArray(chatHistory)) {
        chatHistory.forEach(ch => {
          contents.push({
            role: ch.role === "user" ? "user" : "model",
            parts: [{ text: ch.text }]
          });
        });
      }

      // Add current message
      contents.push({
        role: "user",
        parts: [{ text: message }]
      });

      // API Endpoint for Google AI Studio Gemini API (using gemini-3.5-flash)
      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${apiKey}`;

      const apiResponse = await fetch(geminiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          contents,
          systemInstruction: {
            parts: [{ text: systemPrompt }]
          }
        })
      });

      if (!apiResponse.ok) {
        const errorText = await apiResponse.text();
        console.error("Gemini API Request Failed:", errorText);
        return callback({ error: `Gemini API request failed: Status ${apiResponse.status}` });
      }

      const resJson = await apiResponse.json();
      
      if (resJson.error) {
        console.error("Gemini API returned error:", resJson.error);
        return callback({ error: resJson.error.message || "Failed to get reply from Gemini AI." });
      }

      const replyText = resJson.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!replyText) {
        return callback({ error: "Received empty content response from Gemini AI." });
      }

      callback({ success: true, reply: replyText });
    } catch (error) {
      console.error("aiChat Event Error:", error);
      callback({ error: "Server Error: " + error.message });
    }
  });

  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);
  });
});

app.use(express.json());
app.use(cookieParser());
app.use(express.static(__dirname));

const sessionStore = new Map();
const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || "my_super_secret_access_key_123!";
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || "my_super_secret_refresh_key_456!";
const ACCESS_EXPIRES = Number(process.env.ACCESS_EXPIRES) || 86400;
const REFRESH_EXPIRES = Number(process.env.REFRESH_EXPIRES) || 604800;
const PORT = process.env.PORT || 4000;

const users = {
  "admin@example.com": {
    id: "uid-admin",
    passwordHash: await bcrypt.hash("admin123", 10),
    role: "admin",
  }
};

function signAccessToken(userId, role) {
  return jwt.sign({ sub: userId, role }, ACCESS_SECRET, { expiresIn: ACCESS_EXPIRES });
}

function signRefreshToken(sessionId, userId) {
  return jwt.sign({ sid: sessionId, sub: userId }, REFRESH_SECRET, { expiresIn: REFRESH_EXPIRES });
}

app.post("/auth/login", async (req, res) => {
  const { email, password } = req.body;
  const user = users[email];
  if (!user) return res.status(401).json({ error: "Invalid credentials" });
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return res.status(401).json({ error: "Invalid credentials" });

  const sessionId = randomBytes(16).toString("hex");
  const refreshToken = signRefreshToken(sessionId, user.id);
  const accessToken = signAccessToken(user.id, user.role);

  sessionStore.set(`refresh:${sessionId}`, JSON.stringify({ userId: user.id, role: user.role }));
  setTimeout(() => sessionStore.delete(`refresh:${sessionId}`), REFRESH_EXPIRES * 1000);

  res.cookie("refresh_token", refreshToken, {
    httpOnly: true, secure: true, sameSite: "lax", maxAge: REFRESH_EXPIRES * 1000,
  });

  res.json({ message: "Login successful", accessToken, role: user.role });
});

app.post("/auth/refresh", async (req, res) => {
  const token = req.cookies.refresh_token;
  if (!token) return res.status(401).json({ error: "No refresh token" });
  try {
    const payload = jwt.verify(token, REFRESH_SECRET);
    const session = sessionStore.get(`refresh:${payload.sid}`);
    if (!session) return res.status(401).json({ error: "Session expired" });
    const data = JSON.parse(session);
    const newSid = randomBytes(16).toString("hex");
    const newAccess = signAccessToken(payload.sub, data.role);
    res.json({ accessToken: newAccess });
  } catch (err) {
    res.status(401).json({ error: "Invalid token" });
  }
});

app.post("/auth/logout", async (req, res) => {
  res.clearCookie("refresh_token");
  res.json({ message: "Logged out" });
});

function authenticate(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth) return res.status(401).json({ error: "Missing token" });
  try {
    req.user = jwt.verify(auth.split(" ")[1], ACCESS_SECRET);
    next();
  } catch (e) {
    return res.status(401).json({ error: "Invalid token" });
  }
}

// Configure multer storage for PDF uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const dir = "./uploads";
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    cb(null, dir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, file.fieldname + "-" + uniqueSuffix + ext);
  }
});

const upload = multer({ 
  storage: storage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype === "application/pdf") {
      cb(null, true);
    } else {
      cb(new Error("Only PDF files are allowed!"), false);
    }
  }
});

// Serve the uploads folder statically
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

app.post("/api/upload-pdf", upload.single("pdf"), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }
    const fileUrl = `${req.protocol}://${req.get("host")}/uploads/${req.file.filename}`;
    res.json({ success: true, url: fileUrl });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});



app.get(/.*/, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

httpServer.listen(PORT, () => console.log(`Auth server running on port ${PORT}`));