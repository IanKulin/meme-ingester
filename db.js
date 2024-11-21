import sqlite3 from "sqlite3";
import { open } from "sqlite";

let db;

async function dbInitialise() {
  db = await open({
    filename: "data/meme_links.db",
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
}

async function dbClose() {
  if (db) {
    await db.close();
    console.log("Database connection closed.");
  }
}

async function dbGetRecordsByHash(hash) {
  return await db.get("SELECT * FROM links WHERE hash = ?", hash);
}

async function dbSaveLink(url, datetime, flag, hash) {
  return await db.run(
    "INSERT INTO links (url, datetime, flag, hash) VALUES (?, ?, ?, ?)",
    [url, datetime, flag, hash]
  );
}

async function dbGetNewRecords() {
  return await db.all(
    "SELECT id, url, datetime, hash FROM links WHERE flag = ?",
    "N"
  );
}

async function dbGetRecordById(id) {
  return await db.get("SELECT * FROM links WHERE id = ?", id);
}

async function dbMarkRecordComplete(id) {
  return await db.run("UPDATE links SET flag = ?, url = ? WHERE id = ?", [
    "C",
    "",
    id,
  ]);
}

export {
  dbInitialise,
  dbClose,
  dbGetRecordsByHash,
  dbSaveLink,
  dbGetNewRecords,
  dbGetRecordById,
  dbMarkRecordComplete,
};
