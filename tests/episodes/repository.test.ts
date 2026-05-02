import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDefaultConfig } from "../../src/config/schema.js";
import { openDatabase } from "../../src/db/database.js";
import { EpisodeRepository } from "../../src/episodes/repository.js";
import { MessageRepository } from "../../src/messages/repository.js";

let testDir: string;

describe("EpisodeRepository", () => {
  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), "chattercatcher-episodes-"));
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it("为静默后的聊天窗口生成可检索会话记忆块并关联原始消息", async () => {
    const config = createDefaultConfig();
    config.storage.dataDir = testDir;
    const database = openDatabase(config);
    const messages = new MessageRepository(database);
    const episodes = new EpisodeRepository(database);

    try {
      const firstMessageId = messages.ingest({
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
      const secondMessageId = messages.ingest({
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

      const created = await episodes.summarizeReadyWindows({
        now: new Date("2026-05-01T10:04:00.000Z"),
        quietMs: 2 * 60 * 1000,
        windowMs: 10 * 60 * 1000,
        summarize: async (window) => {
          expect(window.messages.map((message) => message.text)).toEqual(["我要发一个 API key 出来。", "sk-live-abc123"]);
          return "用户先说明要发送一个 API key，随后发送 sk-live-abc123，因此 sk-live-abc123 是该 API key。";
        },
      });

      expect(created).toHaveLength(1);
      expect(created[0]?.messageIds).toEqual([firstMessageId, secondMessageId]);
      const results = episodes.searchEpisodes("API key 是什么");
      expect(results[0]?.text).toContain("[REDACTED_SECRET] 是该 API key");
      expect(results[0]?.text).not.toContain("sk-live-abc123");
      expect(results[0]?.sourceMessageIds).toEqual([firstMessageId, secondMessageId]);
      expect(() => episodes.searchEpisodes('API key "sk-live" OR token:*')).not.toThrow();
    } finally {
      database.close();
    }
  });

  it("按结束时间倒序列出会话记忆并统计数量", async () => {
    const config = createDefaultConfig();
    config.storage.dataDir = testDir;
    const database = openDatabase(config);
    const messages = new MessageRepository(database);
    const episodes = new EpisodeRepository(database);

    try {
      messages.ingest({
        platform: "dev",
        platformChatId: "family",
        chatName: "家庭群",
        platformMessageId: "first",
        senderId: "mom",
        senderName: "老妈",
        messageType: "text",
        text: "第一段记忆。",
        sentAt: "2026-04-25T08:00:00.000Z",
      });
      await episodes.summarizeReadyWindows({
        now: new Date("2026-04-25T08:03:00.000Z"),
        quietMs: 2 * 60 * 1000,
        windowMs: 10 * 60 * 1000,
        summarize: async () => "第一段摘要。",
      });
      messages.ingest({
        platform: "dev",
        platformChatId: "family",
        chatName: "家庭群",
        platformMessageId: "second",
        senderId: "dad",
        senderName: "老爸",
        messageType: "text",
        text: "第二段记忆。",
        sentAt: "2026-04-25T08:20:00.000Z",
      });
      await episodes.summarizeReadyWindows({
        now: new Date("2026-04-25T08:23:00.000Z"),
        quietMs: 2 * 60 * 1000,
        windowMs: 10 * 60 * 1000,
        summarize: async () => "第二段摘要。",
      });

      expect(episodes.getEpisodeCount()).toBe(2);
      expect(episodes.listRecentEpisodes(2).map((episode) => episode.summary)).toEqual(["第二段摘要。", "第一段摘要。"]);
    } finally {
      database.close();
    }
  });

  it("删除聊天后不会从 FTS 返回孤儿会话记忆", async () => {
    const config = createDefaultConfig();
    config.storage.dataDir = testDir;
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
        text: "端午活动时间是 6 月 30 日。",
        sentAt: "2026-05-01T10:00:00.000Z",
      });

      await episodes.summarizeReadyWindows({
        now: new Date("2026-05-01T10:04:00.000Z"),
        quietMs: 2 * 60 * 1000,
        windowMs: 10 * 60 * 1000,
        summarize: async () => "端午活动时间是 6 月 30 日。",
      });
      expect(episodes.searchEpisodes("6 月 30 日")).toHaveLength(1);

      database.prepare("DELETE FROM chats WHERE platform = ? AND platform_chat_id = ?").run("dev", "family");

      const ftsRows = database.prepare("SELECT count(*) AS count FROM memory_episodes_fts").get() as { count: number };
      expect(ftsRows.count).toBe(0);
      expect(episodes.searchEpisodes("6 月 30 日")).toHaveLength(0);
    } finally {
      database.close();
    }
  });

  it("派生图片转述生成后会重算所属会话记忆窗口", async () => {
    const config = createDefaultConfig();
    config.storage.dataDir = testDir;
    const database = openDatabase(config);
    const messages = new MessageRepository(database);
    const episodes = new EpisodeRepository(database);

    try {
      const firstMessageId = messages.ingest({
        platform: "dev",
        platformChatId: "family",
        chatName: "家庭群",
        platformMessageId: "m1",
        senderId: "mom",
        senderName: "老妈",
        messageType: "text",
        text: "看一下这张白板。",
        sentAt: "2026-05-01T10:00:00.000Z",
      });
      const imageMessageId = messages.ingest({
        platform: "dev",
        platformChatId: "family",
        chatName: "家庭群",
        platformMessageId: "image-1",
        senderId: "mom",
        senderName: "老妈",
        messageType: "image",
        text: "[图片] img-1",
        sentAt: "2026-05-01T10:01:00.000Z",
      });
      await episodes.summarizeReadyWindows({
        now: new Date("2026-05-01T10:04:00.000Z"),
        quietMs: 2 * 60 * 1000,
        windowMs: 10 * 60 * 1000,
        summarize: async () => "原摘要未包含图片转述。",
      });
      const derivedMessageId = messages.createImageSummaryMessage({
        sourceMessageId: imageMessageId,
        imageKey: "img-1",
        summary: "白板写着 5 月 10 日上线图片多模态功能。",
        multimodalModel: "vision",
        generatedAt: "2026-05-01T10:05:00.000Z",
      });

      messages.ingest({
        platform: "dev",
        platformChatId: "family",
        chatName: "家庭群",
        platformMessageId: "next-window",
        senderId: "dad",
        senderName: "老爸",
        messageType: "text",
        text: "下一段窗口里的内容不应被重算拉进来。",
        sentAt: "2026-05-01T10:08:00.000Z",
      });

      const refreshed = await episodes.refreshWindowForMessage({
        messageId: derivedMessageId,
        windowMs: 10 * 60 * 1000,
        summarize: async (window) => {
          expect(window.messages.map((message) => message.id)).toEqual([firstMessageId, imageMessageId, derivedMessageId]);
          return "本窗口包含图片转述：白板写着 5 月 10 日上线图片多模态功能。";
        },
      });

      expect(refreshed?.messageIds).toEqual([firstMessageId, imageMessageId, derivedMessageId]);
      expect(episodes.getEpisodeCount()).toBe(1);
      expect(episodes.listRecentEpisodes(1)[0]?.summary).toContain("图片转述");
      expect(episodes.searchEpisodes("10")[0]?.sourceMessageIds).toEqual([
        firstMessageId,
        imageMessageId,
        derivedMessageId,
      ]);
    } finally {
      database.close();
    }
  });
});
