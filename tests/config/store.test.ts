import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ensureConfigFiles, loadConfig, loadSecrets, maskSecret, resetConfigFiles } from "../../src/config/store.js";

let testHome: string;

describe("config store", () => {
  beforeEach(async () => {
    testHome = await fs.mkdtemp(path.join(os.tmpdir(), "chattercatcher-test-"));
    process.env.CHATTERCATCHER_HOME = testHome;
  });

  afterEach(async () => {
    delete process.env.CHATTERCATCHER_HOME;
    await fs.rm(testHome, { recursive: true, force: true });
  });

  it("创建默认配置和密钥文件", async () => {
    await ensureConfigFiles();

    const config = await loadConfig();
    const secrets = await loadSecrets();

    expect(config.web.host).toBe("127.0.0.1");
    expect(config.web.port).toBe(3878);
    expect(secrets.llm.apiKey).toBe("");
  });

  it("可以重置配置", async () => {
    await ensureConfigFiles();
    await resetConfigFiles();

    const config = await loadConfig();

    expect(config.feishu.requireMention).toBe(true);
  });

  it("打印密钥时会脱敏", () => {
    expect(maskSecret("")).toBe("");
    expect(maskSecret("short")).toBe("********");
    expect(maskSecret("sk-1234567890")).toBe("sk-1...7890");
  });
});
