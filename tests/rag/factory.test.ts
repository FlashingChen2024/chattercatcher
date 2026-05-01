import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultConfig, createDefaultSecrets } from "../../src/config/schema.js";
import { openDatabase } from "../../src/db/database.js";
import { MessageRepository } from "../../src/messages/repository.js";
import { createHybridRetriever, hasEmbeddingConfig } from "../../src/rag/factory.js";

let testDir: string;

describe("createHybridRetriever", () => {
  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), "chattercatcher-factory-"));
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it("embedding 未配置时仅保留 FTS fallback", async () => {
    const config = createDefaultConfig();
    config.storage.dataDir = testDir;
    const secrets = createDefaultSecrets();
    const database = openDatabase(config);
    const messages = new MessageRepository(database);

    try {
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

      expect(hasEmbeddingConfig(config, secrets)).toBe(false);

      const { retriever, close } = await createHybridRetriever({
        config,
        secrets,
        database,
        messages,
      });

      const results = await retriever.retrieve("端午活动什么时候");
      close();

      expect(results).toHaveLength(1);
      expect(results[0]?.text).toContain("端午活动改到 2026/6/30");
    } finally {
      database.close();
    }
  });

  it("embedding 已配置时使用 SQLite vector retrieval", async () => {
    const config = createDefaultConfig();
    config.storage.dataDir = testDir;
    config.embedding.baseUrl = "https://embeddings.example.com/v1";
    config.embedding.model = "test-embedding-model";
    const secrets = createDefaultSecrets();
    secrets.embedding.apiKey = "test-api-key";
    const database = openDatabase(config);
    const messages = new MessageRepository(database);

    try {
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
      messages.ingest({
        platform: "dev",
        platformChatId: "family",
        chatName: "家庭群",
        platformMessageId: "message-2",
        senderId: "dad",
        senderName: "老爸",
        messageType: "text",
        text: "晚饭吃面。",
        sentAt: "2026-04-25T09:00:00.000Z",
      });

      const chunkRows = database
        .prepare(`
          SELECT mc.id, mc.text, m.platform_message_id AS platformMessageId
          FROM message_chunks mc
          JOIN messages m ON m.id = mc.message_id
          ORDER BY m.sent_at ASC, mc.chunk_index ASC
        `)
        .all() as Array<{ id: string; text: string; platformMessageId: string }>;
      const chunkByMessageId = new Map(chunkRows.map((row) => [row.platformMessageId, row]));
      const activityChunk = chunkByMessageId.get("message-1");
      const dinnerChunk = chunkByMessageId.get("message-2");
      expect(activityChunk).toBeDefined();
      expect(dinnerChunk).toBeDefined();

      database
        .prepare(
          `
            INSERT INTO message_chunk_embeddings (chunk_id, model, dimension, embedding_json, updated_at)
            VALUES (?, ?, ?, ?, ?)
          `,
        )
        .run(activityChunk!.id, config.embedding.model, 2, JSON.stringify([1, 0]), "2026-05-01T00:00:00.000Z");
      database
        .prepare(
          `
            INSERT INTO message_chunk_embeddings (chunk_id, model, dimension, embedding_json, updated_at)
            VALUES (?, ?, ?, ?, ?)
          `,
        )
        .run(dinnerChunk!.id, config.embedding.model, 2, JSON.stringify([0, 1]), "2026-05-01T00:00:00.000Z");

      const { retriever, close } = await createHybridRetriever({
        config,
        secrets,
        database,
        messages,
      });
      const fetchSpy = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
        const bodyText =
          typeof init?.body === "string"
            ? init.body
            : init?.body instanceof Uint8Array
              ? new TextDecoder().decode(init.body)
              : null;
        expect(bodyText).not.toBeNull();
        const payload = JSON.parse(bodyText! as string) as { input: string[]; model: string };
        expect(payload.model).toBe(config.embedding.model);
        expect(payload.input).toEqual(["活动什么时候"]);

        return new Response(
          JSON.stringify({
            data: payload.input.map((text) => ({ embedding: text ? [1, 0] : [0, 1] })),
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      });
      vi.stubGlobal("fetch", fetchSpy);

      const results = await retriever.retrieve("活动什么时候");
      expect(fetchSpy).toHaveBeenCalledOnce();
      expect(results[0]?.text).toContain("端午活动改到 2026/6/30");
      expect(results[0]?.source).toMatchObject({ label: "家庭群", sender: "老妈" });
      expect(() => close()).not.toThrow();
      expect(() => close()).not.toThrow();
    } finally {
      database.close();
    }
  });
});
