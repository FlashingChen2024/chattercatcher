import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDefaultConfig, createDefaultSecrets } from "../../src/config/schema.js";
import { getConfigPath, getSecretsPath } from "../../src/config/paths.js";

describe("CLI SQLite vector runtime", () => {
  let homeDir: string;

  beforeEach(async () => {
    homeDir = await fs.mkdtemp(path.join(os.tmpdir(), "chattercatcher-cli-"));
    process.env.CHATTERCATCHER_HOME = homeDir;
  });

  afterEach(async () => {
    delete process.env.CHATTERCATCHER_HOME;
    await fs.rm(homeDir, { recursive: true, force: true });
  });

  it("index status 输出 SQLite embedding 状态且不触达旧向量后端实现", async () => {
    const config = createDefaultConfig();
    config.storage.dataDir = homeDir;
    await fs.mkdir(path.dirname(getConfigPath()), { recursive: true });
    await fs.writeFile(getConfigPath(), `${JSON.stringify(config, null, 2)}\n`, "utf8");
    await fs.writeFile(getSecretsPath(), `${JSON.stringify(createDefaultSecrets(), null, 2)}\n`, "utf8");

    const result = await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
      const child = spawn(process.execPath, ["--import", "tsx", "./src/cli.ts", "index", "status"], {
        cwd: path.resolve(__dirname, "../.."),
        env: { ...process.env, CHATTERCATCHER_HOME: homeDir },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
      child.on("error", reject);
      child.on("close", (code) => {
        resolve({ code, stdout, stderr });
      });
    });

    expect(result.code).toBe(0);
    expect(result.stderr).toBe("");
    const output = JSON.parse(result.stdout) as {
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
    expect(result.stdout).not.toContain("旧向量后端");
  });
});
