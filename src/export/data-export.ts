import fs from "node:fs/promises";
import path from "node:path";
import type { AppConfig } from "../config/schema.js";
import { resolveHomePath } from "../config/paths.js";
import type { SqliteDatabase } from "../db/database.js";

export interface DataExportResult {
  outputPath: string;
  chats: number;
  messages: number;
  chunks: number;
  fileJobs: number;
}

function parseJsonObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function parseJsonArray(value: string): unknown[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function defaultExportPath(config: AppConfig, exportedAt: string): string {
  const fileName = `chattercatcher-export-${exportedAt.replace(/[:.]/g, "-")}.json`;
  return path.join(resolveHomePath(config.storage.dataDir), "exports", fileName);
}

export async function exportLocalData(input: {
  config: AppConfig;
  database: SqliteDatabase;
  outputPath?: string;
  exportedAt?: string;
}): Promise<DataExportResult> {
  const exportedAt = input.exportedAt ?? new Date().toISOString();
  const outputPath = path.resolve(input.outputPath ?? defaultExportPath(input.config, exportedAt));

  const chats = input.database
    .prepare(
      `
      SELECT
        id,
        platform,
        platform_chat_id AS platformChatId,
        name,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM chats
      ORDER BY updated_at ASC
    `,
    )
    .all();

  const messages = (
    input.database
      .prepare(
        `
        SELECT
          id,
          platform,
          platform_message_id AS platformMessageId,
          chat_id AS chatId,
          sender_id AS senderId,
          sender_name AS senderName,
          message_type AS messageType,
          text,
          raw_payload_json AS rawPayloadJson,
          sent_at AS sentAt,
          received_at AS receivedAt,
          created_at AS createdAt
        FROM messages
        ORDER BY sent_at ASC, created_at ASC
      `,
      )
      .all() as Array<Record<string, unknown> & { rawPayloadJson: string }>
  ).map(({ rawPayloadJson, ...message }) => ({
    ...message,
    rawPayload: parseJsonObject(rawPayloadJson),
  }));

  const chunks = (
    input.database
      .prepare(
        `
        SELECT
          id,
          message_id AS messageId,
          chunk_index AS chunkIndex,
          text,
          metadata_json AS metadataJson,
          created_at AS createdAt
        FROM message_chunks
        ORDER BY message_id ASC, chunk_index ASC
      `,
      )
      .all() as Array<Record<string, unknown> & { metadataJson: string }>
  ).map(({ metadataJson, ...chunk }) => ({
    ...chunk,
    metadata: parseJsonObject(metadataJson),
  }));

  const fileJobs = (
    input.database
      .prepare(
        `
        SELECT
          id,
          source_path AS sourcePath,
          stored_path AS storedPath,
          file_name AS fileName,
          status,
          parser,
          message_id AS messageId,
          bytes,
          characters,
          warnings_json AS warningsJson,
          error,
          created_at AS createdAt,
          updated_at AS updatedAt
        FROM file_jobs
        ORDER BY updated_at ASC
      `,
      )
      .all() as Array<Record<string, unknown> & { warningsJson: string }>
  ).map(({ warningsJson, ...job }) => ({
    ...job,
    warnings: parseJsonArray(warningsJson).filter((item): item is string => typeof item === "string"),
  }));

  const payload = {
    app: "ChatterCatcher",
    schemaVersion: 1,
    exportedAt,
    note: "本文件只包含本地知识库数据，不包含 API Key、App Secret 或 token。",
    data: {
      chats,
      messages,
      chunks,
      fileJobs,
    },
  };

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

  return {
    outputPath,
    chats: chats.length,
    messages: messages.length,
    chunks: chunks.length,
    fileJobs: fileJobs.length,
  };
}
