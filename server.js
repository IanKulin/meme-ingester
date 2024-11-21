import express from "express";
import sqlite3 from "sqlite3";
import { open } from "sqlite";
import crypto from "crypto";
import path from "path";
import { fileURLToPath } from "url";
import { URL } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = 3000;
const MAX_URL_LENGTH = 2048;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));

// Database setup
let db;
(async () => {
  db = await open({
    filename: "meme_links.db",
    driver: sqlite3.Database,
  });

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

// Routes
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/api/check-duplicate", async (req, res) => {
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

app.post("/api/submit-link", async (req, res) => {
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

app.get("/api/new-records", async (req, res) => {
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

app.post("/api/mark-complete", async (req, res) => {
  const { id, hash } = req.body;

  if (!id || !hash) {
    return res.status(400).json({ error: "Both id and hash are required" });
  }

  try {
    // First, fetch the record
    const record = await db.get("SELECT * FROM links WHERE id = ?", id);

    // Check if the record exists
    if (!record) {
      return res.status(404).json({ error: "Record not found" });
    }

    // Check if the hash matches
    if (record.hash !== hash) {
      return res.status(400).json({ error: "ID and hash do not match" });
    }

    // Check if the record is new
    if (record.flag !== "N") {
      return res.status(400).json({ error: "Record is not new" });
    }

    // If all checks pass, update the record
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

// Start the server
app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
