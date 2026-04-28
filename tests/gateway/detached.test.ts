import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultConfig, createDefaultSecrets } from "../../src/config/schema.js";

const spawnMock = vi.fn();

vi.mock("node:child_process", () => ({
  spawn: spawnMock,
}));

describe("gateway detached launcher", () => {
  let testHome: string;

  beforeEach(async () => {
    spawnMock.mockReset();
    testHome = await fsp.mkdtemp(path.join(os.tmpdir(), "chattercatcher-gateway-detached-"));
    process.env.CHATTERCATCHER_HOME = testHome;
  });

  afterEach(async () => {
    delete process.env.CHATTERCATCHER_HOME;
    await fsp.rm(testHome, { recursive: true, force: true });
  });

  it("buildGatewayForegroundSpawnCommand 生成 dist CLI 前台 gateway 启动命令", async () => {
    const { buildGatewayForegroundSpawnCommand } = await import("../../src/gateway/detached.js");

    expect(buildGatewayForegroundSpawnCommand(["/usr/local/bin/node", "/repo/dist/cli.js"])).toEqual({
      command: "/usr/local/bin/node",
      args: ["/repo/dist/cli.js", "gateway", "start", "--foreground"],
    });
  });

  it("buildGatewayForegroundSpawnCommand 保留 tsx 链路并追加前台 gateway 命令", async () => {
    const { buildGatewayForegroundSpawnCommand } = await import("../../src/gateway/detached.js");

    expect(
      buildGatewayForegroundSpawnCommand([
        "/usr/local/bin/node",
        "/repo/node_modules/.bin/tsx",
        "src/cli.ts",
        "gateway",
        "start",
      ]),
    ).toEqual({
      command: "/usr/local/bin/node",
      args: ["/repo/node_modules/.bin/tsx", "src/cli.ts", "gateway", "start", "--foreground"],
    });
  });

  it("buildGatewayForegroundSpawnCommand 移除已有前台标记后重建 gateway 启动命令", async () => {
    const { buildGatewayForegroundSpawnCommand } = await import("../../src/gateway/detached.js");

    expect(
      buildGatewayForegroundSpawnCommand([
        "/usr/local/bin/node",
        "/repo/node_modules/.bin/tsx",
        "src/cli.ts",
        "gateway",
        "start",
        "--foreground",
      ]),
    ).toEqual({
      command: "/usr/local/bin/node",
      args: ["/repo/node_modules/.bin/tsx", "src/cli.ts", "gateway", "start", "--foreground"],
    });
  });

  it("startDetachedGateway 在已配置时创建日志目录并启动 detached 子进程", async () => {
    const { startDetachedGateway } = await import("../../src/gateway/detached.js");
    const config = createDefaultConfig();
    const secrets = createDefaultSecrets();
    config.feishu.appId = "cli_app";
    secrets.feishu.appSecret = "secret";

    spawnMock.mockReturnValue({
      pid: 12345,
      unref: vi.fn(),
    });

    const argv = [process.argv[0], "/repo/node_modules/.bin/tsx", "src/cli.ts", "gateway", "start"];
    const result = startDetachedGateway({ config, secrets, argv });
    const logFile = path.join(testHome, "logs", "gateway.log");

    expect(result.started).toBe(true);
    expect(result.pid).toBe(12345);
    expect(result.logFile).toBe(logFile);
    expect(fs.existsSync(path.dirname(logFile))).toBe(true);
    expect(spawnMock).toHaveBeenCalledTimes(1);

    const [command, args, options] = spawnMock.mock.calls[0] as [string, string[], Record<string, unknown>];
    expect(command).toBe(process.argv[0]);
    expect(args).toEqual(["/repo/node_modules/.bin/tsx", "src/cli.ts", "gateway", "start", "--foreground"]);
    expect(options).toMatchObject({
      detached: true,
      stdio: ["ignore", expect.any(Number), expect.any(Number)],
      windowsHide: true,
    });
  });

  it("startDetachedGateway 在已有运行中的 Web UI 记录时阻止重复启动", async () => {
    const { startDetachedGateway } = await import("../../src/gateway/detached.js");
    const config = createDefaultConfig();
    const secrets = createDefaultSecrets();
    secrets.feishu.appSecret = "secret";

    const pidFile = path.join(testHome, "gateway.pid");
    fs.mkdirSync(path.dirname(pidFile), { recursive: true });
    fs.writeFileSync(
      pidFile,
      `${JSON.stringify(
        {
          pid: process.pid,
          startedAt: "2026-04-28T00:00:00.000Z",
          command: "chattercatcher gateway start --foreground",
          mode: "web",
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const result = startDetachedGateway({ config, secrets });

    expect(result.started).toBe(false);
    expect(result.message).toContain("正在运行");
    expect(spawnMock).not.toHaveBeenCalled();
  });
});
