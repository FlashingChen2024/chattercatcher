import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDefaultConfig } from "../../src/config/schema.js";
import { openDatabase } from "../../src/db/database.js";
import type { SqliteDatabase } from "../../src/db/database.js";
import { MessageRepository } from "../../src/messages/repository.js";
import { SqliteVectorStore } from "../../src/rag/sqlite-vector-store.js";

let testDir: string;

function createStore(database: SqliteDatabase, model = "test-model"): SqliteVectorStore {
  return new SqliteVectorStore(database, { model });
}

function ingestMessage(
  database: SqliteDatabase,
  input: {
    platformMessageId: string;
    senderId: string;
    senderName: string;
    text: string;
    sentAt: string;
  },
): void {
  const messages = new MessageRepository(database);
  messages.ingest({
    platform: "dev",
    platformChatId: "family",
    chatName: "家庭群",
    platformMessageId: input.platformMessageId,
    senderId: input.senderId,
    senderName: input.senderName,
    messageType: "text",
    text: input.text,
    sentAt: input.sentAt,
  });
}

describe("SqliteVectorStore", () => {
  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), "chattercatcher-sqlite-vector-"));
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it("创建数据库时会迁移 embedding_json schema", () => {
    const config = createDefaultConfig();
    config.storage.dataDir = testDir;
    const database = openDatabase(config);

    try {
      const columns = database.prepare("PRAGMA table_info(message_chunk_embeddings)").all() as Array<{ name: string }>;
      expect(columns.map((column) => column.name)).toEqual([
        "chunk_id",
        "model",
        "dimension",
        "embedding_json",
        "updated_at",
      ]);
    } finally {
      database.close();
    }
  });

  it("upsert 后 count 只统计当前 model", async () => {
    const config = createDefaultConfig();
    config.storage.dataDir = testDir;
    const database = openDatabase(config);

    try {
      ingestMessage(database, {
        platformMessageId: "message-1",
        senderId: "mom",
        senderName: "老妈",
        text: "端午活动改到 2026/6/30。",
        sentAt: "2026-04-25T08:00:00.000Z",
      });

      const chunks = database
        .prepare("SELECT id, text FROM message_chunks ORDER BY chunk_index ASC")
        .all() as Array<{ id: string; text: string }>;
      const store = createStore(database, "text-embedding-3-small");

      await store.upsert(
        chunks.map((chunk, index) => ({
          id: chunk.id,
          vector: index === 0 ? [1, 0] : [0, 1],
          evidence: {
            id: chunk.id,
            text: chunk.text,
            score: 1,
            source: { type: "message", label: "家庭群" },
          },
        })),
      );

      expect(store.count()).toBe(chunks.length);
    } finally {
      database.close();
    }
  });

  it("search 按 cosine similarity 降序返回多条结果", async () => {
    const config = createDefaultConfig();
    config.storage.dataDir = testDir;
    const database = openDatabase(config);

    try {
      ingestMessage(database, {
        platformMessageId: "message-1",
        senderId: "mom",
        senderName: "老妈",
        text: "端午活动改到 2026/6/30。",
        sentAt: "2026-04-25T08:00:00.000Z",
      });
      ingestMessage(database, {
        platformMessageId: "message-2",
        senderId: "dad",
        senderName: "老爸",
        text: "晚点回家前顺路买牛奶。",
        sentAt: "2026-04-25T09:00:00.000Z",
      });
      ingestMessage(database, {
        platformMessageId: "message-3",
        senderId: "sis",
        senderName: "妹妹",
        text: "今晚记得交水电费。",
        sentAt: "2026-04-25T10:00:00.000Z",
      });

      const chunks = database
        .prepare(`
          SELECT mc.id, mc.text
          FROM message_chunks mc
          JOIN messages m ON m.id = mc.message_id
          ORDER BY m.sent_at ASC, mc.chunk_index ASC
        `)
        .all() as Array<{ id: string; text: string }>;
      const store = createStore(database);

      await store.upsert([
        {
          id: chunks[0]!.id,
          vector: [1, 0],
          evidence: {
            id: chunks[0]!.id,
            text: chunks[0]!.text,
            score: 1,
            source: { type: "message", label: "家庭群" },
          },
        },
        {
          id: chunks[1]!.id,
          vector: [0.6, 0.8],
          evidence: {
            id: chunks[1]!.id,
            text: chunks[1]!.text,
            score: 1,
            source: { type: "message", label: "家庭群" },
          },
        },
        {
          id: chunks[2]!.id,
          vector: [0, 1],
          evidence: {
            id: chunks[2]!.id,
            text: chunks[2]!.text,
            score: 1,
            source: { type: "message", label: "家庭群" },
          },
        },
      ]);

      const results = await store.search([1, 0], 3);

      expect(results).toHaveLength(3);
      expect(results.map((result) => result.text)).toEqual([
        "端午活动改到 2026/6/30。",
        "晚点回家前顺路买牛奶。",
        "今晚记得交水电费。",
      ]);
      expect(results.map((result) => result.vectorScore)).toEqual([1, 0.6, 0]);
      expect(results[0]!.vectorScore).toBeGreaterThan(results[1]!.vectorScore);
      expect(results[1]!.vectorScore).toBeGreaterThan(results[2]!.vectorScore);
      expect(results[0]?.source).toMatchObject({ label: "家庭群", sender: "老妈" });
      expect(results[1]?.source).toMatchObject({ label: "家庭群", sender: "老爸" });
      expect(results[2]?.source).toMatchObject({ label: "家庭群", sender: "妹妹" });
    } finally {
      database.close();
    }
  });

  it("search 会忽略非法 JSON 和包含非 number 元素的坏向量", async () => {
    const config = createDefaultConfig();
    config.storage.dataDir = testDir;
    const database = openDatabase(config);

    try {
      ingestMessage(database, {
        platformMessageId: "message-valid",
        senderId: "mom",
        senderName: "老妈",
        text: "有效向量消息。",
        sentAt: "2026-04-25T08:00:00.000Z",
      });
      ingestMessage(database, {
        platformMessageId: "message-bad-json",
        senderId: "dad",
        senderName: "老爸",
        text: "非法 JSON 向量消息。",
        sentAt: "2026-04-25T09:00:00.000Z",
      });
      ingestMessage(database, {
        platformMessageId: "message-bad-item",
        senderId: "sis",
        senderName: "妹妹",
        text: "混合类型向量消息。",
        sentAt: "2026-04-25T10:00:00.000Z",
      });

      const chunks = database
        .prepare(`
          SELECT mc.id, mc.text, m.platform_message_id AS platformMessageId
          FROM message_chunks mc
          JOIN messages m ON m.id = mc.message_id
          ORDER BY m.sent_at ASC, mc.chunk_index ASC
        `)
        .all() as Array<{ id: string; text: string; platformMessageId: string }>;
      const chunkByMessageId = new Map(chunks.map((chunk) => [chunk.platformMessageId, chunk]));
      const validChunk = chunkByMessageId.get("message-valid");
      const badJsonChunk = chunkByMessageId.get("message-bad-json");
      const badItemChunk = chunkByMessageId.get("message-bad-item");
      expect(validChunk).toBeDefined();
      expect(badJsonChunk).toBeDefined();
      expect(badItemChunk).toBeDefined();

      const store = createStore(database);
      await store.upsert([
        {
          id: validChunk!.id,
          vector: [1, 0],
          evidence: {
            id: validChunk!.id,
            text: validChunk!.text,
            score: 1,
            source: { type: "message", label: "家庭群" },
          },
        },
      ]);

      const updatedAt = "2026-05-01T00:00:00.000Z";
      database
        .prepare(
          `
            INSERT INTO message_chunk_embeddings (chunk_id, model, dimension, embedding_json, updated_at)
            VALUES (?, ?, ?, ?, ?)
          `,
        )
        .run(badJsonChunk!.id, "test-model", 2, "not-json", updatedAt);
      database
        .prepare(
          `
            INSERT INTO message_chunk_embeddings (chunk_id, model, dimension, embedding_json, updated_at)
            VALUES (?, ?, ?, ?, ?)
          `,
        )
        .run(badItemChunk!.id, "test-model", 2, JSON.stringify([1, "x"]), updatedAt);

      const results = await store.search([1, 0], 3);

      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({ id: validChunk!.id, text: "有效向量消息。", vectorScore: 1 });
      expect(results.map((result) => result.id)).not.toContain(badJsonChunk!.id);
      expect(results.map((result) => result.id)).not.toContain(badItemChunk!.id);
    } finally {
      database.close();
    }
  });

  it("search 在查询向量与存储向量维度不一致时返回 0 分", async () => {
    const config = createDefaultConfig();
    config.storage.dataDir = testDir;
    const database = openDatabase(config);

    try {
      ingestMessage(database, {
        platformMessageId: "message-match",
        senderId: "mom",
        senderName: "老妈",
        text: "匹配维度消息。",
        sentAt: "2026-04-25T08:00:00.000Z",
      });
      ingestMessage(database, {
        platformMessageId: "message-mismatch",
        senderId: "dad",
        senderName: "老爸",
        text: "维度不一致消息。",
        sentAt: "2026-04-25T09:00:00.000Z",
      });

      const chunks = database
        .prepare(`
          SELECT mc.id, mc.text, m.platform_message_id AS platformMessageId
          FROM message_chunks mc
          JOIN messages m ON m.id = mc.message_id
          ORDER BY m.sent_at ASC, mc.chunk_index ASC
        `)
        .all() as Array<{ id: string; text: string; platformMessageId: string }>;
      const chunkByMessageId = new Map(chunks.map((chunk) => [chunk.platformMessageId, chunk]));
      const matchingChunk = chunkByMessageId.get("message-match");
      const mismatchedChunk = chunkByMessageId.get("message-mismatch");
      expect(matchingChunk).toBeDefined();
      expect(mismatchedChunk).toBeDefined();

      const store = createStore(database);
      await store.upsert([
        {
          id: matchingChunk!.id,
          vector: [1, 0],
          evidence: {
            id: matchingChunk!.id,
            text: matchingChunk!.text,
            score: 1,
            source: { type: "message", label: "家庭群" },
          },
        },
        {
          id: mismatchedChunk!.id,
          vector: [1, 0, 0],
          evidence: {
            id: mismatchedChunk!.id,
            text: mismatchedChunk!.text,
            score: 1,
            source: { type: "message", label: "家庭群" },
          },
        },
      ]);

      const results = await store.search([1, 0], 2);
      const resultById = new Map(results.map((result) => [result.id, result]));

      expect(resultById.get(matchingChunk!.id)?.vectorScore).toBe(1);
      expect(resultById.get(mismatchedChunk!.id)?.vectorScore).toBe(0);
    } finally {
      database.close();
    }
  });

  it("search 在 limit 小于等于 0 时返回空数组", async () => {
    const config = createDefaultConfig();
    config.storage.dataDir = testDir;
    const database = openDatabase(config);

    try {
      ingestMessage(database, {
        platformMessageId: "message-1",
        senderId: "mom",
        senderName: "老妈",
        text: "端午活动改到 2026/6/30。",
        sentAt: "2026-04-25T08:00:00.000Z",
      });

      const chunk = database
        .prepare("SELECT id, text FROM message_chunks LIMIT 1")
        .get() as { id: string; text: string };
      const store = createStore(database);
      await store.upsert([
        {
          id: chunk.id,
          vector: [1, 0],
          evidence: {
            id: chunk.id,
            text: chunk.text,
            score: 1,
            source: { type: "message", label: "家庭群" },
          },
        },
      ]);

      await expect(store.search([1, 0], 0)).resolves.toEqual([]);
      await expect(store.search([1, 0], -1)).resolves.toEqual([]);
    } finally {
      database.close();
    }
  });

  it("重复 upsert 会更新 embedding 和检索结果", async () => {
    const config = createDefaultConfig();
    config.storage.dataDir = testDir;
    const database = openDatabase(config);

    try {
      ingestMessage(database, {
        platformMessageId: "message-1",
        senderId: "mom",
        senderName: "老妈",
        text: "端午活动改到 2026/6/30。",
        sentAt: "2026-04-25T08:00:00.000Z",
      });

      const chunk = database
        .prepare("SELECT id, text FROM message_chunks LIMIT 1")
        .get() as { id: string; text: string };
      const store = createStore(database);

      await store.upsert([
        {
          id: chunk.id,
          vector: [0, 1],
          evidence: {
            id: chunk.id,
            text: chunk.text,
            score: 1,
            source: { type: "message", label: "家庭群" },
          },
        },
      ]);

      let results = await store.search([1, 0], 1);
      expect(results[0]?.vectorScore).toBe(0);

      await store.upsert([
        {
          id: chunk.id,
          vector: [1, 0],
          evidence: {
            id: chunk.id,
            text: chunk.text,
            score: 1,
            source: { type: "message", label: "家庭群" },
          },
        },
      ]);

      results = await store.search([1, 0], 1);

      expect(store.count()).toBe(1);
      expect(results[0]?.vectorScore).toBe(1);
    } finally {
      database.close();
    }
  });

  it("不同 model 之间互相隔离", async () => {
    const config = createDefaultConfig();
    config.storage.dataDir = testDir;
    const database = openDatabase(config);

    try {
      ingestMessage(database, {
        platformMessageId: "message-1",
        senderId: "mom",
        senderName: "老妈",
        text: "端午活动改到 2026/6/30。",
        sentAt: "2026-04-25T08:00:00.000Z",
      });

      const chunk = database
        .prepare("SELECT id, text FROM message_chunks LIMIT 1")
        .get() as { id: string; text: string };
      const firstStore = createStore(database, "model-a");
      const secondStore = createStore(database, "model-b");

      await firstStore.upsert([
        {
          id: chunk.id,
          vector: [1, 0],
          evidence: {
            id: chunk.id,
            text: chunk.text,
            score: 1,
            source: { type: "message", label: "家庭群" },
          },
        },
      ]);
      await secondStore.upsert([
        {
          id: chunk.id,
          vector: [0, 1],
          evidence: {
            id: chunk.id,
            text: chunk.text,
            score: 1,
            source: { type: "message", label: "家庭群" },
          },
        },
      ]);

      const firstResults = await firstStore.search([1, 0], 1);
      const secondResults = await secondStore.search([1, 0], 1);

      expect(firstStore.count()).toBe(1);
      expect(secondStore.count()).toBe(1);
      expect(firstResults[0]?.vectorScore).toBe(1);
      expect(secondResults[0]?.vectorScore).toBe(0);
    } finally {
      database.close();
    }
  });
});
