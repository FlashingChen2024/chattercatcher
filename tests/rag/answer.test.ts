import { describe, expect, it } from "vitest";
import { buildEvidencePrompt, generateGroundedAnswer } from "../../src/rag/answer.js";
import type { ChatModel, EvidenceBlock } from "../../src/rag/types.js";

const evidence: EvidenceBlock[] = [
  {
    id: "msg-1",
    text: "端午活动改到 2026/6/30，以这个为准。",
    score: 0.95,
    source: {
      type: "message",
      label: "家庭群消息",
      sender: "老妈",
      timestamp: "2026-04-25T08:00:00.000Z",
    },
  },
];

describe("RAG answer boundary", () => {
  it("没有检索证据时拒绝生成答案", () => {
    expect(() => buildEvidencePrompt("端午活动什么时候？", [])).toThrow("RAG evidence is required");
  });

  it("只把检索证据放入答案 prompt，并生成引用映射", () => {
    const prompt = buildEvidencePrompt("端午活动什么时候？", evidence);

    expect(prompt.citations).toEqual([
      {
        marker: "S1",
        evidenceId: "msg-1",
        source: evidence[0]?.source,
      },
    ]);
    expect(prompt.messages[1]?.content).toContain("检索证据");
    expect(prompt.messages[1]?.content).toContain("[S1]");
    expect(prompt.messages[1]?.content).toContain("端午活动改到 2026/6/30");
  });

  it("答案生成器返回模型答案和证据引用", async () => {
    const model: ChatModel = {
      async complete(messages) {
        expect(messages.map((message) => message.content).join("\n")).toContain("[S1]");
        return "端午活动目前是 2026/6/30。[S1]";
      },
    };

    const result = await generateGroundedAnswer({
      question: "端午活动什么时候？",
      evidence,
      model,
    });

    expect(result.answer).toBe("端午活动目前是 2026/6/30。[S1]");
    expect(result.citations).toHaveLength(1);
  });
});
