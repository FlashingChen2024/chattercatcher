import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDefaultConfig, createDefaultSecrets } from "../../src/config/schema.js";
import { openDatabase } from "../../src/db/database.js";
import { createFeishuEventDispatcher } from "../../src/feishu/gateway.js";
import { FeishuResourceDownloader } from "../../src/feishu/resource-downloader.js";
import { GatewayIngestor } from "../../src/gateway/ingest.js";
import { ImageMultimodalWorker } from "../../src/multimodal/worker.js";
import { MessageRepository } from "../../src/messages/repository.js";
import { ImageMultimodalTaskRepository } from "../../src/multimodal/tasks.js";
import type { MultimodalModel } from "../../src/multimodal/types.js";

let testDir: string;

describe("Feishu gateway image multimodal processing", () => {
  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), "chattercatcher-feishu-gateway-"));
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it("图片消息下载后会运行多模态后台处理", async () => {
    const config = createDefaultConfig();
    config.storage.dataDir = testDir;
    config.multimodal.baseUrl = "https://vision.test/v1";
    config.multimodal.model = "vision";
    const secrets = createDefaultSecrets();
    const database = openDatabase(config);
    const downloader = new FeishuResourceDownloader(
      {
        im: {
          messageResource: {
            async get() {
              return {
                async writeFile(filePath: string) {
                  await fs.writeFile(filePath, Buffer.from([1, 2, 3]));
                },
              };
            },
          },
        },
      },
      testDir,
    );
    const model: MultimodalModel = {
      async describeImage() {
        return { summary: "白板写着 5 月 10 日上线图片多模态。", isMeaningful: true };
      },
    };

    try {
      const result = await new GatewayIngestor(database).ingestFeishuEventAndDownloadAttachments({
        config,
        downloader,
        payload: {
          event: {
            sender: { sender_id: { open_id: "ou_mom" } },
            message: {
              message_id: "om_image",
              chat_id: "oc_family",
              create_time: "1777111200000",
              message_type: "image",
              content: JSON.stringify({ image_key: "img_v2_xxx" }),
            },
          },
        },
      });
      await new ImageMultimodalWorker({
        config,
        messages: new MessageRepository(database),
        tasks: new ImageMultimodalTaskRepository(database),
        model,
        multimodalModelName: "vision",
      }).processPending();

      const messages = new MessageRepository(database);
      expect(new ImageMultimodalTaskRepository(database).listPending()).toHaveLength(0);
      expect(messages.searchMessages("多模态")[0]).toMatchObject({ messageType: "image_summary" });
    } finally {
      database.close();
    }
  });
});
