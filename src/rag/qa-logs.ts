import crypto from "node:crypto";
import type { SqliteDatabase } from "../db/database.js";

export interface QaLogRecord {
  id: string;
  chatId: string | null;
  questionMessageId: string | null;
  question: string;
  answer: string;
  citations: unknown[];
  retrievalDebug: Record<string, unknown>;
  status: "answered" | "failed";
  error: string | null;
  createdAt: string;
}

export interface CreateQaLogInput {
  chatId?: string;
  questionMessageId?: string;
  question: string;
  answer: string;
  citations: unknown[];
  retrievalDebug: Record<string, unknown>;
  status: "answered" | "failed";
  error?: string;
  createdAt: string;
}

interface QaLogRow {
  id: string;
  chat_id: string | null;
  question_message_id: string | null;
  question: string;
  answer: string;
  citations_json: string;
  retrieval_debug_json: string;
  status: "answered" | "failed";
  error: string | null;
  created_at: string;
}

function clampLimit(limit: number): number {
  return Math.max(1, Math.min(200, Math.trunc(limit)));
}

export class QaLogRepository {
  constructor(private readonly database: SqliteDatabase) {}

  create(input: CreateQaLogInput): QaLogRecord {
    const record: QaLogRecord = {
      id: `qa_${crypto.randomUUID()}`,
      chatId: input.chatId ?? null,
      questionMessageId: input.questionMessageId ?? null,
      question: input.question,
      answer: input.answer,
      citations: input.citations,
      retrievalDebug: input.retrievalDebug,
      status: input.status,
      error: input.error ?? null,
      createdAt: input.createdAt,
    };

    this.database
      .prepare(
        `
          INSERT INTO qa_logs (
            id,
            chat_id,
            question_message_id,
            question,
            answer,
            citations_json,
            retrieval_debug_json,
            status,
            error,
            created_at
          )
          VALUES (
            @id,
            @chatId,
            @questionMessageId,
            @question,
            @answer,
            @citationsJson,
            @retrievalDebugJson,
            @status,
            @error,
            @createdAt
          )
        `,
      )
      .run({
        id: record.id,
        chatId: record.chatId,
        questionMessageId: record.questionMessageId,
        question: record.question,
        answer: record.answer,
        citationsJson: JSON.stringify(record.citations),
        retrievalDebugJson: JSON.stringify(record.retrievalDebug),
        status: record.status,
        error: record.error,
        createdAt: record.createdAt,
      });

    return record;
  }

  listRecent(limit: number): QaLogRecord[] {
    const rows = this.database
      .prepare(
        `
          SELECT
            id,
            chat_id,
            question_message_id,
            question,
            answer,
            citations_json,
            retrieval_debug_json,
            status,
            error,
            created_at
          FROM qa_logs
          ORDER BY created_at DESC
          LIMIT ?
        `,
      )
      .all(clampLimit(limit)) as QaLogRow[];

    return rows.map((row) => ({
      id: row.id,
      chatId: row.chat_id,
      questionMessageId: row.question_message_id,
      question: row.question,
      answer: row.answer,
      citations: JSON.parse(row.citations_json) as unknown[],
      retrievalDebug: JSON.parse(row.retrieval_debug_json) as Record<string, unknown>,
      status: row.status,
      error: row.error,
      createdAt: row.created_at,
    }));
  }

  getCount(): number {
    const row = this.database.prepare("SELECT COUNT(*) AS count FROM qa_logs").get() as { count: number };
    return row.count;
  }
}
