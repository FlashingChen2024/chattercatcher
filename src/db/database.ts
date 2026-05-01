import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import type { AppConfig } from "../config/schema.js";
import { resolveHomePath } from "../config/paths.js";

export type SqliteDatabase = Database.Database;

export function getDatabasePath(config: AppConfig): string {
  return path.join(resolveHomePath(config.storage.dataDir), "chattercatcher.db");
}

export function openDatabase(config: AppConfig): SqliteDatabase {
  const databasePath = getDatabasePath(config);
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });

  const database = new Database(databasePath);
  database.pragma("journal_mode = WAL");
  database.pragma("foreign_keys = ON");
  migrateDatabase(database);
  return database;
}

export function migrateDatabase(database: SqliteDatabase): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS chats (
      id TEXT PRIMARY KEY,
      platform TEXT NOT NULL,
      platform_chat_id TEXT NOT NULL,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(platform, platform_chat_id)
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      platform TEXT NOT NULL,
      platform_message_id TEXT NOT NULL,
      chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
      sender_id TEXT NOT NULL,
      sender_name TEXT NOT NULL,
      message_type TEXT NOT NULL,
      text TEXT NOT NULL,
      raw_payload_json TEXT NOT NULL,
      sent_at TEXT NOT NULL,
      received_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(platform, platform_message_id)
    );

    CREATE TABLE IF NOT EXISTS message_chunks (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      chunk_index INTEGER NOT NULL,
      text TEXT NOT NULL,
      metadata_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(message_id, chunk_index)
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS message_chunks_fts USING fts5(
      text,
      chunk_id UNINDEXED,
      message_id UNINDEXED,
      tokenize = 'unicode61'
    );

    CREATE TABLE IF NOT EXISTS message_chunk_embeddings (
      chunk_id TEXT PRIMARY KEY REFERENCES message_chunks(id) ON DELETE CASCADE,
      model TEXT NOT NULL,
      dimension INTEGER NOT NULL,
      embedding_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS message_chunk_embeddings_model_idx
    ON message_chunk_embeddings(model, dimension);

    CREATE TABLE IF NOT EXISTS file_jobs (
      id TEXT PRIMARY KEY,
      source_path TEXT NOT NULL,
      stored_path TEXT,
      file_name TEXT NOT NULL,
      status TEXT NOT NULL,
      parser TEXT,
      message_id TEXT,
      bytes INTEGER,
      characters INTEGER,
      warnings_json TEXT NOT NULL DEFAULT '[]',
      error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
}
