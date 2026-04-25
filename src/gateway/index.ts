import type { AppConfig } from "../config/schema.js";
import type { AppSecrets } from "../config/schema.js";

export interface GatewayStatus {
  configured: boolean;
  connection: "not_configured" | "ready_for_start" | "running";
  message: string;
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

  return {
    configured: true,
    connection: "ready_for_start",
    message: "飞书长连接配置已就绪。运行 chattercatcher gateway start 后会接收 im.message.receive_v1 事件。",
  };
}
