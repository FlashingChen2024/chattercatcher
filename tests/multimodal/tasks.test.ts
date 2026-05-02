import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDefaultConfig } from "../../src/config/schema.js";
import { openDatabase } from "../../src/db/database.js";
import { MessageRepository } from "../../src/messages/repository.js";
import { ImageMultimodalTaskRepository } from "../../src/multimodal/tasks.js";

let testDir: string;

describe("image multimodal task repository", () => {
  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), "chattercatcher-multimodal-"));
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it("enqueue 对相同 sourceMessageId + imageKey 幂等，并且只返回一个待处理任务", () => {
    const config = createDefaultConfig();
    config.storage.dataDir = testDir;
    const database = openDatabase(config);

    try {
      const messages = new MessageRepository(database);
      const sourceMessageId = messages.ingest({
        platform: "dev",
        platformChatId: "family",
        chatName: "家庭群",
        platformMessageId: "message-1",
        senderId: "mom",
        senderName: "老妈",
        messageType: "image",
        text: "[图片]",
        sentAt: "2026-05-01T08:00:00.000Z",
        rawPayload: { imageKey: "img-1" },
      });

      const repository = new ImageMultimodalTaskRepository(database);
      const first = repository.enqueue({
        sourceMessageId,
        platformMessageId: "message-1",
        imageKey: "img-1",
        storedPath: "/tmp/original.png",
        mimeType: "image/png",
      });
      const second = repository.enqueue({
        sourceMessageId,
        platformMessageId: "message-1",
        imageKey: "img-1",
        storedPath: "/tmp/updated.png",
        mimeType: "image/png",
      });

      expect(second.id).toBe(first.id);
      expect(second.sourceMessageId).toBe(sourceMessageId);
      expect(second.imageKey).toBe("img-1");
      expect(second.storedPath).toBe("/tmp/updated.png");
      expect(second.status).toBe("pending");
      expect(second.attempts).toBe(0);
      expect(second.lastError).toBeUndefined();
      expect(second.derivedMessageId).toBeUndefined();

      const pending = repository.listPending();
      expect(pending).toHaveLength(1);
      expect(pending[0]).toMatchObject({
        id: first.id,
        sourceMessageId,
        platformMessageId: "message-1",
        imageKey: "img-1",
        storedPath: "/tmp/updated.png",
        mimeType: "image/png",
        status: "pending",
        attempts: 0,
      });
    } finally {
      database.close();
    }
  });
});
