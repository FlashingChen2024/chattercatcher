import fs from "node:fs/promises";
import path from "node:path";
import type { AppConfig } from "../config/schema.js";
import { resolveHomePath } from "../config/paths.js";
import type { SqliteDatabase } from "../db/database.js";

export type DeleteTargetType = "message" | "chat" | "file";

export interface DeleteLocalDataResult {
  targetType: DeleteTargetType;
  targetId: string;
  deletedMessages: number;
  deletedChunks: number;
  deletedFileJobs: number;
  deletedChats: number;
  deletedStoredFiles: string[];
  skippedStoredFiles: string[];
}

interface StoredPathRow {
  storedPath: string | null;
}

function emptyResult(targetType: DeleteTargetType, targetId: string): DeleteLocalDataResult {
  return {
    targetType,
    targetId,
    deletedMessages: 0,
    deletedChunks: 0,
    deletedFileJobs: 0,
    deletedChats: 0,
    deletedStoredFiles: [],
    skippedStoredFiles: [],
  };
}

function parseStoredPathFromRawPayload(rawPayloadJson: string): string | null {
  try {
    const parsed = JSON.parse(rawPayloadJson) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }

    const storedPath = (parsed as { storedPath?: unknown }).storedPath;
    return typeof storedPath === "string" ? storedPath : null;
  } catch {
    return null;
  }
}

function isInsideDirectory(filePath: string, directory: string): boolean {
  const relative = path.relative(path.resolve(directory), path.resolve(filePath));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function removeStoredFiles(config: AppConfig, paths: string[]): Promise<{
  deleted: string[];
  skipped: string[];
}> {
  const dataDir = resolveHomePath(config.storage.dataDir);
  const deleted: string[] = [];
  const skipped: string[] = [];
  const uniquePaths = [...new Set(paths.filter(Boolean).map((item) => path.resolve(item)))];

  for (const storedPath of uniquePaths) {
    if (!isInsideDirectory(storedPath, dataDir)) {
      skipped.push(storedPath);
      continue;
    }

    try {
      await fs.rm(storedPath, { force: true });
      deleted.push(storedPath);
    } catch {
      skipped.push(storedPath);
    }
  }

  return { deleted, skipped };
}

function getStoredPathsForMessages(database: SqliteDatabase, messageIds: string[]): string[] {
  if (messageIds.length === 0) {
    return [];
  }

  const rows = database
    .prepare(
      `
      SELECT raw_payload_json AS rawPayloadJson
      FROM messages
      WHERE id IN (${messageIds.map(() => "?").join(", ")})
    `,
    )
    .all(...messageIds) as Array<{ rawPayloadJson: string }>;

  const fileJobRows = database
    .prepare(
      `
      SELECT stored_path AS storedPath
      FROM file_jobs
      WHERE message_id IN (${messageIds.map(() => "?").join(", ")})
    `,
    )
    .all(...messageIds) as StoredPathRow[];

  return [
    ...rows.map((row) => parseStoredPathFromRawPayload(row.rawPayloadJson)).filter((item): item is string => Boolean(item)),
    ...fileJobRows.map((row) => row.storedPath).filter((item): item is string => Boolean(item)),
  ];
}

function deleteMessagesByIds(database: SqliteDatabase, messageIds: string[]): Omit<
  DeleteLocalDataResult,
  "targetType" | "targetId" | "deletedStoredFiles" | "skippedStoredFiles" | "deletedChats"
> {
  if (messageIds.length === 0) {
    return {
      deletedMessages: 0,
      deletedChunks: 0,
      deletedFileJobs: 0,
    };
  }

  const placeholders = messageIds.map(() => "?").join(", ");
  const deletedChunks = (database.prepare(`SELECT COUNT(*) AS count FROM message_chunks WHERE message_id IN (${placeholders})`).get(...messageIds) as { count: number }).count;
  const deletedFileJobs = database.prepare(`DELETE FROM file_jobs WHERE message_id IN (${placeholders})`).run(...messageIds).changes;
  database.prepare(`DELETE FROM message_chunks_fts WHERE message_id IN (${placeholders})`).run(...messageIds);
  const deletedMessages = database.prepare(`DELETE FROM messages WHERE id IN (${placeholders})`).run(...messageIds).changes;

  return {
    deletedMessages,
    deletedChunks,
    deletedFileJobs,
  };
}

export async function deleteLocalData(input: {
  config: AppConfig;
  database: SqliteDatabase;
  targetType: DeleteTargetType;
  targetId: string;
}): Promise<DeleteLocalDataResult> {
  const result = emptyResult(input.targetType, input.targetId);
  let storedPaths: string[] = [];

  const transaction = input.database.transaction(() => {
    if (input.targetType === "chat") {
      const messageIds = (
        input.database.prepare("SELECT id FROM messages WHERE chat_id = ?").all(input.targetId) as Array<{ id: string }>
      ).map((row) => row.id);
      storedPaths = getStoredPathsForMessages(input.database, messageIds);
      const deleted = deleteMessagesByIds(input.database, messageIds);
      result.deletedMessages = deleted.deletedMessages;
      result.deletedChunks = deleted.deletedChunks;
      result.deletedFileJobs = deleted.deletedFileJobs;
      result.deletedChats = input.database.prepare("DELETE FROM chats WHERE id = ?").run(input.targetId).changes;
      return;
    }

    if (input.targetType === "file") {
      const file = input.database
        .prepare("SELECT id FROM messages WHERE id = ? AND message_type = 'file'")
        .get(input.targetId) as { id: string } | undefined;
      if (!file) {
        return;
      }
    }

    storedPaths = getStoredPathsForMessages(input.database, [input.targetId]);
    const deleted = deleteMessagesByIds(input.database, [input.targetId]);
    result.deletedMessages = deleted.deletedMessages;
    result.deletedChunks = deleted.deletedChunks;
    result.deletedFileJobs = deleted.deletedFileJobs;
  });

  transaction();

  const removed = await removeStoredFiles(input.config, storedPaths);
  result.deletedStoredFiles = removed.deleted;
  result.skippedStoredFiles = removed.skipped;
  return result;
}
