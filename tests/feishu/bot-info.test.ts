import { describe, expect, it, vi } from "vitest";
import { createDefaultConfig, createDefaultSecrets } from "../../src/config/schema.js";
import { ensureFeishuBotOpenId, resolveFeishuBotOpenId } from "../../src/feishu/bot-info.js";

function createConfiguredFeishu() {
  const config = createDefaultConfig();
  config.feishu.appId = "cli_app_id";
  const secrets = createDefaultSecrets();
  secrets.feishu.appSecret = "app_secret";
  return { config, secrets };
}

function createBotInfoFetch(openId = "ou_bot") {
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
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

    expect(init?.headers).toMatchObject({ Authorization: "Bearer tenant_token" });
    return new Response(JSON.stringify({ code: 0, bot: { open_id: openId } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
}

describe("resolveFeishuBotOpenId", () => {
  it("使用 App ID 和 App Secret 获取机器人 open_id", async () => {
    const { config, secrets } = createConfiguredFeishu();
    const fetchImpl = createBotInfoFetch();

    await expect(resolveFeishuBotOpenId(config, secrets, { fetch: fetchImpl })).resolves.toBe("ou_bot");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(String(fetchImpl.mock.calls[1]?.[0])).toBe("https://open.feishu.cn/open-apis/bot/v3/info");
  });

  it("Lark 区域使用 Lark OpenAPI 域名", async () => {
    const { config, secrets } = createConfiguredFeishu();
    config.feishu.domain = "lark";
    const fetchImpl = createBotInfoFetch();

    await expect(resolveFeishuBotOpenId(config, secrets, { fetch: fetchImpl })).resolves.toBe("ou_bot");
    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe(
      "https://open.larksuite.com/open-apis/auth/v3/tenant_access_token/internal",
    );
    expect(String(fetchImpl.mock.calls[1]?.[0])).toBe("https://open.larksuite.com/open-apis/bot/v3/info");
  });

  it("飞书接口返回错误码时抛出接口消息", async () => {
    const { config, secrets } = createConfiguredFeishu();

    await expect(
      resolveFeishuBotOpenId(config, secrets, {
        fetch: vi.fn(async () => new Response(JSON.stringify({ code: 999, msg: "invalid app secret" }))),
      }),
    ).rejects.toThrow("invalid app secret");
  });

  it("机器人信息缺少 open_id 时抛出错误", async () => {
    const { config, secrets } = createConfiguredFeishu();

    await expect(
      resolveFeishuBotOpenId(config, secrets, {
        fetch: vi.fn(async (input: string | URL | Request) => {
          const url = String(input);
          if (url.endsWith("/auth/v3/tenant_access_token/internal")) {
            return new Response(JSON.stringify({ code: 0, tenant_access_token: "tenant_token" }));
          }
          return new Response(JSON.stringify({ code: 0, bot: {} }));
        }),
      }),
    ).rejects.toThrow("飞书机器人信息响应缺少 open_id");
  });
});

describe("ensureFeishuBotOpenId", () => {
  it("缺少机器人 open_id 时自动获取并保存", async () => {
    const { config, secrets } = createConfiguredFeishu();
    const saved: string[] = [];

    await ensureFeishuBotOpenId(config, secrets, {
      fetch: createBotInfoFetch(),
      onSave: async () => {
        saved.push(config.feishu.botOpenId);
      },
    });

    expect(config.feishu.botOpenId).toBe("ou_bot");
    expect(saved).toEqual(["ou_bot"]);
  });

  it("已有机器人 open_id 时不请求飞书接口", async () => {
    const { config, secrets } = createConfiguredFeishu();
    config.feishu.botOpenId = "ou_existing";
    const fetchImpl = vi.fn();

    await expect(ensureFeishuBotOpenId(config, secrets, { fetch: fetchImpl })).resolves.toBe("ou_existing");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("保存失败时不保留内存中的 open_id", async () => {
    const { config, secrets } = createConfiguredFeishu();

    await expect(
      ensureFeishuBotOpenId(config, secrets, {
        fetch: createBotInfoFetch(),
        onSave: async () => {
          throw new Error("disk full");
        },
      }),
    ).rejects.toThrow("disk full");
    expect(config.feishu.botOpenId).toBe("");
  });
});
