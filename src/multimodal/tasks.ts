import crypto from "node:crypto";
import type { SqliteDatabase } from "../db/database.js";
import type {
  EnqueueImageMultimodalTaskInput,
  ImageMultimodalTaskRecord,
  ImageMultimodalTaskStatus,
} from "./types.js";

interface ImageMultimodalTaskRow {
  id: string;
  source_message_id: string;
  platform_message_id: string;
  image_key: string;
  stored_path: string;
  mime_type: string;
  status: ImageMultimodalTaskStatus;
  attempts: number;
  last_error: string | null;
  derived_message_id: string | null;
  created_at: string;
  updated_at: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function stableId(sourceMessageId: string, imageKey: string): string {
  return crypto.createHash("sha256").update(`${sourceMessageId}${imageKey}`).digest("hex").slice(0, 32);
}

function mapRow(row: ImageMultimodalTaskRow | undefined): ImageMultimodalTaskRecord | undefined {
  if (!row) {
    return undefined;
  }

  return {
    id: row.id,
    sourceMessageId: row.source_message_id,
    platformMessageId: row.platform_message_id,
    imageKey: row.image_key,
    storedPath: row.stored_path,
    mimeType: row.mime_type,
    status: row.status,
    attempts: row.attempts,
    ...(row.last_error ? { lastError: row.last_error } : {}),
    ...(row.derived_message_id ? { derivedMessageId: row.derived_message_id } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class ImageMultimodalTaskRepository {
  constructor(private readonly database: SqliteDatabase) {}

  enqueue(input: EnqueueImageMultimodalTaskInput): ImageMultimodalTaskRecord {
    const id = stableId(input.sourceMessageId, input.imageKey);
    const timestamp = nowIso();

    this.database
      .prepare(
        `
          INSERT INTO image_multimodal_tasks (
            id,
            source_message_id,
            platform_message_id,
            image_key,
            stored_path,
            mime_type,
            status,
            attempts,
            created_at,
            updated_at
          )
          VALUES (
            @id,
            @sourceMessageId,
            @platformMessageId,
            @imageKey,
            @storedPath,
            @mimeType,
            'pending',
            0,
            @createdAt,
            @updatedAt
          )
          ON CONFLICT(source_message_id, image_key)
          DO UPDATE SET
            platform_message_id = excluded.platform_message_id,
            stored_path = excluded.stored_path,
            mime_type = excluded.mime_type,
            status = 'pending',
            attempts = 0,
            last_error = NULL,
            derived_message_id = NULL,
            updated_at = excluded.updated_at
        `,
      )
      .run({
        id,
        sourceMessageId: input.sourceMessageId,
        platformMessageId: input.platformMessageId,
        imageKey: input.imageKey,
        storedPath: input.storedPath,
        mimeType: input.mimeType,
        createdAt: timestamp,
        updatedAt: timestamp,
      });

    const record = this.getById(id);
    if (!record) {
      throw new Error(`图片多模态任务写入失败：${id}`);
    }

    return record;
  }

  listPending(limit = 10): ImageMultimodalTaskRecord[] {
    const rows = this.database
      .prepare(
        `
          SELECT
            id,
            source_message_id,
            platform_message_id,
            image_key,
            stored_path,
            mime_type,
            status,
            attempts,
            last_error,
            derived_message_id,
            created_at,
            updated_at
          FROM image_multimodal_tasks
          WHERE status = 'pending'
          ORDER BY updated_at ASC
          LIMIT ?
        `,
      )
      .all(limit) as ImageMultimodalTaskRow[];

    return rows.map((row) => mapRow(row)).filter((row): row is ImageMultimodalTaskRecord => Boolean(row));
  }

  getById(id: string): ImageMultimodalTaskRecord | undefined {
    const row = this.database
      .prepare(
        `
          SELECT
            id,
            source_message_id,
            platform_message_id,
            image_key,
            stored_path,
            mime_type,
            status,
            attempts,
            last_error,
            derived_message_id,
            created_at,
            updated_at
          FROM image_multimodal_tasks
          WHERE id = ?
        `,
      )
      .get(id) as ImageMultimodalTaskRow | undefined;

    return mapRow(row);
  }
}
