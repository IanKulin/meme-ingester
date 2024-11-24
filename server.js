import crypto from "crypto";
import express from "express";
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
  dbMarkRecordFailed,
} from "./db.js";
import {
  checkApiKey,
  checkSessionToken,
  cleanupSessionTokens,
  handleServerError,
  newSessionToken,
  processUrl,
} from "./helpers.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = 3000;
const MAX_URL_LENGTH = 2048;

// Rate limiting
const limiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 1000, // limit each IP to 1000 requests per windowMs
});

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(limiter);

// Initialize database
dbInitialise();

// Routes
app.get("/", (req, res) => {
  // include a session token, used later to protect the routes used
  // by the form
  const sessionToken = newSessionToken();
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

app.post("/api/new-records", checkApiKey, async (req, res) => {
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

app.post("/api/mark-failed", checkApiKey, async (req, res) => {
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
    const result = await dbMarkRecordFailed(id);
    if (result.changes === 0) {
      return res.status(500).json({ error: "Failed to update record" });
    }
    res.json({ success: true, message: "Record marked as failed" });
  } catch (error) {
    handleServerError(res, error, "Error marking record as failed");
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
