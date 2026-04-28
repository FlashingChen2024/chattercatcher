import type { AppConfig } from "../config/schema.js";
import type { AppSecrets } from "../config/schema.js";
import { getGatewayRuntimeState } from "./runtime.js";

export interface GatewayStatus {
  configured: boolean;
  connection: "not_configured" | "ready_for_start" | "running";
  message: string;
  pid?: number;
  pidFile?: string;
  logFile?: string;
}

export function getGatewayStatus(config: AppConfig, secrets?: AppSecrets): GatewayStatus {
  const runtime = getGatewayRuntimeState();
  const configured = Boolean(config.feishu.appId && (!secrets || secrets.feishu.appSecret));

  if (runtime.running && runtime.record) {
    if (runtime.record.mode === "web" && !configured) {
      return {
        configured,
        connection: "running",
        message: `本地 Web UI 进程正在运行：pid=${runtime.record.pid}，startedAt=${runtime.record.startedAt}；飞书配置尚未完成。`,
        pid: runtime.record.pid,
        pidFile: runtime.pidFile,
        logFile: runtime.record.logFile,
      };
    }

    return {
      configured: true,
      connection: "running",
      message: `飞书 Gateway 正在运行：pid=${runtime.record.pid}，startedAt=${runtime.record.startedAt}`,
      pid: runtime.record.pid,
      pidFile: runtime.pidFile,
      logFile: runtime.record.logFile,
    };
  }

  if (!config.feishu.appId) {
    return {
      configured: false,
      connection: "not_configured",
      message: "尚未配置飞书 App ID。请运行 chattercatcher setup 或 chattercatcher settings。",
    };
  }

  if (secrets && !secrets.feishu.appSecret) {
    return {
      configured: false,
      connection: "not_configured",
      message: "尚未配置飞书 App Secret。请运行 chattercatcher setup 或 chattercatcher settings。",
    };
  }

  if (runtime.stale && runtime.record) {
    return {
      configured: true,
      connection: "ready_for_start",
      message: `飞书长连接配置已就绪；发现过期 PID 文件：pid=${runtime.record.pid}。运行 chattercatcher gateway start 会覆盖运行记录。`,
      pid: runtime.record.pid,
      pidFile: runtime.pidFile,
      logFile: runtime.record.logFile,
    };
  }

  return {
    configured: true,
    connection: "ready_for_start",
    message: "飞书长连接配置已就绪。运行 chattercatcher gateway start 后会接收 im.message.receive_v1 事件。",
    pidFile: runtime.pidFile,
  };
}
