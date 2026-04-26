import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDefaultConfig } from "../../src/config/schema.js";
import { openDatabase } from "../../src/db/database.js";
import { exportLocalData } from "../../src/export/data-export.js";
import { restoreLocalData } from "../../src/export/data-restore.js";
import { ingestLocalFile } from "../../src/files/ingest.js";
import { FileJobRepository } from "../../src/files/jobs.js";
import { MessageRepository } from "../../src/messages/repository.js";
import { MessageFtsRetriever } from "../../src/rag/message-retriever.js";

let testDir: string;

describe("data restore", () => {
  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), "chattercatcher-restore-"));
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  async function createExportFile(): Promise<string> {
    const config = createDefaultConfig();
    config.storage.dataDir = path.join(testDir, "source-data");
    const filePath = path.join(testDir, "activity.md");
    const exportPath = path.join(testDir, "backup.json");
    await fs.writeFile(filePath, "文件里写着端午活动改到 2026/6/30。", "utf8");

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
      await ingestLocalFile({ config, messages, jobs: new FileJobRepository(database), filePath });
      await exportLocalData({ config, database, outputPath: exportPath });
      return exportPath;
    } finally {
      database.close();
    }
  }

  it("从导出文件恢复消息、文件任务并重建 FTS", async () => {
    const exportPath = await createExportFile();
    const config = createDefaultConfig();
    config.storage.dataDir = path.join(testDir, "restored-data");

    const database = openDatabase(config);
    try {
      const result = await restoreLocalData({ database, inputPath: exportPath });
      const messages = new MessageRepository(database);
      const evidence = await new MessageFtsRetriever(messages).retrieve("端午活动什么时候");
      const files = messages.listFiles();

      expect(result).toMatchObject({
        mode: "merge",
        chats: 2,
        messages: 2,
        fileJobs: 1,
      });
      expect(messages.getMessageCount()).toBe(2);
      expect(evidence.some((item) => item.text.includes("2026/6/30"))).toBe(true);
      expect(files[0]).toMatchObject({
        fileName: "activity.md",
        parser: "text",
      });
      expect(new FileJobRepository(database).list()).toHaveLength(1);
    } finally {
      database.close();
    }
  });

  it("replace 模式会先清空当前知识库", async () => {
    const exportPath = await createExportFile();
    const config = createDefaultConfig();
    config.storage.dataDir = path.join(testDir, "replace-data");

    const database = openDatabase(config);
    try {
      const messages = new MessageRepository(database);
      messages.ingest({
        platform: "dev",
        platformChatId: "old",
        chatName: "旧群",
        platformMessageId: "old-message",
        senderId: "old",
        senderName: "旧消息",
        messageType: "text",
        text: "这条消息应该被替换掉。",
        sentAt: "2026-04-24T08:00:00.000Z",
      });

      const result = await restoreLocalData({ database, inputPath: exportPath, replace: true });

      expect(result.mode).toBe("replace");
      expect(messages.searchMessages("替换掉")).toHaveLength(0);
      expect(messages.searchMessages("2026/6/30").length).toBeGreaterThan(0);
    } finally {
      database.close();
    }
  });
});
