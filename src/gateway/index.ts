import type { AppConfig } from "../config/schema.js";
import type { AppSecrets } from "../config/schema.js";
import { getGatewayRuntimeState } from "./runtime.js";

export interface GatewayStatus {
  configured: boolean;
  connection: "not_configured" | "ready_for_start" | "running";
  message: string;
  pid?: number;
  pidFile?: string;
}

export function getGatewayStatus(config: AppConfig, secrets?: AppSecrets): GatewayStatus {
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

  const runtime = getGatewayRuntimeState();
  if (runtime.running && runtime.record) {
    return {
      configured: true,
      connection: "running",
      message: `飞书 Gateway 正在运行：pid=${runtime.record.pid}，startedAt=${runtime.record.startedAt}`,
      pid: runtime.record.pid,
      pidFile: runtime.pidFile,
    };
  }

  if (runtime.stale && runtime.record) {
    return {
      configured: true,
      connection: "ready_for_start",
      message: `飞书长连接配置已就绪；发现过期 PID 文件：pid=${runtime.record.pid}。运行 chattercatcher gateway start 会覆盖运行记录。`,
      pid: runtime.record.pid,
      pidFile: runtime.pidFile,
    };
  }

  return {
    configured: true,
    connection: "ready_for_start",
    message: "飞书长连接配置已就绪。运行 chattercatcher gateway start 后会接收 im.message.receive_v1 事件。",
    pidFile: runtime.pidFile,
  };
}
