import fs from "node:fs/promises";
import path from "node:path";
import type { SqliteDatabase } from "../db/database.js";

export interface DataRestoreResult {
  inputPath: string;
  mode: "merge" | "replace";
  chats: number;
  messages: number;
  chunks: number;
  fileJobs: number;
}

interface ExportPayload {
  app: string;
  schemaVersion: number;
  data: {
    chats: Array<Record<string, unknown>>;
    messages: Array<Record<string, unknown>>;
    chunks: Array<Record<string, unknown>>;
    fileJobs: Array<Record<string, unknown>>;
  };
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asArray(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.map(asObject) : [];
}

function asString(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new Error(`恢复文件字段无效：${field}`);
  }

  return value;
}

function asOptionalString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asOptionalNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asJson(value: unknown, fallback: unknown): string {
  return JSON.stringify(value === undefined ? fallback : value);
}

function parsePayload(raw: string): ExportPayload {
  const parsed = asObject(JSON.parse(raw) as unknown);
  const data = asObject(parsed.data);
  const payload = {
    app: asString(parsed.app, "app"),
    schemaVersion: typeof parsed.schemaVersion === "number" ? parsed.schemaVersion : NaN,
    data: {
      chats: asArray(data.chats),
      messages: asArray(data.messages),
      chunks: asArray(data.chunks),
      fileJobs: asArray(data.fileJobs),
    },
  };

  if (payload.app !== "ChatterCatcher" || payload.schemaVersion !== 1) {
    throw new Error("恢复文件不是 ChatterCatcher schemaVersion=1 导出。");
  }

  return payload;
}

function clearDatabase(database: SqliteDatabase): void {
  database.prepare("DELETE FROM message_chunks_fts").run();
  database.prepare("DELETE FROM message_chunks").run();
  database.prepare("DELETE FROM file_jobs").run();
  database.prepare("DELETE FROM messages").run();
  database.prepare("DELETE FROM chats").run();
}

export async function restoreLocalData(input: {
  database: SqliteDatabase;
  inputPath: string;
  replace?: boolean;
}): Promise<DataRestoreResult> {
  const inputPath = path.resolve(input.inputPath);
  const payload = parsePayload(await fs.readFile(inputPath, "utf8"));
  const mode = input.replace ? "replace" : "merge";

  const restore = input.database.transaction(() => {
    if (input.replace) {
      clearDatabase(input.database);
    }

    const upsertChat = input.database.prepare(`
      INSERT INTO chats (id, platform, platform_chat_id, name, created_at, updated_at)
      VALUES (@id, @platform, @platformChatId, @name, @createdAt, @updatedAt)
      ON CONFLICT(id) DO UPDATE SET
        platform = excluded.platform,
        platform_chat_id = excluded.platform_chat_id,
        name = excluded.name,
        updated_at = excluded.updated_at
    `);

    const upsertMessage = input.database.prepare(`
      INSERT INTO messages (
        id, platform, platform_message_id, chat_id, sender_id, sender_name,
        message_type, text, raw_payload_json, sent_at, received_at, created_at
      )
      VALUES (
        @id, @platform, @platformMessageId, @chatId, @senderId, @senderName,
        @messageType, @text, @rawPayloadJson, @sentAt, @receivedAt, @createdAt
      )
      ON CONFLICT(id) DO UPDATE SET
        platform = excluded.platform,
        platform_message_id = excluded.platform_message_id,
        chat_id = excluded.chat_id,
        sender_id = excluded.sender_id,
        sender_name = excluded.sender_name,
        message_type = excluded.message_type,
        text = excluded.text,
        raw_payload_json = excluded.raw_payload_json,
        sent_at = excluded.sent_at,
        received_at = excluded.received_at
    `);

    const upsertChunk = input.database.prepare(`
      INSERT INTO message_chunks (id, message_id, chunk_index, text, metadata_json, created_at)
      VALUES (@id, @messageId, @chunkIndex, @text, @metadataJson, @createdAt)
      ON CONFLICT(id) DO UPDATE SET
        message_id = excluded.message_id,
        chunk_index = excluded.chunk_index,
        text = excluded.text,
        metadata_json = excluded.metadata_json
    `);

    const insertFts = input.database.prepare(`
      INSERT INTO message_chunks_fts (text, chunk_id, message_id)
      VALUES (@text, @chunkId, @messageId)
    `);

    const upsertFileJob = input.database.prepare(`
      INSERT INTO file_jobs (
        id, source_path, stored_path, file_name, status, parser, message_id,
        bytes, characters, warnings_json, error, created_at, updated_at
      )
      VALUES (
        @id, @sourcePath, @storedPath, @fileName, @status, @parser, @messageId,
        @bytes, @characters, @warningsJson, @error, @createdAt, @updatedAt
      )
      ON CONFLICT(id) DO UPDATE SET
        source_path = excluded.source_path,
        stored_path = excluded.stored_path,
        file_name = excluded.file_name,
        status = excluded.status,
        parser = excluded.parser,
        message_id = excluded.message_id,
        bytes = excluded.bytes,
        characters = excluded.characters,
        warnings_json = excluded.warnings_json,
        error = excluded.error,
        updated_at = excluded.updated_at
    `);

    for (const chat of payload.data.chats) {
      upsertChat.run({
        id: asString(chat.id, "chat.id"),
        platform: asString(chat.platform, "chat.platform"),
        platformChatId: asString(chat.platformChatId, "chat.platformChatId"),
        name: asString(chat.name, "chat.name"),
        createdAt: asString(chat.createdAt, "chat.createdAt"),
        updatedAt: asString(chat.updatedAt, "chat.updatedAt"),
      });
    }

    for (const message of payload.data.messages) {
      upsertMessage.run({
        id: asString(message.id, "message.id"),
        platform: asString(message.platform, "message.platform"),
        platformMessageId: asString(message.platformMessageId, "message.platformMessageId"),
        chatId: asString(message.chatId, "message.chatId"),
        senderId: asString(message.senderId, "message.senderId"),
        senderName: asString(message.senderName, "message.senderName"),
        messageType: asString(message.messageType, "message.messageType"),
        text: asString(message.text, "message.text"),
        rawPayloadJson: asJson(message.rawPayload, {}),
        sentAt: asString(message.sentAt, "message.sentAt"),
        receivedAt: asString(message.receivedAt, "message.receivedAt"),
        createdAt: asString(message.createdAt, "message.createdAt"),
      });
      input.database.prepare("DELETE FROM message_chunks_fts WHERE message_id = ?").run(asString(message.id, "message.id"));
    }

    for (const chunk of payload.data.chunks) {
      const messageId = asString(chunk.messageId, "chunk.messageId");
      const chunkId = asString(chunk.id, "chunk.id");
      const text = asString(chunk.text, "chunk.text");
      upsertChunk.run({
        id: chunkId,
        messageId,
        chunkIndex: asOptionalNumber(chunk.chunkIndex) ?? 0,
        text,
        metadataJson: asJson(chunk.metadata, {}),
        createdAt: asString(chunk.createdAt, "chunk.createdAt"),
      });
      insertFts.run({ text, chunkId, messageId });
    }

    for (const job of payload.data.fileJobs) {
      upsertFileJob.run({
        id: asString(job.id, "fileJob.id"),
        sourcePath: asString(job.sourcePath, "fileJob.sourcePath"),
        storedPath: asOptionalString(job.storedPath),
        fileName: asString(job.fileName, "fileJob.fileName"),
        status: asString(job.status, "fileJob.status"),
        parser: asOptionalString(job.parser),
        messageId: asOptionalString(job.messageId),
        bytes: asOptionalNumber(job.bytes),
        characters: asOptionalNumber(job.characters),
        warningsJson: asJson(Array.isArray(job.warnings) ? job.warnings : [], []),
        error: asOptionalString(job.error),
        createdAt: asString(job.createdAt, "fileJob.createdAt"),
        updatedAt: asString(job.updatedAt, "fileJob.updatedAt"),
      });
    }
  });

  restore();

  return {
    inputPath,
    mode,
    chats: payload.data.chats.length,
    messages: payload.data.messages.length,
    chunks: payload.data.chunks.length,
    fileJobs: payload.data.fileJobs.length,
  };
}
