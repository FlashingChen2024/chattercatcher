import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultConfig, createDefaultSecrets } from "../../src/config/schema.js";
import { getConfigPath, getSecretsPath } from "../../src/config/paths.js";

describe("CLI LanceDB runtime removal", () => {
  let homeDir: string;

  beforeEach(async () => {
    homeDir = await fs.mkdtemp(path.join(os.tmpdir(), "chattercatcher-cli-"));
    process.env.CHATTER_CATCHER_HOME = homeDir;
  });

  afterEach(async () => {
    vi.resetModules();
    vi.unstubAllGlobals();
    delete process.env.CHATTER_CATCHER_HOME;
    await fs.rm(homeDir, { recursive: true, force: true });
  });

  it("index status 输出 SQLite embedding 状态且不触达 LanceDB", async () => {
    const config = createDefaultConfig();
    config.storage.dataDir = homeDir;
    await fs.mkdir(path.dirname(getConfigPath()), { recursive: true });
    await fs.writeFile(getConfigPath(), `${JSON.stringify(config, null, 2)}\n`, "utf8");
    await fs.writeFile(getSecretsPath(), `${JSON.stringify(createDefaultSecrets(), null, 2)}\n`, "utf8");

    const logs: string[] = [];
    const logSpy = vi.spyOn(console, "log").mockImplementation((value?: unknown) => {
      logs.push(String(value ?? ""));
    });
    const argv = process.argv;
    process.argv = ["node", "cli", "index", "status"];

    try {
      await import("../../src/cli.ts");
    } finally {
      process.argv = argv;
      logSpy.mockRestore();
    }

    const output = JSON.parse(logs.join("\n")) as {
      database: string;
      embeddings: { backend: string; configured: boolean; vectors: number; status: string };
      retrieval: { vector: string };
    };

    expect(output.database).toContain(homeDir);
    expect(output.embeddings).toMatchObject({
      backend: "SQLite embedding 向量索引",
      configured: false,
      vectors: 0,
      status: "SQLite embedding 向量索引已接入；需配置 embedding 后启用语义检索",
    });
    expect(output.retrieval.vector).toBe("SQLite embedding 向量索引");
    expect(logs.join("\n")).not.toContain("LanceDB");
  });
});
