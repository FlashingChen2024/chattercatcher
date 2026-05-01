import { describe, expect, it, vi } from "vitest";
import { createDefaultConfig, createDefaultSecrets } from "../../src/config/schema.js";
import { ensureFeishuBotOpenId, resolveFeishuBotOpenId } from "../../src/feishu/bot-info.js";

describe("resolveFeishuBotOpenId", () => {
  it("使用 App ID 和 App Secret 获取机器人 open_id", async () => {
    const config = createDefaultConfig();
    config.feishu.appId = "cli_app_id";
    const secrets = createDefaultSecrets();
    secrets.feishu.appSecret = "app_secret";
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);

      if (url.endsWith("/auth/v3/tenant_access_token/internal")) {
        expect(init?.method).toBe("POST");
        expect(JSON.parse(String(init?.body))).toEqual({
          app_id: "cli_app_id",
          app_secret: "app_secret",
        });
        return new Response(JSON.stringify({ code: 0, tenant_access_token: "tenant_token" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      expect(url).toBe("https://open.feishu.cn/open-apis/bot/v3/info");
      expect(init?.headers).toMatchObject({ Authorization: "Bearer tenant_token" });
      return new Response(JSON.stringify({ code: 0, bot: { open_id: "ou_bot" } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    await expect(resolveFeishuBotOpenId(config, secrets, { fetch: fetchImpl })).resolves.toBe("ou_bot");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("缺少机器人 open_id 时自动获取并保存", async () => {
    const config = createDefaultConfig();
    config.feishu.appId = "cli_app_id";
    const secrets = createDefaultSecrets();
    secrets.feishu.appSecret = "app_secret";
    const saved: string[] = [];

    await ensureFeishuBotOpenId(config, secrets, {
      fetch: vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.endsWith("/auth/v3/tenant_access_token/internal")) {
          return new Response(JSON.stringify({ code: 0, tenant_access_token: "tenant_token" }));
        }
        return new Response(JSON.stringify({ code: 0, bot: { open_id: "ou_bot" } }));
      }),
      onSave: async () => {
        saved.push(config.feishu.botOpenId);
      },
    });

    expect(config.feishu.botOpenId).toBe("ou_bot");
    expect(saved).toEqual(["ou_bot"]);
  });
});
