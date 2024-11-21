import express from "express";
import sqlite3 from "sqlite3";
import { open } from "sqlite";
import crypto from "crypto";
import path from "path";
import { fileURLToPath } from "url";
import { URL } from "url";
import dotenv from "dotenv";
import rateLimit from "express-rate-limit";
import cookieParser from "cookie-parser";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = 3000;
const MAX_URL_LENGTH = 2048;

// API key from environment variable
const API_KEY = process.env.API_KEY;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
});

app.use(limiter);

// Session token for check-duplicate
const sessionTokens = new Map();

// Database setup
let db;
(async () => {
  db = await open({
    filename: "meme_links.db",
    driver: sqlite3.Database,
  });

  // Create table if not exists
  await db.run(`CREATE TABLE IF NOT EXISTS links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    url TEXT NOT NULL,
    datetime TEXT NOT NULL,
    flag CHAR(1) NOT NULL,
    hash TEXT NOT NULL UNIQUE
  )`);

  // Create indexes
  await db.run(`CREATE INDEX IF NOT EXISTS idx_hash ON links (hash)`);
  await db.run(`CREATE INDEX IF NOT EXISTS idx_flag ON links (flag)`);
})();

// Helper function to process URL
function processUrl(url) {
  const parsedUrl = new URL(url);
  return `${parsedUrl.protocol}//${parsedUrl.host}${parsedUrl.pathname}`;
}

// Middleware to check API key
function checkApiKey(req, res, next) {
  const providedApiKey = req.body.apiKey;
  if (!providedApiKey || providedApiKey !== API_KEY) {
    return res.status(401).json({ error: "Invalid API key" });
  }
  next();
}

// Middleware to check session token
function checkSessionToken(req, res, next) {
  const sessionToken = req.cookies.sessionToken;
  if (!sessionToken || !sessionTokens.has(sessionToken)) {
    console.log("Session token validation failed");
    return res.status(401).json({ error: "Invalid session" });
  }
  next();
}

// Routes
app.get("/", (req, res) => {
  const sessionToken = crypto.randomBytes(32).toString("hex");
  sessionTokens.set(sessionToken, Date.now());
  res.cookie("sessionToken", sessionToken, {
    httpOnly: true,
    sameSite: "strict",
  });
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/api/check-duplicate", checkSessionToken, async (req, res) => {
  const { url } = req.query;
  if (!url) {
    return res.status(400).json({ error: "URL is required" });
  }
  if (url.length > MAX_URL_LENGTH) {
    return res.status(400).json({
      error: `URL is too long. Maximum length is ${MAX_URL_LENGTH} characters.`,
    });
  }
  try {
    const processedUrl = processUrl(url);
    const hash = crypto.createHash("sha256").update(processedUrl).digest("hex");
    const result = await db.get("SELECT * FROM links WHERE hash = ?", hash);
    res.json({ isDuplicate: !!result });
  } catch (error) {
    console.error("Error checking for duplicate:", error);
    res.status(500).json({ error: "Error checking for duplicate" });
  }
});

app.post("/api/submit-link", checkSessionToken, async (req, res) => {
  let { url } = req.body;
  if (!url) {
    return res.status(400).json({ error: "URL is required" });
  }
  if (url.length > MAX_URL_LENGTH) {
    return res.status(400).json({
      error: `URL is too long. Maximum length is ${MAX_URL_LENGTH} characters.`,
    });
  }
  try {
    url = processUrl(url);
  } catch (error) {
    return res.status(400).json({ error: "Invalid URL" });
  }
  const datetime = new Date().toISOString();
  const flag = "N";
  const hash = crypto.createHash("sha256").update(url).digest("hex");
  try {
    await db.run(
      "INSERT INTO links (url, datetime, flag, hash) VALUES (?, ?, ?, ?)",
      [url, datetime, flag, hash]
    );
    res.json({ success: true, message: "Link saved successfully" });
  } catch (error) {
    if (error.code === "SQLITE_CONSTRAINT") {
      res.status(409).json({ error: "Duplicate link", isDuplicate: true });
    } else {
      console.error("Error saving link:", error);
      res.status(500).json({ error: "Error saving link" });
    }
  }
});

app.get("/api/new-records", checkApiKey, async (req, res) => {
  try {
    const records = await db.all(
      "SELECT id, url, datetime, hash FROM links WHERE flag = ?",
      "N"
    );
    res.json(records);
  } catch (error) {
    console.error("Error fetching new records:", error);
    res.status(500).json({ error: "Error fetching new records" });
  }
});

app.post("/api/mark-complete", checkApiKey, async (req, res) => {
  const { id, hash } = req.body;

  if (!id || !hash) {
    return res.status(400).json({ error: "Both id and hash are required" });
  }

  try {
    const record = await db.get("SELECT * FROM links WHERE id = ?", id);
    if (!record) {
      return res.status(404).json({ error: "Record not found" });
    }
    if (record.hash !== hash) {
      return res.status(400).json({ error: "ID and hash do not match" });
    }
    if (record.flag !== "N") {
      return res.status(400).json({ error: "Record is not new" });
    }
    const result = await db.run(
      "UPDATE links SET flag = ?, url = ? WHERE id = ?",
      ["C", "", id]
    );
    if (result.changes === 0) {
      return res.status(500).json({ error: "Failed to update record" });
    }
    res.json({ success: true, message: "Record marked as complete" });
  } catch (error) {
    console.error("Error marking record as complete:", error);
    res.status(500).json({ error: "Error marking record as complete" });
  }
});

// Clean up expired session tokens every hour
setInterval(() => {
  const now = Date.now();
  for (const [token, timestamp] of sessionTokens.entries()) {
    if (now - timestamp > 3600000) {
      // 1 hour
      sessionTokens.delete(token);
    }
  }
}, 3600000);

// Start the server
app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
