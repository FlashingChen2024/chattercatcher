import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDefaultConfig } from "../../src/config/schema.js";
import { openDatabase } from "../../src/db/database.js";
import { MessageRepository } from "../../src/messages/repository.js";
import type { EmbeddingModel } from "../../src/rag/embedding.js";
import { indexMessageChunks } from "../../src/rag/indexer.js";
import { MemoryVectorStore } from "../../src/rag/vector-store.js";

let testDir: string;

const embedding: EmbeddingModel = {
  async embed(text) {
    return text.includes("端午") ? [1, 0] : [0, 1];
  },
  async embedBatch(texts) {
    return Promise.all(texts.map((text) => this.embed(text)));
  },
};

describe("indexMessageChunks", () => {
  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), "chattercatcher-indexer-"));
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it("把消息 chunks 写入向量库", async () => {
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

      const store = new MemoryVectorStore();
      const stats = await indexMessageChunks({ messages, embedding, store });
      const results = await store.search([1, 0], 1);

      expect(stats).toEqual({ chunks: 1, vectors: 1 });
      expect(results[0]?.text).toContain("2026/6/30");
    } finally {
      database.close();
    }
  });
});

