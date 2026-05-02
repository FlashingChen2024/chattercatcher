import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenAICompatibleChatModel, OpenAICompatibleEmbeddingModel } from "../../src/llm/openai-compatible.js";

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

  it("调用 OpenAI-compatible embeddings", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [{ embedding: [0.1, 0.2, 0.3] }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const model = new OpenAICompatibleEmbeddingModel({
      baseUrl: "https://example.test/v1",
      apiKey: "test-key",
      model: "embedding-model",
    });

    const result = await model.embed("端午活动");

    expect(result).toEqual([0.1, 0.2, 0.3]);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.test/v1/embeddings",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          model: "embedding-model",
          input: ["端午活动"],
        }),
      }),
    );
  });
});

describe("OpenAICompatibleChatModel tool calls", () => {
  it("sends OpenAI-compatible tool schemas", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: "done" } }] }), { status: 200 }),
    );
    const model = new OpenAICompatibleChatModel({ baseUrl: "https://llm.test/v1/", apiKey: "key", model: "test-model" });

    await model.completeWithTools?.(
      [{ role: "user", content: "查一下发布记录" }],
      [
        {
          name: "hybrid_search",
          description: "Search local knowledge base.",
          inputSchema: {
            type: "object",
            properties: { query: { type: "string" } },
            required: ["query"],
          },
        },
      ],
    );

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.tools).toEqual([
      {
        type: "function",
        function: {
          name: "hybrid_search",
          description: "Search local knowledge base.",
          parameters: {
            type: "object",
            properties: { query: { type: "string" } },
            required: ["query"],
          },
        },
      },
    ]);
    expect(body.tool_choice).toBe("auto");
  });

  it("parses returned tool calls", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: "",
                tool_calls: [
                  {
                    id: "call_1",
                    type: "function",
                    function: {
                      name: "hybrid_search",
                      arguments: JSON.stringify({ query: "0.1.16 发布" }),
                    },
                  },
                ],
              },
            },
          ],
        }),
        { status: 200 },
      ),
    );
    const model = new OpenAICompatibleChatModel({ baseUrl: "https://llm.test/v1", apiKey: "key", model: "test-model" });

    const result = await model.completeWithTools?.([{ role: "user", content: "查一下" }], []);

    expect(result).toEqual({
      content: "",
      toolCalls: [{ id: "call_1", name: "hybrid_search", input: { query: "0.1.16 发布" } }],
    });
  });
});
