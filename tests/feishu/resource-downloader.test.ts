import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FeishuResourceDownloader } from "../../src/feishu/resource-downloader.js";

let testDir: string;

describe("FeishuResourceDownloader", () => {
  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), "chattercatcher-feishu-resource-"));
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it("通过 messageResource.get 下载用户消息里的文件资源", async () => {
    const calls: unknown[] = [];
    const downloader = new FeishuResourceDownloader(
      {
        im: {
          messageResource: {
            async get(payload) {
              calls.push(payload);
              return {
                async writeFile(filePath: string) {
                  await fs.writeFile(filePath, "端午活动改到 2026/6/30。", "utf8");
                },
              };
            },
          },
        },
      },
      testDir,
    );

    const result = await downloader.download({
      messageId: "om_1",
      attachment: {
        platform: "feishu",
        kind: "file",
        fileKey: "file_v2_xxx",
        fileName: "报名表?.md",
      },
    });

    expect(calls).toEqual([
      {
        params: { type: "file" },
        path: { message_id: "om_1", file_key: "file_v2_xxx" },
      },
    ]);
    expect(result.fileName).toBe("om_1-报名表_.md");
    await expect(fs.readFile(result.storedPath, "utf8")).resolves.toContain("2026/6/30");
  });

  it("按附件类型映射资源下载 type", async () => {
    const calls: Array<{ params: { type: string } }> = [];
    const downloader = new FeishuResourceDownloader(
      {
        im: {
          v1: {
            messageResource: {
              async get(payload) {
                calls.push(payload);
                return {
                  async writeFile(filePath: string) {
                    await fs.writeFile(filePath, "binary", "utf8");
                  },
                };
              },
            },
          },
        },
      },
      testDir,
    );

    await downloader.download({
      messageId: "om_2",
      attachment: { platform: "feishu", kind: "image", fileKey: "img_x" },
    });

    expect(calls[0]?.params.type).toBe("image");
  });
});
