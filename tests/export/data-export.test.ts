import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDefaultConfig } from "../../src/config/schema.js";
import { openDatabase } from "../../src/db/database.js";
import { exportLocalData } from "../../src/export/data-export.js";
import { ingestLocalFile } from "../../src/files/ingest.js";
import { FileJobRepository } from "../../src/files/jobs.js";
import { MessageRepository } from "../../src/messages/repository.js";

let testDir: string;

describe("data export", () => {
  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), "chattercatcher-export-"));
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it("导出本地知识库数据且不包含密钥", async () => {
    const config = createDefaultConfig();
    config.storage.dataDir = path.join(testDir, "data");
    const outputPath = path.join(testDir, "backup.json");
    const filePath = path.join(testDir, "activity.md");
    await fs.writeFile(filePath, "端午活动改到 2026/6/30。", "utf8");

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
        rawPayload: { fixture: true },
      });
      await ingestLocalFile({ config, messages, jobs: new FileJobRepository(database), filePath });

      const result = await exportLocalData({
        config,
        database,
        outputPath,
        exportedAt: "2026-04-26T00:00:00.000Z",
      });

      const payload = JSON.parse(await fs.readFile(outputPath, "utf8")) as {
        app: string;
        exportedAt: string;
        data: {
          chats: unknown[];
          messages: Array<{ text: string; rawPayload: Record<string, unknown> }>;
          chunks: unknown[];
          fileJobs: Array<{ fileName: string; status: string; warnings: string[] }>;
        };
      };

      expect(result).toMatchObject({
        outputPath,
        chats: 2,
        messages: 2,
        fileJobs: 1,
      });
      expect(result.chunks).toBeGreaterThanOrEqual(2);
      expect(payload.app).toBe("ChatterCatcher");
      expect(payload.exportedAt).toBe("2026-04-26T00:00:00.000Z");
      expect(payload.data.messages.map((message) => message.text)).toContain("端午活动改到 2026/6/30。");
      expect(payload.data.messages[0]?.rawPayload).toBeTypeOf("object");
      expect(payload.data.fileJobs[0]).toMatchObject({
        fileName: "activity.md",
        status: "indexed",
        warnings: [],
      });
      expect(await fs.readFile(outputPath, "utf8")).not.toContain("apiKey");
      expect(await fs.readFile(outputPath, "utf8")).not.toContain("appSecret");
    } finally {
      database.close();
    }
  });
});
