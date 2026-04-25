import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDefaultConfig, createDefaultSecrets } from "../../src/config/schema.js";
import { openDatabase } from "../../src/db/database.js";
import { FeishuQuestionHandler, getFeishuQuestionDecision } from "../../src/feishu/question.js";
import type { MessageSender } from "../../src/feishu/sender.js";
import { MessageRepository } from "../../src/messages/repository.js";
import type { ChatModel } from "../../src/rag/types.js";

let testDir: string;

describe("getFeishuQuestionDecision", () => {
  it("默认必须 @ 才回答", () => {
    const config = createDefaultConfig();
    const decision = getFeishuQuestionDecision(
      {
        event: {
          message: {
            message_id: "om_1",
            chat_id: "oc_family",
            message_type: "text",
            content: JSON.stringify({ text: "端午活动什么时候？" }),
          },
        },
      },
      config,
    );

    expect(decision.shouldAnswer).toBe(false);
  });

  it("提取 @ 后的问题文本", () => {
    const config = createDefaultConfig();
    const decision = getFeishuQuestionDecision(
      {
        event: {
          message: {
            message_id: "om_1",
            chat_id: "oc_family",
            message_type: "text",
            content: JSON.stringify({ text: "@ChatterCatcher 端午活动什么时候？" }),
            mentions: [{ name: "ChatterCatcher", key: "@_user_1" }],
          },
        },
      },
      config,
    );

    expect(decision).toMatchObject({
      shouldAnswer: true,
      question: "端午活动什么时候？",
      chatId: "oc_family",
    });
  });
});

describe("FeishuQuestionHandler", () => {
  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), "chattercatcher-question-"));
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it("通过 RAG 生成答案并发送到原群", async () => {
    const config = createDefaultConfig();
    config.storage.dataDir = testDir;
    const secrets = createDefaultSecrets();
    const database = openDatabase(config);
    const sent: Array<{ chatId: string; text: string }> = [];
    const sender: MessageSender = {
      async sendTextToChat(chatId, text) {
        sent.push({ chatId, text });
      },
    };
    const model: ChatModel = {
      async complete(messages) {
        expect(messages[1]?.content).toContain("检索证据");
        return "端午活动目前是 2026/6/30。[S1]";
      },
    };

    try {
      const messages = new MessageRepository(database);
      messages.ingest({
        platform: "feishu",
        platformChatId: "oc_family",
        chatName: "家庭群",
        platformMessageId: "om_fact",
        senderId: "ou_mom",
        senderName: "老妈",
        messageType: "text",
        text: "端午活动改到 2026/6/30，以这个为准。",
        sentAt: "2026-04-25T08:00:00.000Z",
      });

      const decision = await new FeishuQuestionHandler({
        config,
        secrets,
        database,
        model,
        sender,
      }).handle({
        event: {
          message: {
            message_id: "om_question",
            chat_id: "oc_family",
            message_type: "text",
            content: JSON.stringify({ text: "@ChatterCatcher 端午活动什么时候？" }),
            mentions: [{ name: "ChatterCatcher", key: "@_user_1" }],
          },
        },
      });

      expect(decision.shouldAnswer).toBe(true);
      expect(sent).toHaveLength(1);
      expect(sent[0]).toMatchObject({
        chatId: "oc_family",
      });
      expect(sent[0]?.text).toContain("端午活动目前是 2026/6/30");
      expect(sent[0]?.text).toContain("引用");
    } finally {
      database.close();
    }
  });

  it("回答生成失败时向群里说明原因", async () => {
    const config = createDefaultConfig();
    config.storage.dataDir = testDir;
    const secrets = createDefaultSecrets();
    const database = openDatabase(config);
    const sent: Array<{ chatId: string; text: string }> = [];

    try {
      const messages = new MessageRepository(database);
      messages.ingest({
        platform: "feishu",
        platformChatId: "oc_family",
        chatName: "家庭群",
        platformMessageId: "om_fact",
        senderId: "ou_mom",
        senderName: "老妈",
        messageType: "text",
        text: "端午活动改到 2026/6/30。",
        sentAt: "2026-04-25T08:00:00.000Z",
      });

      await new FeishuQuestionHandler({
        config,
        secrets,
        database,
        model: {
          async complete() {
            throw new Error("模型未配置");
          },
        },
        sender: {
          async sendTextToChat(chatId, text) {
            sent.push({ chatId, text });
          },
        },
      }).handle({
        event: {
          message: {
            message_id: "om_question",
            chat_id: "oc_family",
            message_type: "text",
            content: JSON.stringify({ text: "@ChatterCatcher 端午活动什么时候？" }),
            mentions: [{ name: "ChatterCatcher", key: "@_user_1" }],
          },
        },
      });

      expect(sent[0]?.text).toContain("暂时无法回答：模型未配置");
    } finally {
      database.close();
    }
  });
});
