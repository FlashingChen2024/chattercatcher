import fs from "node:fs";
import path from "node:path";
import { getChatterCatcherHome } from "../config/paths.js";
import { getLogsDirectory } from "../logs/reader.js";

export interface GatewayPidRecord {
  pid: number;
  startedAt: string;
  command: string;
  logFile?: string;
  mode?: "gateway" | "web";
}

export interface GatewayRuntimeState {
  pidFile: string;
  record: GatewayPidRecord | null;
  running: boolean;
  stale: boolean;
}

export interface StopGatewayResult {
  stopped: boolean;
  message: string;
}

export function getGatewayPidPath(): string {
  return path.join(getChatterCatcherHome(), "gateway.pid");
}

export function getGatewayLogPath(): string {
  return path.join(getLogsDirectory(), "gateway.log");
}

export function isProcessRunning(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function readGatewayPidRecord(pidFile = getGatewayPidPath()): GatewayPidRecord | null {
  try {
    const raw = fs.readFileSync(pidFile, "utf8");
    const parsed = JSON.parse(raw) as Partial<GatewayPidRecord>;
    if (!Number.isInteger(parsed.pid) || typeof parsed.startedAt !== "string" || typeof parsed.command !== "string") {
      return null;
    }

    const pid = parsed.pid;
    if (pid === undefined) {
      return null;
    }

    return {
      pid,
      startedAt: parsed.startedAt,
      command: parsed.command,
      ...(typeof parsed.logFile === "string" ? { logFile: parsed.logFile } : {}),
      ...(parsed.mode === "gateway" || parsed.mode === "web" ? { mode: parsed.mode } : {}),
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }

    return null;
  }
}

export function writeGatewayPidRecord(pidFile = getGatewayPidPath(), record: GatewayPidRecord = {
  pid: process.pid,
  startedAt: new Date().toISOString(),
  command: process.argv.join(" "),
}): void {
  fs.mkdirSync(path.dirname(pidFile), { recursive: true });
  fs.writeFileSync(pidFile, `${JSON.stringify(record, null, 2)}\n`, "utf8");
}

export function removeGatewayPidRecord(pidFile = getGatewayPidPath()): void {
  try {
    fs.rmSync(pidFile, { force: true });
  } catch {
    // Best-effort cleanup only.
  }
}

export function getGatewayRuntimeState(pidFile = getGatewayPidPath()): GatewayRuntimeState {
  const record = readGatewayPidRecord(pidFile);
  const running = record ? isProcessRunning(record.pid) : false;
  return {
    pidFile,
    record,
    running,
    stale: Boolean(record && !running),
  };
}

export function stopGatewayProcess(pidFile = getGatewayPidPath()): StopGatewayResult {
  const state = getGatewayRuntimeState(pidFile);
  if (!state.record) {
    return {
      stopped: false,
      message: "Gateway 没有运行记录。",
    };
  }

  if (state.stale) {
    removeGatewayPidRecord(pidFile);
    return {
      stopped: false,
      message: `Gateway PID 文件已过期，已清理：${state.record.pid}`,
    };
  }

  if (state.record.pid === process.pid) {
    return {
      stopped: false,
      message: "拒绝停止当前 CLI 进程；请在另一个终端运行 stop，或按 Ctrl+C。",
    };
  }

  try {
    process.kill(state.record.pid, "SIGTERM");
    removeGatewayPidRecord(pidFile);
    return {
      stopped: true,
      message: `已向 Gateway 进程发送停止信号：pid=${state.record.pid}`,
    };
  } catch (error) {
    return {
      stopped: false,
      message: `停止 Gateway 失败：${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
