import { describe, expect, it } from "vitest";
import { applySecretInput, resolveEmbeddingApiKey } from "../../src/config/update.js";

describe("config update helpers", () => {
  it("密钥输入为空时保留旧值", () => {
    expect(applySecretInput("old-secret", "")).toBe("old-secret");
    expect(applySecretInput("old-secret", "   ")).toBe("old-secret");
    expect(applySecretInput("old-secret", undefined)).toBe("old-secret");
  });

  it("密钥输入非空时使用新值并裁剪空白", () => {
    expect(applySecretInput("old-secret", " new-secret ")).toBe("new-secret");
  });

  it("embedding key 未显式配置时复用 LLM key", () => {
    expect(
      resolveEmbeddingApiKey({
        currentEmbeddingKey: "",
        nextEmbeddingKey: "",
        llmApiKey: "llm-key",
      }),
    ).toBe("llm-key");
  });
});

