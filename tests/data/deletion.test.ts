import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDefaultConfig } from "../../src/config/schema.js";
import { deleteLocalData } from "../../src/data/deletion.js";
import { openDatabase } from "../../src/db/database.js";
import { ingestLocalFile } from "../../src/files/ingest.js";
import { FileJobRepository } from "../../src/files/jobs.js";
import { MessageRepository } from "../../src/messages/repository.js";

let testDir: string;

describe("data deletion", () => {
  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), "chattercatcher-delete-"));
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it("删除消息时同步清理 chunks 和 FTS", async () => {
    const config = createDefaultConfig();
    config.storage.dataDir = path.join(testDir, "data");
    const database = openDatabase(config);

    try {
      const messages = new MessageRepository(database);
      const messageId = messages.ingest({
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

      const result = await deleteLocalData({ config, database, targetType: "message", targetId: messageId });

      expect(result).toMatchObject({
        deletedMessages: 1,
        deletedChunks: 1,
        deletedFileJobs: 0,
      });
      expect(messages.getMessageCount()).toBe(0);
      expect(messages.searchMessages("端午活动")).toHaveLength(0);
    } finally {
      database.close();
    }
  });

  it("删除文件知识源时清理文件任务和 dataDir 内保存文件", async () => {
    const config = createDefaultConfig();
    config.storage.dataDir = path.join(testDir, "data");
    const sourcePath = path.join(testDir, "activity.md");
    await fs.writeFile(sourcePath, "端午活动改到 2026/6/30。", "utf8");
    const database = openDatabase(config);

    try {
      const messages = new MessageRepository(database);
      const jobs = new FileJobRepository(database);
      const imported = await ingestLocalFile({ config, messages, jobs, filePath: sourcePath });
      const storedPath = imported.storedPath;

      const result = await deleteLocalData({
        config,
        database,
        targetType: "file",
        targetId: imported.messageId,
      });

      await expect(fs.stat(storedPath)).rejects.toMatchObject({ code: "ENOENT" });
      await expect(fs.stat(sourcePath)).resolves.toBeTruthy();
      expect(result.deletedMessages).toBe(1);
      expect(result.deletedFileJobs).toBe(1);
      expect(result.deletedStoredFiles).toEqual([path.resolve(storedPath)]);
      expect(jobs.list()).toHaveLength(0);
      expect(messages.listFiles()).toHaveLength(0);
    } finally {
      database.close();
    }
  });

  it("删除群聊时删除群内消息并保留其他群", async () => {
    const config = createDefaultConfig();
    config.storage.dataDir = path.join(testDir, "data");
    const database = openDatabase(config);

    try {
      const messages = new MessageRepository(database);
      messages.ingest({
        platform: "dev",
        platformChatId: "family",
        chatName: "家庭群",
        platformMessageId: "family-1",
        senderId: "mom",
        senderName: "老妈",
        messageType: "text",
        text: "家庭群的专属暗号蓝莓派。",
        sentAt: "2026-04-25T08:00:00.000Z",
      });
      messages.ingest({
        platform: "dev",
        platformChatId: "school",
        chatName: "学校群",
        platformMessageId: "school-1",
        senderId: "teacher",
        senderName: "老师",
        messageType: "text",
        text: "学校群的春游安排。",
        sentAt: "2026-04-25T09:00:00.000Z",
      });
      const familyChat = messages.listChats().find((chat) => chat.name === "家庭群");

      const result = await deleteLocalData({
        config,
        database,
        targetType: "chat",
        targetId: familyChat?.id ?? "",
      });

      expect(result).toMatchObject({
        deletedChats: 1,
        deletedMessages: 1,
        deletedChunks: 1,
      });
      expect(messages.searchMessages("蓝莓派")).toHaveLength(0);
      expect(messages.searchMessages("春游安排")).toHaveLength(1);
      expect(messages.getChatCount()).toBe(1);
      expect(messages.getMessageCount()).toBe(1);
    } finally {
      database.close();
    }
  });
});
