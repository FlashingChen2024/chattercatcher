import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDefaultConfig } from "../../src/config/schema.js";
import { openDatabase } from "../../src/db/database.js";
import { ingestLocalFile } from "../../src/files/ingest.js";
import { MessageRepository } from "../../src/messages/repository.js";
import { createWebApp } from "../../src/web/server.js";

let testDir: string;

describe("web server", () => {
  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), "chattercatcher-web-"));
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it("提供状态、群聊、最近消息和文件 API", async () => {
    const config = createDefaultConfig();
    config.storage.dataDir = path.join(testDir, "data");
    const filePath = path.join(testDir, "activity.md");
    await fs.writeFile(filePath, "端午活动改到 2026/6/30。", "utf8");

    const database = openDatabase(config);
    try {
      const repository = new MessageRepository(database);
      repository.ingest({
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
      await ingestLocalFile({ config, messages: repository, filePath });
    } finally {
      database.close();
    }

    const app = createWebApp(config);
    try {
      const status = await app.inject({ method: "GET", url: "/api/status" });
      expect(status.statusCode).toBe(200);
      expect(status.json()).toMatchObject({
        app: "ChatterCatcher",
        data: { chats: 2, messages: 2, files: 1 },
        rag: { mode: "required" },
      });

      const chats = await app.inject({ method: "GET", url: "/api/chats" });
      expect(chats.json().items.map((item: { name: string }) => item.name)).toContain("家庭群");

      const recent = await app.inject({ method: "GET", url: "/api/messages/recent?limit=1" });
      expect(recent.json().items[0]).toMatchObject({
        text: "端午活动改到 2026/6/30。",
      });

      const files = await app.inject({ method: "GET", url: "/api/files" });
      expect(files.json().items[0]).toMatchObject({
        fileName: "activity.md",
        parser: "text",
      });
      expect(files.json().items[0].characters).toBeGreaterThan(0);
    } finally {
      await app.close();
    }
  });

  it("首页使用中文文案并声明 RAG 约束", async () => {
    const config = createDefaultConfig();
    config.storage.dataDir = testDir;
    const app = createWebApp(config);
    try {
      const response = await app.inject({ method: "GET", url: "/" });
      expect(response.statusCode).toBe(200);
      expect(response.headers["content-type"]).toContain("text/html");
      expect(response.body).toContain("本地优先的家庭群知识库");
      expect(response.body).toContain("不堆叠全量上下文");
      expect(response.body).toContain("文件库");
    } finally {
      await app.close();
    }
  });
});
