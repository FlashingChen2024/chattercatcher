import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDefaultConfig, createDefaultSecrets } from "../../src/config/schema.js";
import { openDatabase } from "../../src/db/database.js";
import { EpisodeRepository } from "../../src/episodes/repository.js";
import { MessageRepository } from "../../src/messages/repository.js";
import { createHybridRetriever } from "../../src/rag/factory.js";

let testDir: string;

describe("episode retrieval", () => {
  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), "chattercatcher-episode-rag-"));
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it("混合检索包含会话记忆块证据", async () => {
    const config = createDefaultConfig();
    config.storage.dataDir = testDir;
    const secrets = createDefaultSecrets();
    const database = openDatabase(config);
    const messages = new MessageRepository(database);
    const episodes = new EpisodeRepository(database);

    try {
      messages.ingest({
        platform: "dev",
        platformChatId: "family",
        chatName: "家庭群",
        platformMessageId: "m1",
        senderId: "me",
        senderName: "我",
        messageType: "text",
        text: "我要发一个 API key 出来。",
        sentAt: "2026-05-01T10:00:00.000Z",
      });
      messages.ingest({
        platform: "dev",
        platformChatId: "family",
        chatName: "家庭群",
        platformMessageId: "m2",
        senderId: "me",
        senderName: "我",
        messageType: "text",
        text: "sk-live-abc123",
        sentAt: "2026-05-01T10:01:00.000Z",
      });
      await episodes.summarizeReadyWindows({
        now: new Date("2026-05-01T10:04:00.000Z"),
        quietMs: 2 * 60 * 1000,
        windowMs: 10 * 60 * 1000,
        summarize: async () => "用户先说明要发送一个 API key，随后发送一段密钥，因此该密钥应查看关联原始消息。",
      });

      const { retriever, close } = await createHybridRetriever({ config, secrets, database, messages });
      const results = await retriever.retrieve("API key 是什么");
      close();

      expect(results[0]?.text).toContain("API key");
      expect(results[0]?.text).toContain("关联原始消息");
      expect(results[0]?.source).toMatchObject({ type: "episode", label: "家庭群", sender: "会话记忆" });
    } finally {
      database.close();
    }
  });

  it("较新的原始消息可以排在较旧会话记忆之前", async () => {
    const config = createDefaultConfig();
    config.storage.dataDir = testDir;
    const secrets = createDefaultSecrets();
    const database = openDatabase(config);
    const messages = new MessageRepository(database);
    const episodes = new EpisodeRepository(database);

    try {
      messages.ingest({
        platform: "dev",
        platformChatId: "family",
        chatName: "家庭群",
        platformMessageId: "old-1",
        senderId: "me",
        senderName: "我",
        messageType: "text",
        text: "端午活动改到 2026/6/30。",
        sentAt: "2026-05-01T10:00:00.000Z",
      });
      await episodes.summarizeReadyWindows({
        now: new Date("2026-05-01T10:04:00.000Z"),
        quietMs: 2 * 60 * 1000,
        windowMs: 10 * 60 * 1000,
        summarize: async () => "端午活动时间是 2026/6/30。",
      });
      messages.ingest({
        platform: "dev",
        platformChatId: "family",
        chatName: "家庭群",
        platformMessageId: "new-1",
        senderId: "mom",
        senderName: "老妈",
        messageType: "text",
        text: "端午活动最终改到 2026/7/1。",
        sentAt: "2026-05-01T11:00:00.000Z",
      });

      const { retriever, close } = await createHybridRetriever({ config, secrets, database, messages });
      const results = await retriever.retrieve("端午活动时间");
      close();

      expect(results[0]?.text).toContain("2026/7/1");
      expect(results[0]?.source.type).toBe("message");
    } finally {
      database.close();
    }
  });
});
