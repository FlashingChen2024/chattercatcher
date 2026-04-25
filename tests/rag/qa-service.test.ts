import { describe, expect, it } from "vitest";
import { askWithRag } from "../../src/rag/qa-service.js";
import type { ChatModel, EvidenceBlock } from "../../src/rag/types.js";
import type { Retriever } from "../../src/rag/retriever.js";

describe("askWithRag", () => {
  it("没有证据时不调用模型并明确说不知道", async () => {
    let modelCalled = false;
    const retriever: Retriever = {
      async retrieve() {
        return [];
      },
    };
    const model: ChatModel = {
      async complete() {
        modelCalled = true;
        return "不应该调用";
      },
    };

    const result = await askWithRag({
      question: "端午活动什么时候？",
      retriever,
      model,
    });

    expect(result.answer).toContain("不知道");
    expect(result.citations).toHaveLength(0);
    expect(modelCalled).toBe(false);
  });

  it("有证据时通过 RAG prompt 调用模型", async () => {
    const evidence: EvidenceBlock[] = [
      {
        id: "chunk-1",
        text: "端午活动改到 2026/6/30，以这个为准。",
        score: 0.9,
        source: {
          type: "message",
          label: "家庭群",
          sender: "老妈",
          timestamp: "2026-04-25T08:00:00.000Z",
        },
      },
    ];
    const retriever: Retriever = {
      async retrieve() {
        return evidence;
      },
    };
    const model: ChatModel = {
      async complete(messages) {
        expect(messages[1]?.content).toContain("检索证据");
        expect(messages[1]?.content).toContain("[S1]");
        return "端午活动目前是 2026/6/30。[S1]";
      },
    };

    const result = await askWithRag({
      question: "端午活动什么时候？",
      retriever,
      model,
    });

    expect(result.answer).toBe("端午活动目前是 2026/6/30。[S1]");
    expect(result.citations).toHaveLength(1);
  });
});

