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

  it("为有意义图片转述创建可检索的派生文字消息", async () => {
    const config = createDefaultConfig();
    config.storage.dataDir = testDir;
    const database = openDatabase(config);
    try {
      const messages = new MessageRepository(database);
      const sourceMessageId = messages.ingest({
        platform: "feishu",
        platformChatId: "chat-1",
        chatName: "项目群",
        platformMessageId: "image-message-1",
        senderId: "alice",
        senderName: "Alice",
        messageType: "image",
        text: "[图片] img_v2_123",
        sentAt: "2026-05-02T08:00:00.000Z",
        rawPayload: { attachments: [{ kind: "image", resourceKey: "img_v2_123" }] },
      });

      const derivedMessageId = messages.createImageSummaryMessage({
        sourceMessageId,
        imageKey: "img_v2_123",
        summary: "白板上写着 5 月 10 日上线多模态图片处理。",
        reason: "包含上线计划",
        multimodalModel: "vision-model",
        generatedAt: "2026-05-02T08:01:00.000Z",
      });

      const evidence = messages.searchMessages("多模态");
      const rawPayload = database
        .prepare("SELECT message_type AS messageType, text, raw_payload_json AS rawPayloadJson FROM messages WHERE id = ?")
        .get(derivedMessageId) as { messageType: string; text: string; rawPayloadJson: string };

      expect(messages.getMessageCount()).toBe(2);
      expect(rawPayload.messageType).toBe("image_summary");
      expect(rawPayload.text).toBe("[图片转述] 白板上写着 5 月 10 日上线多模态图片处理。");
      expect(JSON.parse(rawPayload.rawPayloadJson)).toMatchObject({
        derivedFromMessageId: sourceMessageId,
        sourceAttachmentKind: "image",
        sourceResourceKey: "img_v2_123",
        multimodalModel: "vision-model",
        isMeaningful: true,
        reason: "包含上线计划",
        generatedAt: "2026-05-02T08:01:00.000Z",
      });
      expect(evidence).toEqual([
        expect.objectContaining({
          messageId: derivedMessageId,
          messageType: "image_summary",
          text: "[图片转述] 白板上写着 5 月 10 日上线多模态图片处理。",
        }),
      ]);
    } finally {
      database.close();
    }
  });

  it("重复创建同一图片转述时不产生重复派生消息", async () => {
    const config = createDefaultConfig();
    config.storage.dataDir = testDir;
    const database = openDatabase(config);
    try {
      const messages = new MessageRepository(database);
      const sourceMessageId = messages.ingest({
        platform: "feishu",
        platformChatId: "chat-1",
        chatName: "项目群",
        platformMessageId: "image-message-1",
        senderId: "alice",
        senderName: "Alice",
        messageType: "image",
        text: "[图片] img_v2_123",
        sentAt: "2026-05-02T08:00:00.000Z",
      });

      const firstId = messages.createImageSummaryMessage({
        sourceMessageId,
        imageKey: "img_v2_123",
        summary: "old-image-summary-token",
        multimodalModel: "vision-model",
        generatedAt: "2026-05-02T08:01:00.000Z",
      });
      const secondId = messages.createImageSummaryMessage({
        sourceMessageId,
        imageKey: "img_v2_123",
        summary: "new-image-summary-token",
        multimodalModel: "vision-model",
        generatedAt: "2026-05-02T08:02:00.000Z",
      });

      expect(secondId).toBe(firstId);
      expect(messages.getMessageCount()).toBe(2);
      expect(messages.searchMessages("old-image-summary-token")).toHaveLength(0);
      expect(messages.searchMessages("new-image-summary-token")).toHaveLength(1);
    } finally {
      database.close();
    }
  });
});
