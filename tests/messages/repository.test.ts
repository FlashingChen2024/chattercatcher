import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDefaultConfig } from "../../src/config/schema.js";
import { openDatabase } from "../../src/db/database.js";
import { MessageRepository } from "../../src/messages/repository.js";
import { MessageFtsRetriever } from "../../src/rag/message-retriever.js";

let testDir: string;

describe("message repository", () => {
  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), "chattercatcher-db-"));
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it("写入消息并通过 FTS 检索为 RAG 证据", async () => {
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
        text: "端午活动改到 2026/6/30，以这个为准。",
        sentAt: "2026-04-25T08:00:00.000Z",
        rawPayload: { fixture: true },
      });

      const retriever = new MessageFtsRetriever(messages);
      const evidence = await retriever.retrieve("端午活动什么时候");

      expect(messages.getChatCount()).toBe(1);
      expect(messages.getMessageCount()).toBe(1);
      expect(evidence).toHaveLength(1);
      expect(evidence[0]?.text).toContain("2026/6/30");
      expect(evidence[0]?.source).toMatchObject({
        type: "message",
        label: "家庭群",
        sender: "老妈",
      });
    } finally {
      database.close();
    }
  });

  it("重复平台消息会更新内容并重建 FTS", async () => {
    const config = createDefaultConfig();
    config.storage.dataDir = testDir;
    const database = openDatabase(config);
    try {
      const messages = new MessageRepository(database);

      const base = {
        platform: "dev",
        platformChatId: "family",
        chatName: "家庭群",
        platformMessageId: "message-1",
        senderId: "mom",
        senderName: "老妈",
        messageType: "text",
        sentAt: "2026-04-25T08:00:00.000Z",
      };

      messages.ingest({ ...base, text: "活动暂定 2026/5/30。" });
      expect(messages.hasPlatformMessage("dev", "message-1")).toBe(true);
      expect(messages.hasPlatformMessage("dev", "missing")).toBe(false);
      messages.ingest({ ...base, text: "活动改到 2026/6/30。" });

      expect(messages.getMessageCount()).toBe(1);
      expect(messages.searchMessages("2026/5/30")).toHaveLength(0);
      expect(messages.searchMessages("2026/6/30")).toHaveLength(1);
    } finally {
      database.close();
    }
  });

  it("检索时可以排除当前提问消息", async () => {
    const config = createDefaultConfig();
    config.storage.dataDir = testDir;
    const database = openDatabase(config);
    try {
      const messages = new MessageRepository(database);
      const questionId = messages.ingest({
        platform: "dev",
        platformChatId: "family",
        chatName: "家庭群",
        platformMessageId: "question",
        senderId: "me",
        senderName: "我",
        messageType: "text",
        text: "端午活动什么时候？",
        sentAt: "2026-04-25T08:00:00.000Z",
      });

      expect(messages.searchMessages("端午活动什么时候")).toHaveLength(1);
      expect(messages.searchMessages("端午活动什么时候", 8, { excludeMessageIds: [questionId] })).toHaveLength(0);
    } finally {
      database.close();
    }
  });
});
