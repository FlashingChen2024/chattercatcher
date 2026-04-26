import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDefaultConfig, createDefaultSecrets } from "../../src/config/schema.js";
import { openDatabase } from "../../src/db/database.js";
import { MessageRepository } from "../../src/messages/repository.js";
import { processMessagesNow } from "../../src/rag/manual-index.js";

let testDir: string;

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
});
