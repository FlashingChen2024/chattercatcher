import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { migrateDatabase } from "../../src/db/database.js";
import { QaLogRepository } from "../../src/rag/qa-logs.js";

describe("QaLogRepository", () => {
  it("creates logs and lists the most recent ones first", () => {
    const database = new Database(":memory:");
    migrateDatabase(database);

    try {
      const repository = new QaLogRepository(database);

      const older = repository.create({
        chatId: "chat-1",
        questionMessageId: "msg-1",
        question: "第一个问题",
        answer: "第一个回答",
        citations: [{ source: "older" }],
        retrievalDebug: { query: "older", count: 1 },
        status: "answered",
        createdAt: "2026-05-01T10:00:00.000Z",
      });
      const newer = repository.create({
        question: "第二个问题",
        answer: "第二个回答",
        citations: [{ source: "newer" }],
        retrievalDebug: { query: "newer", count: 2 },
        status: "failed",
        error: "timeout",
        createdAt: "2026-05-01T11:00:00.000Z",
      });

      const recent = repository.listRecent(10);

      expect(repository.getCount()).toBe(2);
      expect(recent).toHaveLength(2);
      expect(recent.map((log) => log.id)).toEqual([newer.id, older.id]);
      expect(recent[0]).toMatchObject({
        question: "第二个问题",
        answer: "第二个回答",
        citations: [{ source: "newer" }],
        retrievalDebug: { query: "newer", count: 2 },
        status: "failed",
        error: "timeout",
        chatId: null,
        questionMessageId: null,
        createdAt: "2026-05-01T11:00:00.000Z",
      });
      expect(recent[1]).toMatchObject({
        chatId: "chat-1",
        questionMessageId: "msg-1",
        citations: [{ source: "older" }],
        retrievalDebug: { query: "older", count: 1 },
        status: "answered",
        error: null,
        createdAt: "2026-05-01T10:00:00.000Z",
      });
      expect(older.id).toMatch(/^qa_/);
      expect(newer.id).toMatch(/^qa_/);
    } finally {
      database.close();
    }
  });

  it("clamps listRecent limits to the supported range", () => {
    const database = new Database(":memory:");
    migrateDatabase(database);

    try {
      const repository = new QaLogRepository(database);

      for (let index = 0; index < 205; index += 1) {
        repository.create({
          question: `问题 ${index}`,
          answer: `回答 ${index}`,
          citations: [],
          retrievalDebug: { index },
          status: "answered",
          createdAt: new Date(Date.UTC(2026, 4, 1, 0, 0, index)).toISOString(),
        });
      }

      expect(repository.listRecent(0)).toHaveLength(1);
      expect(repository.listRecent(999)).toHaveLength(200);
    } finally {
      database.close();
    }
  });
});
