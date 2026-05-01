import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDefaultConfig, createDefaultSecrets } from "../../src/config/schema.js";
import { openDatabase } from "../../src/db/database.js";
import { MessageRepository } from "../../src/messages/repository.js";
import type { EmbeddingModel } from "../../src/rag/embedding.js";
import { processMessagesNow } from "../../src/rag/manual-index.js";
import { SqliteVectorStore } from "../../src/rag/sqlite-vector-store.js";

let testDir: string;

const fakeEmbedding: EmbeddingModel = {
  async embed(text) {
    return text.includes("端午") ? [1, 0] : [0, 1];
  },
  async embedBatch(texts) {
    return Promise.all(texts.map((text) => this.embed(text)));
  },
};

describe("manual message indexing", () => {
  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), "chattercatcher-manual-index-"));
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it("embedding 未配置时跳过向量处理但保留 FTS 即时索引", async () => {
    const config = createDefaultConfig();
    config.storage.dataDir = testDir;
    const database = openDatabase(config);

    try {
      const messages = new MessageRepository(database);
      messages.ingest({
        platform: "dev",
        platformChatId: "family",
        chatName: "家庭群",
        platformMessageId: "message-1",
        senderId: "mom",
        senderName: "老妈",
        messageType: "text",
        text: "端午活动改到 2026/6/30。",
        sentAt: "2026-04-25T08:00:00.000Z",
      });

      const result = await processMessagesNow({
        config,
        secrets: createDefaultSecrets(),
        database,
      });

      expect(result).toMatchObject({
        status: "skipped",
        chunks: 0,
        vectors: 0,
      });
      expect(result.reason).toContain("Embedding 配置不完整");
      expect(messages.searchMessages("端午活动")).toHaveLength(1);
    } finally {
      database.close();
    }
  });

  it("manual index 会把向量写入 SQLite vector store", async () => {
    const config = createDefaultConfig();
    config.storage.dataDir = testDir;
    config.embedding.baseUrl = "https://embeddings.example.com/v1";
    config.embedding.model = "test-embedding-model";
    const secrets = createDefaultSecrets();
    secrets.embedding.apiKey = "test-api-key";
    const database = openDatabase(config);

    try {
      const messages = new MessageRepository(database);
      messages.ingest({
        platform: "dev",
        platformChatId: "family",
        chatName: "家庭群",
        platformMessageId: "message-1",
        senderId: "mom",
        senderName: "老妈",
        messageType: "text",
        text: "端午活动改到 2026/6/30。",
        sentAt: "2026-04-25T08:00:00.000Z",
      });
      messages.ingest({
        platform: "dev",
        platformChatId: "family",
        chatName: "家庭群",
        platformMessageId: "message-2",
        senderId: "dad",
        senderName: "老爸",
        messageType: "text",
        text: "晚饭吃面。",
        sentAt: "2026-04-25T09:00:00.000Z",
      });

      const result = await processMessagesNow({
        config,
        secrets,
        database,
        embedding: fakeEmbedding,
      });
      const store = new SqliteVectorStore(database, { model: config.embedding.model });
      const countRow = database
        .prepare("SELECT COUNT(*) AS count FROM message_chunk_embeddings WHERE model = ?")
        .get(config.embedding.model) as { count: number };

      expect(result).toMatchObject({
        status: "completed",
        chunks: 2,
        vectors: 2,
      });
      expect(store.count()).toBe(2);
      expect(countRow.count).toBe(2);
    } finally {
      database.close();
    }
  });

  it("重复 manual index 不会重复计数", async () => {
    const config = createDefaultConfig();
    config.storage.dataDir = testDir;
    config.embedding.baseUrl = "https://embeddings.example.com/v1";
    config.embedding.model = "test-embedding-model";
    const secrets = createDefaultSecrets();
    secrets.embedding.apiKey = "test-api-key";
    const database = openDatabase(config);

    try {
      const messages = new MessageRepository(database);
      messages.ingest({
        platform: "dev",
        platformChatId: "family",
        chatName: "家庭群",
        platformMessageId: "message-1",
        senderId: "mom",
        senderName: "老妈",
        messageType: "text",
        text: "端午活动改到 2026/6/30。",
        sentAt: "2026-04-25T08:00:00.000Z",
      });

      const firstResult = await processMessagesNow({
        config,
        secrets,
        database,
        embedding: fakeEmbedding,
      });
      const secondResult = await processMessagesNow({
        config,
        secrets,
        database,
        embedding: fakeEmbedding,
      });
      const store = new SqliteVectorStore(database, { model: config.embedding.model });

      expect(firstResult).toMatchObject({ status: "completed", chunks: 1, vectors: 1 });
      expect(secondResult).toMatchObject({ status: "completed", chunks: 1, vectors: 1 });
      expect(store.count()).toBe(1);
    } finally {
      database.close();
    }
  });
});
