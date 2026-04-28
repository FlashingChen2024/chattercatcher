import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { AppConfig, AppSecrets } from "../config/schema.js";
import { getGatewayStatus } from "./index.js";
import { getGatewayLogPath } from "./runtime.js";

export interface GatewayForegroundSpawnCommand {
  command: string;
  args: string[];
}

export interface DetachedGatewayStartInput {
  config: AppConfig;
  secrets: AppSecrets;
  argv?: string[];
}

export interface DetachedGatewayStartResult {
  started: boolean;
  message: string;
  pid?: number;
  logFile: string;
}

export function buildGatewayForegroundSpawnCommand(argv = process.argv): GatewayForegroundSpawnCommand {
  const [command = process.execPath, ...rawArgs] = argv;
  const args = [...rawArgs];

  while (args.at(-1) === "--foreground") {
    args.pop();
  }

  if (args.at(-1) === "start" && args.at(-2) === "gateway") {
    args.splice(-2, 2);
  }

  return {
    command,
    args: [...args, "gateway", "start", "--foreground"],
  };
}

export function startDetachedGateway(input: DetachedGatewayStartInput): DetachedGatewayStartResult {
  const status = getGatewayStatus(input.config, input.secrets);
  const logFile = getGatewayLogPath();

  if (status.connection === "running") {
    return {
      started: false,
      message: `飞书 Gateway 已经正在运行：pid=${status.pid ?? "unknown"}`,
      logFile,
      ...(status.pid ? { pid: status.pid } : {}),
    };
  }

  fs.mkdirSync(path.dirname(logFile), { recursive: true });

  let out: number | undefined;
  let err: number | undefined;
  let stdioClosed = false;
  const closeStdio = () => {
    if (stdioClosed) {
      return;
    }
    stdioClosed = true;
    if (typeof out === "number") {
      fs.closeSync(out);
    }
    if (typeof err === "number") {
      fs.closeSync(err);
    }
  };

  try {
    out = fs.openSync(logFile, "a");
    err = fs.openSync(logFile, "a");

    const foreground = buildGatewayForegroundSpawnCommand(input.argv);
    const child = spawn(foreground.command, foreground.args, {
      detached: true,
      stdio: ["ignore", out, err],
      windowsHide: true,
    });

    closeStdio();
    child.unref();

    return {
      started: true,
      message: `已在后台启动飞书 Gateway：pid=${child.pid}`,
      pid: child.pid,
      logFile,
    };
  } catch (error) {
    closeStdio();
    throw error;
  }
}
