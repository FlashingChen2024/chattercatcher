import { describe, expect, it } from "vitest";
import { sanitizeEpisodeSummary } from "../../src/episodes/sanitizer.js";

describe("sanitizeEpisodeSummary", () => {
  it("保留上下文但不把疑似密钥原文写入会话记忆", () => {
    const sanitized = sanitizeEpisodeSummary(
      "用户先说明要发送一个 API key，随后发送 sk-live-abc123，因此 sk-live-abc123 是该 API key。",
    );

    expect(sanitized).toContain("API key");
    expect(sanitized).not.toContain("sk-live-abc123");
    expect(sanitized).toContain("[REDACTED_SECRET]");
  });

  it("脱敏常见凭据格式", () => {
    const summary = [
      "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.signature",
      "GitHub token 是 ghp_abcdefghijklmnopqrstuvwxyz0123456789ABCD",
      `Slack webhook secret 是 ${"xox"}b-123456789012-123456789012-abcdefghijklmnopqrstuvwx`,
      "链接是 https://user:pass@example.com/callback?api_key=abc123XYZ789&token=tok_abc123456789",
      '配置包含 {"client_secret":"very-secret-value","private_key":"-----BEGIN PRIVATE KEY-----\\nabc123\\n-----END PRIVATE KEY-----"}',
      "Cookie: sessionid=sess_abcdef1234567890; refresh_token=refresh-abcdef1234567890",
    ].join("\n");

    const sanitized = sanitizeEpisodeSummary(summary);

    expect(sanitized).toContain("Authorization: Bearer [REDACTED_SECRET]");
    expect(sanitized).toContain("GitHub token 是 [REDACTED_SECRET]");
    expect(sanitized).toContain("Slack webhook secret 是 [REDACTED_SECRET]");
    expect(sanitized).toContain("https://[REDACTED_SECRET]@example.com/callback");
    expect(sanitized).toContain("api_key=[REDACTED_SECRET]");
    expect(sanitized).toContain("token=[REDACTED_SECRET]");
    expect(sanitized).toContain('"client_secret":"[REDACTED_SECRET]"');
    expect(sanitized).toContain('"private_key":"[REDACTED_SECRET]"');
    expect(sanitized).toContain("sessionid=[REDACTED_SECRET]");
    expect(sanitized).toContain("refresh_token=[REDACTED_SECRET]");
    expect(sanitized).not.toContain("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9");
    expect(sanitized).not.toContain("ghp_abcdefghijklmnopqrstuvwxyz0123456789ABCD");
    expect(sanitized).not.toContain(`${"xox"}b-123456789012`);
    expect(sanitized).not.toContain("abc123XYZ789");
    expect(sanitized).not.toContain("very-secret-value");
    expect(sanitized).not.toContain("sess_abcdef1234567890");
  });

  it("保留可检索的普通长标识符", () => {
    const summary = "相关提交是 1234567890abcdef1234567890abcdef12345678，文档 ID 是 doc_abcdefghijklmnopqrstuvwxyz。";

    expect(sanitizeEpisodeSummary(summary)).toBe(summary);
  });
});
