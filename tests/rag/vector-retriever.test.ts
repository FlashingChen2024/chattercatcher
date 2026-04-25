import { describe, expect, it } from "vitest";
import type { EmbeddingModel } from "../../src/rag/embedding.js";
import { VectorRetriever } from "../../src/rag/vector-retriever.js";
import { MemoryVectorStore } from "../../src/rag/vector-store.js";

describe("VectorRetriever", () => {
  it("通过 embedding 和向量库检索语义证据", async () => {
    const embedding: EmbeddingModel = {
      async embed(text) {
        return text.includes("活动") ? [1, 0] : [0, 1];
      },
      async embedBatch(texts) {
        return Promise.all(texts.map((text) => this.embed(text)));
      },
    };
    const store = new MemoryVectorStore();
    await store.upsert([
      {
        id: "activity",
        vector: [1, 0],
        evidence: {
          id: "activity",
          text: "端午活动改到 2026/6/30。",
          score: 1,
          source: { type: "message", label: "家庭群" },
        },
      },
      {
        id: "bill",
        vector: [0, 1],
        evidence: {
          id: "bill",
          text: "水电费已缴。",
          score: 1,
          source: { type: "message", label: "家庭群" },
        },
      },
    ]);

    const result = await new VectorRetriever(embedding, store).retrieve("活动什么时候");

    expect(result[0]?.id).toBe("activity");
  });
});

