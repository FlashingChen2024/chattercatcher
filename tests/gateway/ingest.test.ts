import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDefaultConfig } from "../../src/config/schema.js";
import { openDatabase } from "../../src/db/database.js";
import { GatewayIngestor } from "../../src/gateway/ingest.js";
import { MessageRepository } from "../../src/messages/repository.js";
import { MessageFtsRetriever } from "../../src/rag/message-retriever.js";

let testDir: string;

describe("GatewayIngestor", () => {
  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), "chattercatcher-gateway-"));
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it("把飞书事件写入消息库并可作为 RAG 证据检索", async () => {
    const config = createDefaultConfig();
    config.storage.dataDir = testDir;
    const database = openDatabase(config);

    try {
      const result = new GatewayIngestor(database).ingestFeishuEvent({
        event: {
          sender: { sender_id: { open_id: "ou_mom" } },
          message: {
            message_id: "om_1",
            chat_id: "oc_family",
            create_time: "1777111200000",
            message_type: "text",
            content: JSON.stringify({ text: "端午活动改到 2026/6/30，以这个为准。" }),
          },
        },
      });

      const messages = new MessageRepository(database);
      const retriever = new MessageFtsRetriever(messages);
      const evidence = await retriever.retrieve("端午活动什么时候");

      expect(result.accepted).toBe(true);
      expect(messages.getMessageCount()).toBe(1);
      expect(evidence[0]?.text).toContain("2026/6/30");
      expect(evidence[0]?.source).toMatchObject({
        type: "message",
        label: "oc_family",
        sender: "ou_mom",
      });
    } finally {
      database.close();
    }
  });
});

