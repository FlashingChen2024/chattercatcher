import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDefaultConfig, createDefaultSecrets } from "../../src/config/schema.js";
import { getGatewayStatus } from "../../src/gateway/index.js";
import {
  getGatewayRuntimeState,
  readGatewayPidRecord,
  removeGatewayPidRecord,
  stopGatewayProcess,
  writeGatewayPidRecord,
} from "../../src/gateway/runtime.js";

let testHome: string;
let pidFile: string;

describe("gateway runtime", () => {
  beforeEach(async () => {
    testHome = await fsp.mkdtemp(path.join(os.tmpdir(), "chattercatcher-gateway-runtime-"));
    process.env.CHATTERCATCHER_HOME = testHome;
    pidFile = path.join(testHome, "gateway.pid");
  });

  afterEach(async () => {
    delete process.env.CHATTERCATCHER_HOME;
    await fsp.rm(testHome, { recursive: true, force: true });
  });

  it("写入、读取并删除 Gateway PID 文件", () => {
    writeGatewayPidRecord(pidFile, {
      pid: process.pid,
      startedAt: "2026-04-26T00:00:00.000Z",
      command: "chattercatcher gateway start",
    });

    expect(readGatewayPidRecord(pidFile)).toEqual({
      pid: process.pid,
      startedAt: "2026-04-26T00:00:00.000Z",
      command: "chattercatcher gateway start",
    });
    expect(getGatewayRuntimeState(pidFile)).toMatchObject({
      running: true,
      stale: false,
    });

    removeGatewayPidRecord(pidFile);
    expect(readGatewayPidRecord(pidFile)).toBeNull();
  });

  it("清理陈旧 PID 文件", () => {
    writeGatewayPidRecord(pidFile, {
      pid: 999_999_999,
      startedAt: "2026-04-26T00:00:00.000Z",
      command: "chattercatcher gateway start",
    });

    const result = stopGatewayProcess(pidFile);

    expect(result.stopped).toBe(false);
    expect(result.message).toContain("已过期");
    expect(fs.existsSync(pidFile)).toBe(false);
  });

  it("状态能识别运行中的 Gateway PID", () => {
    const config = createDefaultConfig();
    const secrets = createDefaultSecrets();
    config.feishu.appId = "cli_app";
    secrets.feishu.appSecret = "secret";
    writeGatewayPidRecord(pidFile, {
      pid: process.pid,
      startedAt: "2026-04-26T00:00:00.000Z",
      command: "chattercatcher gateway start",
    });

    expect(getGatewayStatus(config, secrets)).toMatchObject({
      configured: true,
      connection: "running",
      pid: process.pid,
      pidFile,
    });
  });
});
