import type { AppConfig, AppSecrets } from "../config/schema.js";

export interface ResolveFeishuBotOpenIdOptions {
  fetch?: typeof fetch;
}

export interface EnsureFeishuBotOpenIdOptions extends ResolveFeishuBotOpenIdOptions {
  onSave?: () => Promise<void>;
}

function getOpenApiBaseUrl(domain: AppConfig["feishu"]["domain"]): string {
  return domain === "lark" ? "https://open.larksuite.com/open-apis" : "https://open.feishu.cn/open-apis";
}

async function readFeishuJson(response: Response): Promise<unknown> {
  if (!response.ok) {
    throw new Error(`飞书接口请求失败：HTTP ${response.status}`);
  }

  return response.json();
}

function assertFeishuSuccess(payload: unknown, fallbackMessage: string): asserts payload is Record<string, unknown> {
  if (!payload || typeof payload !== "object") {
    throw new Error(fallbackMessage);
  }

  const code = (payload as { code?: unknown }).code;
  if (code !== 0) {
    const message = (payload as { msg?: unknown }).msg;
    throw new Error(typeof message === "string" ? message : fallbackMessage);
  }
}

export async function resolveFeishuBotOpenId(
  config: AppConfig,
  secrets: AppSecrets,
  options: ResolveFeishuBotOpenIdOptions = {},
): Promise<string> {
  if (!config.feishu.appId || !secrets.feishu.appSecret) {
    throw new Error("飞书 App ID 或 App Secret 未配置。");
  }

  const fetchImpl = options.fetch ?? fetch;
  const baseUrl = getOpenApiBaseUrl(config.feishu.domain);
  const tokenPayload = await readFeishuJson(
    await fetchImpl(`${baseUrl}/auth/v3/tenant_access_token/internal`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        app_id: config.feishu.appId,
        app_secret: secrets.feishu.appSecret,
      }),
    }),
  );
  assertFeishuSuccess(tokenPayload, "获取飞书 tenant_access_token 失败。");

  const tenantAccessToken = tokenPayload.tenant_access_token;
  if (typeof tenantAccessToken !== "string" || !tenantAccessToken) {
    throw new Error("飞书 tenant_access_token 响应缺少 token。");
  }

  const botInfoPayload = await readFeishuJson(
    await fetchImpl(`${baseUrl}/bot/v3/info`, {
      method: "GET",
      headers: { Authorization: `Bearer ${tenantAccessToken}` },
    }),
  );
  assertFeishuSuccess(botInfoPayload, "获取飞书机器人信息失败。");

  const bot = botInfoPayload.bot;
  if (!bot || typeof bot !== "object") {
    throw new Error("飞书机器人信息响应缺少 bot。");
  }

  const openId = (bot as { open_id?: unknown }).open_id;
  if (typeof openId !== "string" || !openId) {
    throw new Error("飞书机器人信息响应缺少 open_id。");
  }

  return openId;
}

export async function ensureFeishuBotOpenId(
  config: AppConfig,
  secrets: AppSecrets,
  options: EnsureFeishuBotOpenIdOptions = {},
): Promise<string> {
  if (config.feishu.botOpenId) {
    return config.feishu.botOpenId;
  }

  const openId = await resolveFeishuBotOpenId(config, secrets, options);
  const previousOpenId = config.feishu.botOpenId;
  config.feishu.botOpenId = openId;
  try {
    await options.onSave?.();
  } catch (error) {
    config.feishu.botOpenId = previousOpenId;
    throw error;
  }
  return openId;
}
