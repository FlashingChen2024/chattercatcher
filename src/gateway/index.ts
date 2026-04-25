import type { AppConfig } from "../config/schema.js";

export interface GatewayStatus {
  configured: boolean;
  connection: "not_configured" | "ready_for_start" | "running_placeholder";
  message: string;
}

export function getGatewayStatus(config: AppConfig): GatewayStatus {
  if (!config.feishu.appId) {
    return {
      configured: false,
      connection: "not_configured",
      message: "尚未配置飞书 App ID。请运行 chattercatcher setup 或 chattercatcher settings。",
    };
  }

  return {
    configured: true,
    connection: "ready_for_start",
    message: "飞书基础配置已存在。真实长连接将在飞书集成实现后启用。",
  };
}
