import dotenv from "dotenv";
dotenv.config();

import express from "express";
import cookieParser from "cookie-parser";
import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";
import { createClient } from "redis";
import { randomBytes } from "crypto";
import { createServer } from "http";
import { Server } from "socket.io";
import path from "path";
import { fileURLToPath } from "url";
import { connectDB, User, BorrowedBook, ActivityLog, Book } from "./db.js";

// Initialize Database
await connectDB();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Serve static files from the public directory
app.use(express.static(path.join(__dirname, "public")));

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "*", // Change this to your frontend URL in production
    methods: ["GET", "POST"]
  }
});

/* -------------------- Socket.io -------------------- */
io.on("connection", (socket) => {
  console.log("A user connected via WebSocket:", socket.id);

  socket.on("message", (msg) => {
    console.log("Message from client:", msg);
    // Broadcast to all clients
    io.emit("message", msg); 
  });

  socket.on("signup", async (data, callback) => {
    try {
      const { email, password, fullName, phone, enrollment, semester, department } = data;
      
      const existingUser = await User.findOne({ email });
      if (existingUser) return callback({ error: "Email already exists" });

      const passwordHash = await bcrypt.hash(password, 10);
      const uid = randomBytes(16).toString("hex");

      const newUser = new User({
        uid, email, passwordHash, fullName, phone, enrollment, semester, department
      });
      await newUser.save();

      // Auto login after signup
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
      const user = await User.findOne({ email });
      if (!user) return callback({ error: "Invalid credentials" });

      const ok = await bcrypt.compare(password, user.passwordHash);
      if (!ok) return callback({ error: "Invalid credentials" });

      const accessToken = signAccessToken(user.uid, user.role);
      callback({ success: true, accessToken, user: { uid: user.uid, role: user.role, fullName: user.fullName } });
    } catch (err) {
      console.error(err);
      callback({ error: "Login failed" });
    }
  });

  // --- DATA EVENTS ---
  socket.on("fetchDashboardData", async (data, callback) => {
    try {
      const { uid } = data;
      const books = await BorrowedBook.find({ userId: uid });
      callback({ success: true, books });
    } catch (err) {
      console.error(err);
      callback({ error: "Failed to fetch dashboard data" });
    }
  });

  socket.on("fetchLogs", async (data, callback) => {
    try {
      const { uid } = data;
      const logs = await ActivityLog.find({ userId: uid }).sort({ timestamp: -1 });
      callback({ success: true, logs });
    } catch (err) {
      console.error(err);
      callback({ error: "Failed to fetch logs" });
    }
  });

  socket.on("renewBook", async (data, callback) => {
    try {
      const { bookId, currentDueDateStr } = data;
      const currentDueDate = new Date(currentDueDateStr);
      const newDueDate = new Date(currentDueDate);
      newDueDate.setDate(newDueDate.getDate() + 7);

      await BorrowedBook.findByIdAndUpdate(bookId, { dueDate: newDueDate, renewed: true });
      
      // Emit an update to everyone or just the specific room if implemented
      io.emit("bookUpdated", { bookId, newDueDate });
      
      callback({ success: true, newDueDate });
    } catch (err) {
      console.error(err);
      callback({ error: "Failed to renew book" });
    }
  });

  // --- BOOK INVENTORY ENDPOINTS ---
  socket.on("fetchAllBooks", async (callback) => {
    try {
      const books = await Book.find({});
      callback({ success: true, books });
    } catch (err) {
      console.error("fetchAllBooks Error:", err);
      callback({ error: "Failed to fetch books" });
    }
  });

  socket.on("addBook", async (data, callback) => {
    try {
      const { isbn, title, author, department, description, quantity, eBookLink } = data;
      
      const existing = await Book.findOne({ isbn });
      if (existing) {
        // Update existing book
        existing.quantity += quantity;
        existing.available += quantity;
        await existing.save();
      } else {
        // Create new book
        const newBook = new Book({
          isbn, title, author, department, description, quantity, available: quantity, eBookLink
        });
        await newBook.save();
      }
      
      // Broadcast update
      const books = await Book.find({});
      io.emit("booksUpdated", books);
      
      callback({ success: true });
    } catch (err) {
      console.error("addBook Error:", err);
      callback({ error: "Failed to add book" });
    }
  });

  // --- BARCODE SCANNER ENDPOINTS ---
  socket.on("scanBook", async (data, callback) => {
    try {
      const { isbn, uid } = data;
      const book = await Book.findOne({ isbn });
      if (!book) return callback({ success: false, found: false });

      // Check if user already borrowed this book
      const borrowRecord = await BorrowedBook.findOne({ userId: uid, bookId: isbn, returned: false });
      
      callback({ 
        success: true, 
        found: true, 
        book, 
        isReturn: !!borrowRecord,
        borrowRecord
      });
    } catch (err) {
      console.error("scanBook Error:", err);
      callback({ error: "Scanner error" });
    }
  });

  socket.on("transactionBook", async (data, callback) => {
    try {
      const { isbn, uid, actionType } = data;
      const book = await Book.findOne({ isbn });
      if (!book) return callback({ error: "Book not found" });

      if (actionType === "issue") {
        if (book.available <= 0) return callback({ error: "Book is out of stock" });
        
        book.available -= 1;
        await book.save();

        const dueDate = new Date();
        dueDate.setDate(dueDate.getDate() + 14);

        const newBorrow = new BorrowedBook({
          userId: uid,
          bookId: isbn,
          title: book.title,
          dueDate,
          renewed: false,
          returned: false,
          issuedAt: new Date()
        });
        await newBorrow.save();
        
      } else if (actionType === "return") {
        const borrowRecord = await BorrowedBook.findOne({ userId: uid, bookId: isbn, returned: false });
        if (!borrowRecord) return callback({ error: "No active borrow record found" });

        book.available = Math.min(book.available + 1, book.quantity);
        await book.save();

        borrowRecord.returned = true;
        borrowRecord.returnedAt = new Date();
        await borrowRecord.save();
      }

      // Broadcast changes
      const books = await Book.find({});
      io.emit("booksUpdated", books);
      io.emit("bookUpdated"); // Trigger dashboard refresh

      callback({ success: true });
    } catch (err) {
      console.error("transactionBook Error:", err);
      callback({ error: "Transaction failed" });
    }
  });

  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);
  });
});
app.use(express.json());
app.use(cookieParser());
app.use(express.static(__dirname));

/* -------------------- Redis -------------------- */
const redis = createClient({ url: process.env.REDIS_URL });
redis.on("error", (err) => console.error("Redis error:", err));
await redis.connect();

/* -------------------- Environment -------------------- */
const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || "my_super_secret_access_key_123!";
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || "my_super_secret_refresh_key_456!";
const ACCESS_EXPIRES = Number(process.env.ACCESS_EXPIRES) || 86400;
const REFRESH_EXPIRES = Number(process.env.REFRESH_EXPIRES) || 604800;
const PORT = process.env.PORT || 4000;

/* -------------------- Dummy users (example) -------------------- */
const users = {
  "admin@example.com": {
    id: "uid-admin",
    passwordHash: await bcrypt.hash("admin123", 10),
    role: "admin",
  },
  "user@example.com": {
    id: "uid-user",
    passwordHash: await bcrypt.hash("user123", 10),
    role: "user",
  },
};

/* -------------------- Token Generators -------------------- */
function signAccessToken(userId, role) {
  return jwt.sign({ sub: userId, role }, ACCESS_SECRET, {
    expiresIn: ACCESS_EXPIRES,
  });
}

function signRefreshToken(sessionId, userId) {
  return jwt.sign({ sid: sessionId, sub: userId }, REFRESH_SECRET, {
    expiresIn: REFRESH_EXPIRES,
  });
}

/* -------------------- AUTH ENDPOINTS -------------------- */

// LOGIN
app.post("/auth/login", async (req, res) => {
  const { email, password } = req.body;

  const user = users[email];
  if (!user) return res.status(401).json({ error: "Invalid credentials" });

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return res.status(401).json({ error: "Invalid credentials" });

  const sessionId = randomBytes(16).toString("hex");
  const refreshToken = signRefreshToken(sessionId, user.id);
  const accessToken = signAccessToken(user.id, user.role);

  // Save refresh session in Redis
  await redis.set(
    `refresh:${sessionId}`,
    JSON.stringify({ userId: user.id, role: user.role }),
    { EX: REFRESH_EXPIRES }
  );

  // Set refresh token as secure httpOnly cookie
  res.cookie("refresh_token", refreshToken, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: REFRESH_EXPIRES * 1000,
  });

  res.json({
    message: "Login successful",
    accessToken: accessToken,
    role: user.role,
  });
});

// REFRESH
app.post("/auth/refresh", async (req, res) => {
  const token = req.cookies.refresh_token;
  if (!token) return res.status(401).json({ error: "No refresh token" });

  try {
    const payload = jwt.verify(token, REFRESH_SECRET);
    const { sid, sub } = payload;

    const session = await redis.get(`refresh:${sid}`);
    if (!session) return res.status(401).json({ error: "Session expired" });

    const data = JSON.parse(session);

    const newSid = randomBytes(16).toString("hex");
    const newRefresh = signRefreshToken(newSid, sub);
    const newAccess = signAccessToken(sub, data.role);

    await redis.del(`refresh:${sid}`);
    await redis.set(
      `refresh:${newSid}`,
      JSON.stringify(data),
      { EX: REFRESH_EXPIRES }
    );

    res.cookie("refresh_token", newRefresh, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      maxAge: REFRESH_EXPIRES * 1000,
    });

    res.json({ accessToken: newAccess });
  } catch (err) {
    res.status(401).json({ error: "Invalid token" });
  }
});

// LOGOUT
app.post("/auth/logout", async (req, res) => {
  const token = req.cookies.refresh_token;
  if (token) {
    try {
      const payload = jwt.verify(token, REFRESH_SECRET);
      await redis.del(`refresh:${payload.sid}`);
    } catch (e) {}
  }
  res.clearCookie("refresh_token");
  res.json({ message: "Logged out" });
});

/* -------------------- PROTECTED ROUTE -------------------- */
function authenticate(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth) return res.status(401).json({ error: "Missing token" });

  const token = auth.split(" ")[1];

  try {
    const payload = jwt.verify(token, ACCESS_SECRET);
    req.user = payload;
    next();
  } catch (e) {
    return res.status(401).json({ error: "Invalid token" });
  }
}

app.get("/admin/data", authenticate, (req, res) => {
  if (req.user.role !== "admin")
    return res.status(403).json({ error: "Forbidden" });

  res.json({ message: "Admin secret data" });
});

app.get("/user/data", authenticate, (req, res) => {
  res.json({ message: "User data", userId: req.user.sub });
});

// Fallback route to serve index.html for unknown routes (SPA behavior)
app.get(/.*/, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

/* -------------------- START SERVER -------------------- */
httpServer.listen(PORT, () => console.log(`Auth server running on port ${PORT}`));
