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

  it("支持任务运行、成功、跳过和失败状态流转", () => {
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
      });
      const derivedMessageId = messages.ingest({
        platform: "dev",
        platformChatId: "family",
        chatName: "家庭群",
        platformMessageId: "derived-1",
        senderId: "mom",
        senderName: "老妈",
        messageType: "image_summary",
        text: "[图片转述] 有信息",
        sentAt: "2026-05-01T08:01:00.000Z",
      });
      const repository = new ImageMultimodalTaskRepository(database);

      const succeeded = repository.enqueue({
        sourceMessageId,
        platformMessageId: "message-1",
        imageKey: "img-success",
        storedPath: "/tmp/success.png",
        mimeType: "image/png",
      });
      const runningSucceeded = repository.markRunning(succeeded.id);
      const completed = repository.markSucceeded(succeeded.id, derivedMessageId);

      expect(runningSucceeded).toMatchObject({ status: "running", attempts: 1 });
      expect(completed).toMatchObject({ status: "succeeded", attempts: 1, derivedMessageId });
      expect(completed.lastError).toBeUndefined();

      const skipped = repository.enqueue({
        sourceMessageId,
        platformMessageId: "message-1",
        imageKey: "img-skip",
        storedPath: "/tmp/skip.png",
        mimeType: "image/png",
      });
      repository.markRunning(skipped.id);
      const skippedRecord = repository.markSkipped(skipped.id, "无有效信息");
      expect(skippedRecord).toMatchObject({ status: "skipped", attempts: 1, lastError: "无有效信息" });
      expect(skippedRecord.derivedMessageId).toBeUndefined();

      const retrying = repository.enqueue({
        sourceMessageId,
        platformMessageId: "message-1",
        imageKey: "img-retry",
        storedPath: "/tmp/retry.png",
        mimeType: "image/png",
      });
      repository.markRunning(retrying.id);
      const pendingAgain = repository.markFailed(retrying.id, "timeout", false);
      expect(pendingAgain).toMatchObject({ status: "pending", attempts: 1, lastError: "timeout" });

      repository.markRunning(retrying.id);
      const finalFailure = repository.markFailed(retrying.id, "still timeout", true);
      expect(finalFailure).toMatchObject({ status: "failed", attempts: 2, lastError: "still timeout" });
      expect(repository.listPending().map((task) => task.id)).not.toContain(retrying.id);
      expect(() => repository.markRunning(finalFailure.id)).toThrow("图片多模态任务状态无法更新");
    } finally {
      database.close();
    }
  });
});
