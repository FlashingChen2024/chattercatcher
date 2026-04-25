import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultConfig, createDefaultSecrets } from "../../src/config/schema.js";
import { openDatabase } from "../../src/db/database.js";
import { formatDoctorChecks, runDoctor } from "../../src/doctor/checks.js";
import { FileJobRepository } from "../../src/files/jobs.js";

let testHome: string;

describe("doctor checks", () => {
  beforeEach(async () => {
    testHome = await fs.mkdtemp(path.join(os.tmpdir(), "chattercatcher-doctor-"));
    process.env.CHATTERCATCHER_HOME = testHome;
  });

  afterEach(async () => {
    delete process.env.CHATTERCATCHER_HOME;
    vi.restoreAllMocks();
    await fs.rm(testHome, { recursive: true, force: true });
  });

  it("离线检查本地配置、SQLite、文件解析、LanceDB 和 RAG 策略", async () => {
    const config = createDefaultConfig();
    const secrets = createDefaultSecrets();
    const checks = await runDoctor(config, secrets);

    expect(checks.map((check) => check.name)).toContain("SQLite");
    expect(checks.map((check) => check.name)).toContain("文件解析");
    expect(checks.map((check) => check.name)).toContain("LanceDB");
    expect(checks.find((check) => check.name === "RAG 策略")).toMatchObject({
      status: "pass",
    });
    expect(checks.find((check) => check.name === "飞书 Gateway")).toMatchObject({
      status: "warn",
    });
  });

  it("文件解析存在失败任务时给出警告", async () => {
    const config = createDefaultConfig();
    const database = openDatabase(config);
    try {
      const jobs = new FileJobRepository(database);
      const id = jobs.start({ sourcePath: path.join(testHome, "bad.exe") });
      jobs.fail({ id, error: "暂不支持该文件类型" });
    } finally {
      database.close();
    }

    const checks = await runDoctor(config, createDefaultSecrets());

    expect(checks.find((check) => check.name === "文件解析")).toMatchObject({
      status: "warn",
    });
  });

  it("在线检查会调用 chat 和 embedding 接口", async () => {
    const config = createDefaultConfig();
    config.llm.baseUrl = "https://example.test/v1";
    config.llm.model = "chat-model";
    config.embedding.model = "embedding-model";
    const secrets = createDefaultSecrets();
    secrets.llm.apiKey = "llm-key";
    secrets.embedding.apiKey = "embedding-key";

    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const value = String(url);
      if (value.endsWith("/chat/completions")) {
        return new Response(JSON.stringify({ choices: [{ message: { content: "OK" } }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ data: [{ embedding: [0.1, 0.2] }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    const checks = await runDoctor(config, secrets, { online: true });

    expect(checks.find((check) => check.name === "LLM 连通性")).toMatchObject({
      status: "pass",
      message: "OK",
    });
    expect(checks.find((check) => check.name === "Embedding 连通性")).toMatchObject({
      status: "pass",
      message: "dimension=2",
    });
  });

  it("格式化检查结果", () => {
    expect(
      formatDoctorChecks([
        { name: "SQLite", status: "pass", message: "ok" },
        { name: "LLM", status: "warn", message: "missing" },
        { name: "LanceDB", status: "fail", message: "broken" },
      ]),
    ).toBe("[PASS] SQLite: ok\n[WARN] LLM: missing\n[FAIL] LanceDB: broken");
  });
});
