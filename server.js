import express from "express";
import crypto from "crypto";
import path from "path";
import { fileURLToPath, URL } from "url";
import dotenv from "dotenv";
import rateLimit from "express-rate-limit";
import cookieParser from "cookie-parser";
import {
  dbInitialise,
  dbClose,
  dbGetRecordsByHash,
  dbSaveLink,
  dbGetNewRecords,
  dbGetRecordById,
  dbMarkRecordComplete,
} from "./db.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = 3000;
const MAX_URL_LENGTH = 2048;
const SESSION_EXPIRY = 3600000; // 1 hour
const MAX_TOKENS = 1000; // Prevent memory bloat

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

// Initialize database
dbInitialise();

// Helper function to process URL
function processUrl(url) {
  const freshUrl = url.trim();
  // // Prevent potential XSS or injection
  if (freshUrl.includes("<") || freshUrl.includes(">")) {
    throw new Error("Invalid URL characters");
  }
  try {
    const parsedUrl = new URL(freshUrl);
    if (!["http:", "https:"].includes(parsedUrl.protocol)) {
      throw new Error("Invalid protocol");
    }
    return `${parsedUrl.protocol}//${parsedUrl.host}${parsedUrl.pathname}`;
  } catch (error) {
    console.error("URL Processing Error:", error);
    throw new Error("Invalid URL format");
  }
}

// Helper function to cleanup session tokens, called by timer
function cleanupSessionTokens() {
  const now = Date.now();
  let removedCount = 0;
  // Remove expired tokens
  for (const [token, timestamp] of sessionTokens.entries()) {
    if (now - timestamp > SESSION_EXPIRY) {
      sessionTokens.delete(token);
      removedCount++;
    }
  }
  // If too many tokens accumulate, remove the oldest ones
  if (sessionTokens.size > MAX_TOKENS) {
    const sortedTokens = [...sessionTokens.entries()].sort(
      (a, b) => a[1] - b[1]
    );
    const tokensToRemove = sortedTokens.slice(
      0,
      sessionTokens.size - MAX_TOKENS
    );
    for (const [token] of tokensToRemove) {
      sessionTokens.delete(token);
    }
  }
}

function handleServerError(res, error, defaultMessage = 'An unexpected error occurred') {
  console.error(error);
  res.status(error.status || 500).json({
    error: error.message || defaultMessage,
    timestamp: new Date().toISOString()
  });
}

// Middleware to check API key. The API key is an environment variable
// used to protect the endpoints used by the companion app to access the
// links
function checkApiKey(req, res, next) {
  const providedApiKey = req.body.apiKey;
  if (!providedApiKey || providedApiKey !== API_KEY) {
    return res.status(401).json({ error: "Invalid API key" });
  }
  next();
}

// Middleware to check session token. The session token is created at the
// default route, and used to protect the endpoints used by the frontend
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
  // include a session token, used later to protect the routes used
  // by the form
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
    const result = await dbGetRecordsByHash(hash);
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
    await dbSaveLink(url, datetime, flag, hash);
    res.json({ success: true, message: "Link saved successfully" });
  } catch (error) {
    if (error.code === "SQLITE_CONSTRAINT") {
      res.status(409).json({ error: "Duplicate link", isDuplicate: true });
    } else {
      handleServerError(res, error, "Error saving link");
    }
  }
});

app.get("/api/new-records", checkApiKey, async (req, res) => {
  try {
    const records = await dbGetNewRecords();
    res.json(records);
  } catch (error) {
    handleServerError(res, error, "Error fetching new records");
  }
});

app.post("/api/mark-complete", checkApiKey, async (req, res) => {
  const { id, hash } = req.body;

  if (!id || !hash) {
    return res.status(400).json({ error: "Both id and hash are required" });
  }

  try {
    const record = await dbGetRecordById(id);
    if (!record) {
      return res.status(404).json({ error: "Record not found" });
    }
    if (record.hash !== hash) {
      return res.status(400).json({ error: "ID and hash do not match" });
    }
    if (record.flag !== "N") {
      return res.status(400).json({ error: "Record is not new" });
    }
    const result = await dbMarkRecordComplete(id);
    if (result.changes === 0) {
      return res.status(500).json({ error: "Failed to update record" });
    }
    res.json({ success: true, message: "Record marked as complete" });
  } catch (error) {
    handleServerError(res, error, "Error marking record as complete");
  }
});

// Clean up expired session tokens every half hour
setInterval(cleanupSessionTokens, 1800000);

// Graceful shutdown
process.on("SIGINT", async () => {
  console.log("Shutdown initiated");
  try {
    await dbClose();
    // Close any open connections
    if (app && app.server) {
      await new Promise((resolve, reject) => {
        app.server.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    }
    console.log("Shutdown complete");
  } catch (err) {
    console.error("Error during shutdown:", err);
  } finally {
    process.exit(0);
  }
});

// Start the server
app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
