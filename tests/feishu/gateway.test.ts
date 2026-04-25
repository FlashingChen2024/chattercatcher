import type * as lark from "@larksuiteoapi/node-sdk";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDefaultConfig, createDefaultSecrets } from "../../src/config/schema.js";
import { openDatabase } from "../../src/db/database.js";
import { createFeishuGateway } from "../../src/feishu/gateway.js";
import { GatewayIngestor } from "../../src/gateway/ingest.js";
import { MessageRepository } from "../../src/messages/repository.js";

let testDir: string;

describe("createFeishuGateway", () => {
  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), "chattercatcher-feishu-gateway-"));
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it("配置不完整时拒绝创建真实 Gateway", () => {
    const config = createDefaultConfig();
    const secrets = createDefaultSecrets();

    expect(() =>
      createFeishuGateway({
        config,
        secrets,
        ingestor: {} as GatewayIngestor,
      }),
    ).toThrow("飞书配置不完整");
  });

  it("长连接事件进入 GatewayIngestor 并写入消息库", async () => {
    const config = createDefaultConfig();
    config.storage.dataDir = testDir;
    config.feishu.appId = "cli_app_id";
    const secrets = createDefaultSecrets();
    secrets.feishu.appSecret = "app_secret";
    const database = openDatabase(config);

    try {
      const runtime = createFeishuGateway({
        config,
        secrets,
        ingestor: new GatewayIngestor(database),
        wsClientFactory: () => ({
          async start(params: { eventDispatcher: lark.EventDispatcher }) {
            const handler = params.eventDispatcher.handles.get("im.message.receive_v1");
            expect(handler).toBeDefined();
            await handler?.({
              sender: { sender_id: { open_id: "ou_mom" } },
              message: {
                message_id: "om_1",
                chat_id: "oc_family",
                create_time: "1777111200000",
                message_type: "text",
                content: JSON.stringify({ text: "端午活动改到 2026/6/30，以这个为准。" }),
              },
            });
          },
          close() {},
        }),
      });

      await runtime.start();

      const messages = new MessageRepository(database);
      expect(messages.getMessageCount()).toBe(1);
      expect(messages.searchMessages("端午活动什么时候")[0]?.text).toContain("2026/6/30");
    } finally {
      database.close();
    }
  });
});

