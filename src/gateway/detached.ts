import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { AppConfig, AppSecrets } from "../config/schema.js";
import { getGatewayStatus } from "./index.js";
import { getGatewayLogPath } from "./runtime.js";

const START_FAILURE_GRACE_MS = 250;

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

function describeImmediateChildFailure(event: { type: "error"; error: Error } | { type: "exit"; code: number | null; signal: NodeJS.Signals | null }): string {
  if (event.type === "error") {
    return event.error.message;
  }

  return event.signal ? `signal=${event.signal}` : `exitCode=${event.code ?? "unknown"}`;
}

function waitForImmediateChildFailure(
  child: ChildProcess,
  graceMs = START_FAILURE_GRACE_MS,
): Promise<{ type: "error"; error: Error } | { type: "exit"; code: number | null; signal: NodeJS.Signals | null } | null> {
  return new Promise((resolve) => {
    let settled = false;
    let timer: NodeJS.Timeout;

    const cleanup = () => {
      clearTimeout(timer);
      child.off("error", onError);
      child.off("exit", onExit);
    };
    const settle = (result: { type: "error"; error: Error } | { type: "exit"; code: number | null; signal: NodeJS.Signals | null } | null) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve(result);
    };
    const onError = (error: Error) => settle({ type: "error", error });
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => settle({ type: "exit", code, signal });

    child.once("error", onError);
    child.once("exit", onExit);
    timer = setTimeout(() => settle(null), graceMs);
  });
}

export async function startDetachedGateway(input: DetachedGatewayStartInput): Promise<DetachedGatewayStartResult> {
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

    const immediateFailure = await waitForImmediateChildFailure(child);
    closeStdio();

    if (immediateFailure) {
      return {
        started: false,
        message: `飞书 Gateway 启动失败：${describeImmediateChildFailure(immediateFailure)}。请查看日志：${logFile}`,
        pid: child.pid,
        logFile,
      };
    }

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
