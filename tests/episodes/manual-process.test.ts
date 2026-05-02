import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDefaultConfig, createDefaultSecrets } from "../../src/config/schema.js";
import { openDatabase } from "../../src/db/database.js";
import { processEpisodesNow } from "../../src/episodes/manual-process.js";
import { EpisodeRepository } from "../../src/episodes/repository.js";
import { MessageRepository } from "../../src/messages/repository.js";
import type { ChatModel } from "../../src/rag/types.js";

let testDir: string;

describe("processEpisodesNow", () => {
  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), "chattercatcher-process-episodes-"));
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it("使用配置的窗口和静默时间生成会话记忆块", async () => {
    const config = createDefaultConfig();
    config.storage.dataDir = testDir;
    config.episodes.windowMinutes = 10;
    config.episodes.quietMinutes = 2;
    const secrets = createDefaultSecrets();
    const database = openDatabase(config);
    const messages = new MessageRepository(database);
    const model: ChatModel = {
      async complete() {
        return "用户先说明要发送一个 API key，随后发送 sk-live-abc123，因此 sk-live-abc123 是该 API key。";
      },
    };

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

      const result = await processEpisodesNow({
        config,
        secrets,
        database,
        model,
        now: new Date("2026-05-01T10:04:00.000Z"),
      });

      expect(result.created).toBe(1);
      expect(new EpisodeRepository(database).searchEpisodes("API key")[0]?.text).toContain("[REDACTED_SECRET]");
    } finally {
      database.close();
    }
  });
});
