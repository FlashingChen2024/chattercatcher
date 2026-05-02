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

  it("长连接鉴权异常时提示检查 App ID 和 App Secret", async () => {
    const config = createDefaultConfig();
    config.feishu.appId = "cli_app_id";
    const secrets = createDefaultSecrets();
    secrets.feishu.appSecret = "wrong_secret";

    const runtime = createFeishuGateway({
      config,
      secrets,
      ingestor: {} as GatewayIngestor,
      wsClientFactory: () => ({
        async start() {
          throw new TypeError("Cannot read properties of undefined (reading 'PingInterval')");
        },
        close() {},
      }),
    });

    await expect(runtime.start()).rejects.toThrow("飞书长连接启动失败，请检查 App ID / App Secret");
  });

  it("长连接 system busy 异常时提示检查 App ID 和 App Secret", async () => {
    const config = createDefaultConfig();
    config.feishu.appId = "cli_app_id";
    const secrets = createDefaultSecrets();
    secrets.feishu.appSecret = "wrong_secret";

    const runtime = createFeishuGateway({
      config,
      secrets,
      ingestor: {} as GatewayIngestor,
      wsClientFactory: () => ({
        async start() {
          throw new Error("code: 1000040345, system busy");
        },
        close() {},
      }),
    });

    await expect(runtime.start()).rejects.toThrow("飞书长连接启动失败，请检查 App ID / App Secret");
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

  it("普通文本包含产品名但没有飞书 mention 时仍然入库且不回答", async () => {
    const config = createDefaultConfig();
    config.storage.dataDir = testDir;
    config.feishu.appId = "cli_app_id";
    config.feishu.requireMention = true;
    const secrets = createDefaultSecrets();
    secrets.feishu.appSecret = "app_secret";
    const database = openDatabase(config);
    const handled: unknown[] = [];

    try {
      const runtime = createFeishuGateway({
        config,
        secrets,
        ingestor: new GatewayIngestor(database),
        questionHandler: {
          async handle(payload: unknown) {
            handled.push(payload);
            return { shouldAnswer: false, reason: "群聊配置为必须 @ 后回答。" };
          },
        } as never,
        wsClientFactory: () => ({
          async start(params: { eventDispatcher: lark.EventDispatcher }) {
            const handler = params.eventDispatcher.handles.get("im.message.receive_v1");
            await handler?.({
              sender: { sender_id: { open_id: "ou_user" } },
              message: {
                message_id: "om_product_text",
                chat_id: "oc_family",
                create_time: "1777111200000",
                message_type: "text",
                content: JSON.stringify({ text: "OK了 ChatterCatcher 复活了" }),
              },
            });
          },
          close() {},
        }),
      });

      await runtime.start();

      const messages = new MessageRepository(database);
      expect(messages.getMessageCount()).toBe(1);
      expect(messages.searchMessages("复活")[0]?.text).toContain("ChatterCatcher");
      expect(handled).toHaveLength(1);
    } finally {
      database.close();
    }
  });

  it("没有配置机器人 open_id 时 @ 任何人都仍然入库且不回答", async () => {
    const config = createDefaultConfig();
    config.storage.dataDir = testDir;
    config.feishu.appId = "cli_app_id";
    config.feishu.requireMention = true;
    const secrets = createDefaultSecrets();
    secrets.feishu.appSecret = "app_secret";
    const database = openDatabase(config);
    const handled: unknown[] = [];

    try {
      const runtime = createFeishuGateway({
        config,
        secrets,
        ingestor: new GatewayIngestor(database),
        questionHandler: {
          async handle(payload: unknown) {
            handled.push(payload);
            return { shouldAnswer: false, reason: "群聊配置为必须 @ 机器人后回答。" };
          },
        } as never,
        wsClientFactory: () => ({
          async start(params: { eventDispatcher: lark.EventDispatcher }) {
            const handler = params.eventDispatcher.handles.get("im.message.receive_v1");
            await handler?.({
              sender: { sender_id: { open_id: "ou_user" } },
              message: {
                message_id: "om_mention_without_bot_id",
                chat_id: "oc_family",
                create_time: "1777111200000",
                message_type: "text",
                content: JSON.stringify({ text: "@_user_1 test" }),
                mentions: [{ name: "川哥", key: "@_user_1", id: { open_id: "ou_chuan" } }],
              },
            });
          },
          close() {},
        }),
      });

      await runtime.start();

      const messages = new MessageRepository(database);
      expect(messages.getMessageCount()).toBe(1);
      expect(messages.searchMessages("test")[0]?.text).toContain("test");
      expect(handled).toHaveLength(1);
    } finally {
      database.close();
    }
  });

  it("@ 其他人时仍然入库且不回答", async () => {
    const config = createDefaultConfig();
    config.storage.dataDir = testDir;
    config.feishu.appId = "cli_app_id";
    config.feishu.requireMention = true;
    config.feishu.botOpenId = "ou_bot";
    const secrets = createDefaultSecrets();
    secrets.feishu.appSecret = "app_secret";
    const database = openDatabase(config);
    const handled: unknown[] = [];

    try {
      const runtime = createFeishuGateway({
        config,
        secrets,
        ingestor: new GatewayIngestor(database),
        questionHandler: {
          async handle(payload: unknown) {
            handled.push(payload);
            return { shouldAnswer: false, reason: "群聊配置为必须 @ 机器人后回答。" };
          },
        } as never,
        wsClientFactory: () => ({
          async start(params: { eventDispatcher: lark.EventDispatcher }) {
            const handler = params.eventDispatcher.handles.get("im.message.receive_v1");
            await handler?.({
              sender: { sender_id: { open_id: "ou_user" } },
              message: {
                message_id: "om_mention_other",
                chat_id: "oc_family",
                create_time: "1777111200000",
                message_type: "text",
                content: JSON.stringify({ text: "@_user_1 test" }),
                mentions: [{ name: "川哥", key: "@_user_1", id: { open_id: "ou_chuan" } }],
              },
            });
          },
          close() {},
        }),
      });

      await runtime.start();

      const messages = new MessageRepository(database);
      expect(messages.getMessageCount()).toBe(1);
      expect(messages.searchMessages("test")[0]?.text).toContain("test");
      expect(handled).toHaveLength(1);
    } finally {
      database.close();
    }
  });

  it("@ 机器人提问会直接回答，不写入消息库", async () => {
    const config = createDefaultConfig();
    config.storage.dataDir = testDir;
    config.feishu.appId = "cli_app_id";
    config.feishu.requireMention = true;
    config.feishu.botOpenId = "ou_bot";
    const secrets = createDefaultSecrets();
    secrets.feishu.appSecret = "app_secret";
    const database = openDatabase(config);
    const handled: unknown[] = [];

    try {
      const runtime = createFeishuGateway({
        config,
        secrets,
        ingestor: new GatewayIngestor(database),
        questionHandler: {
          async handle(payload: unknown) {
            handled.push(payload);
            return { shouldAnswer: true, question: "端午活动什么时候", chatId: "oc_family" };
          },
        } as never,
        wsClientFactory: () => ({
          async start(params: { eventDispatcher: lark.EventDispatcher }) {
            const handler = params.eventDispatcher.handles.get("im.message.receive_v1");
            await handler?.({
              sender: { sender_id: { open_id: "ou_user" } },
              message: {
                message_id: "om_question",
                chat_id: "oc_family",
                create_time: "1777111200000",
                message_type: "text",
                content: JSON.stringify({ text: "@_user_1 端午活动什么时候？" }),
                mentions: [{ name: "小陈", key: "@_user_1", id: { open_id: "ou_bot" } }],
              },
            });
          },
          close() {},
        }),
      });

      await runtime.start();

      expect(handled).toHaveLength(1);
      expect(new MessageRepository(database).getMessageCount()).toBe(0);
    } finally {
      database.close();
    }
  });
});
