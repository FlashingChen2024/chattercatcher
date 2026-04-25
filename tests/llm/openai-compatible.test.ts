import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenAICompatibleChatModel } from "../../src/llm/openai-compatible.js";

describe("OpenAICompatibleChatModel", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("调用 OpenAI-compatible chat completions", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "回答" } }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const model = new OpenAICompatibleChatModel({
      baseUrl: "https://example.test/v1/",
      apiKey: "test-key",
      model: "test-model",
    });

    const result = await model.complete([{ role: "user", content: "你好" }]);

    expect(result).toBe("回答");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.test/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: "Bearer test-key",
        }),
      }),
    );
  });

  it("配置不完整时失败", async () => {
    const model = new OpenAICompatibleChatModel({
      baseUrl: "",
      apiKey: "",
      model: "",
    });

    await expect(model.complete([{ role: "user", content: "你好" }])).rejects.toThrow("LLM 配置不完整");
  });
});

