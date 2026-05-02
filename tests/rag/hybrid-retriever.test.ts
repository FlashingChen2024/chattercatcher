import { describe, expect, it } from "vitest";
import { HybridRetriever } from "../../src/rag/hybrid-retriever.js";
import type { Retriever } from "../../src/rag/retriever.js";

describe("HybridRetriever", () => {
  it("合并多个检索器结果并按分数排序", async () => {
    const keyword: Retriever = {
      async retrieve() {
        return [
          {
            id: "chunk-1",
            text: "端午活动改到 2026/6/30。",
            score: 0.4,
            source: { type: "message", label: "家庭群" },
          },
        ];
      },
    };
    const vector: Retriever = {
      async retrieve() {
        return [
          {
            id: "chunk-2",
            text: "最终时间以 6 月 30 日为准。",
            score: 0.9,
            source: { type: "message", label: "家庭群" },
          },
        ];
      },
    };

    const result = await new HybridRetriever([keyword, vector]).retrieve("端午活动什么时候");

    expect(result.map((item) => item.id)).toEqual(["chunk-2", "chunk-1"]);
  });

  it("同一证据重复出现时保留更高分版本", async () => {
    const low: Retriever = {
      async retrieve() {
        return [
          {
            id: "chunk-1",
            text: "旧分数",
            score: 0.2,
            source: { type: "message", label: "家庭群" },
          },
        ];
      },
    };
    const high: Retriever = {
      async retrieve() {
        return [
          {
            id: "chunk-1",
            text: "新分数",
            score: 0.8,
            source: { type: "message", label: "家庭群" },
          },
        ];
      },
    };

    const result = await new HybridRetriever([low, high]).retrieve("问题");

    expect(result).toHaveLength(1);
    expect(result[0]?.text).toBe("新分数");
  });

  it("相同分数时优先返回更新时间更新的证据", async () => {
    const episode: Retriever = {
      async retrieve() {
        return [
          {
            id: "episode-old",
            text: "端午活动时间是 2026/6/30。",
            score: 1,
            source: { type: "episode", label: "家庭群", timestamp: "2026-05-01T10:00:00.000Z" },
          },
        ];
      },
    };
    const message: Retriever = {
      async retrieve() {
        return [
          {
            id: "message-new",
            text: "端午活动最终改到 2026/7/1。",
            score: 1,
            source: { type: "message", label: "家庭群", timestamp: "2026-05-01T11:00:00.000Z" },
          },
        ];
      },
    };

    const result = await new HybridRetriever([episode, message]).retrieve("端午活动时间");

    expect(result[0]?.id).toBe("message-new");
  });
});

