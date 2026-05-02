import type * as lark from "@larksuiteoapi/node-sdk";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDefaultConfig, createDefaultSecrets } from "../../src/config/schema.js";
import { openDatabase } from "../../src/db/database.js";
import { EpisodeRepository } from "../../src/episodes/repository.js";
import { createFeishuGateway } from "../../src/feishu/gateway.js";
import { GatewayIngestor } from "../../src/gateway/ingest.js";
import type { ChatModel } from "../../src/rag/types.js";

let testDir: string;

describe("Feishu gateway episode processing", () => {
  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), "chattercatcher-gateway-episodes-"));
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it("普通消息入库后自动尝试生成静默窗口会话记忆", async () => {
    const config = createDefaultConfig();
    config.storage.dataDir = testDir;
    config.feishu.appId = "cli_app_id";
    config.episodes.windowMinutes = 10;
    config.episodes.quietMinutes = 2;
    const secrets = createDefaultSecrets();
    secrets.feishu.appSecret = "app_secret";
    const database = openDatabase(config);
    const model: ChatModel = {
      async complete() {
        return "用户先说明要发送一个 API key，随后发送一段密钥，因此该密钥应查看关联原始消息。";
      },
    };

    try {
      const runtime = createFeishuGateway({
        config,
        secrets,
        ingestor: new GatewayIngestor(database),
        episodeProcessor: { database, model, now: () => new Date("2026-05-01T10:04:00.000Z") },
        wsClientFactory: () => ({
          async start(params: { eventDispatcher: lark.EventDispatcher }) {
            const handler = params.eventDispatcher.handles.get("im.message.receive_v1");
            await handler?.({
              sender: { sender_id: { open_id: "ou_user" } },
              message: {
                message_id: "m1",
                chat_id: "oc_family",
                create_time: "1777629600000",
                message_type: "text",
                content: JSON.stringify({ text: "我要发一个 API key 出来。" }),
              },
            });
            await handler?.({
              sender: { sender_id: { open_id: "ou_user" } },
              message: {
                message_id: "m2",
                chat_id: "oc_family",
                create_time: "1777629660000",
                message_type: "text",
                content: JSON.stringify({ text: "sk-live-abc123" }),
              },
            });
          },
          close() {},
        }),
      });

      await runtime.start();

      const result = new EpisodeRepository(database).searchEpisodes("API key")[0];
      expect(result?.text).toContain("关联原始消息");
    } finally {
      database.close();
    }
  });
});
