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

  it("re-enqueue 会将非 pending 任务重置为待处理状态", () => {
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
      const derivedMessageId = messages.ingest({
        platform: "dev",
        platformChatId: "family",
        chatName: "家庭群",
        platformMessageId: "derived-1",
        senderId: "assistant",
        senderName: "助手",
        messageType: "text",
        text: "图片描述",
        sentAt: "2026-05-01T08:05:00.000Z",
        rawPayload: { source: "multimodal" },
      });

      const repository = new ImageMultimodalTaskRepository(database);
      const first = repository.enqueue({
        sourceMessageId,
        platformMessageId: "message-1",
        imageKey: "img-1",
        storedPath: "/tmp/original.png",
        mimeType: "image/png",
      });

      database
        .prepare(
          `
            UPDATE image_multimodal_tasks
            SET status = 'failed',
                attempts = 3,
                last_error = 'timeout',
                derived_message_id = @derivedMessageId,
                platform_message_id = 'message-old',
                stored_path = '/tmp/old.png',
                mime_type = 'image/jpeg',
                updated_at = '2026-05-01T08:10:00.000Z'
            WHERE id = @id
          `,
        )
        .run({ id: first.id, derivedMessageId });

      const reenqueued = repository.enqueue({
        sourceMessageId,
        platformMessageId: "message-2",
        imageKey: "img-1",
        storedPath: "/tmp/reenqueued.png",
        mimeType: "image/webp",
      });

      expect(reenqueued.id).toBe(first.id);
      expect(reenqueued.sourceMessageId).toBe(sourceMessageId);
      expect(reenqueued.imageKey).toBe("img-1");
      expect(reenqueued.platformMessageId).toBe("message-2");
      expect(reenqueued.storedPath).toBe("/tmp/reenqueued.png");
      expect(reenqueued.mimeType).toBe("image/webp");
      expect(reenqueued.status).toBe("pending");
      expect(reenqueued.attempts).toBe(0);
      expect(reenqueued.lastError).toBeUndefined();
      expect(reenqueued.derivedMessageId).toBeUndefined();
      expect(reenqueued.updatedAt).not.toBe("2026-05-01T08:10:00.000Z");

      const pending = repository.listPending();
      expect(pending).toHaveLength(1);
      expect(pending[0]).toMatchObject({
        id: first.id,
        sourceMessageId,
        platformMessageId: "message-2",
        imageKey: "img-1",
        storedPath: "/tmp/reenqueued.png",
        mimeType: "image/webp",
        status: "pending",
        attempts: 0,
      });
      expect(pending[0].lastError).toBeUndefined();
      expect(pending[0].derivedMessageId).toBeUndefined();
    } finally {
      database.close();
    }
  });
});
