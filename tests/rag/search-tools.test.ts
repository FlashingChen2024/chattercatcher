import { describe, expect, it, vi } from "vitest";
import { createRagSearchTools, executeRagSearchTool } from "../../src/rag/search-tools.js";
import type { EvidenceBlock } from "../../src/rag/types.js";
import type { Retriever } from "../../src/rag/retriever.js";

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
  {
    id: "msg-2",
    text: "活动预算上限是 300 元。",
    score: 0.72,
    source: {
      type: "episode",
      label: "端午活动讨论",
      timestamp: "2026-04-24T08:00:00.000Z",
    },
  },
];

function createRetriever(returnValue: EvidenceBlock[] = evidence): Retriever {
  return {
    retrieve: vi.fn(async () => returnValue),
  };
}

describe("RAG search tools", () => {
  it("creates default hybrid/message/episode tools with exact names and schema", () => {
    const tools = createRagSearchTools({
      hybrid: createRetriever(),
      messages: createRetriever(),
      episodes: createRetriever(),
    });

    expect(tools.map((tool) => tool.name)).toEqual(["hybrid_search", "search_messages", "search_episodes"]);
    expect(tools.map((tool) => tool.inputSchema)).toEqual([
      {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query written by the model." },
          limit: { type: "number", description: "Maximum number of evidence blocks to return." },
        },
        required: ["query"],
        additionalProperties: false,
      },
      {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query written by the model." },
          limit: { type: "number", description: "Maximum number of evidence blocks to return." },
        },
        required: ["query"],
        additionalProperties: false,
      },
      {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query written by the model." },
          limit: { type: "number", description: "Maximum number of evidence blocks to return." },
        },
        required: ["query"],
        additionalProperties: false,
      },
    ]);
  });

  it("includes semantic_search only when semantic retriever provided", () => {
    const withoutSemantic = createRagSearchTools({
      hybrid: createRetriever(),
      messages: createRetriever(),
      episodes: createRetriever(),
    });
    const withSemantic = createRagSearchTools({
      hybrid: createRetriever(),
      messages: createRetriever(),
      episodes: createRetriever(),
      semantic: createRetriever(),
    });

    expect(withoutSemantic.map((tool) => tool.name)).toEqual([
      "hybrid_search",
      "search_messages",
      "search_episodes",
    ]);
    expect(withSemantic.map((tool) => tool.name)).toEqual([
      "hybrid_search",
      "search_messages",
      "search_episodes",
      "semantic_search",
    ]);
  });

  it("execute with query and limit", async () => {
    const retriever = createRetriever(evidence);
    const [tool] = createRagSearchTools({
      hybrid: retriever,
      messages: createRetriever(),
      episodes: createRetriever(),
    });

    const result = await executeRagSearchTool(tool!, { query: "  端午活动什么时候  ", limit: 1.8 });

    expect(retriever.retrieve).toHaveBeenCalledWith("端午活动什么时候");
    expect(result).toEqual([evidence[0]]);
  });

  it("invalid input throws `搜索 query 必须是非空字符串。`", async () => {
    const [tool] = createRagSearchTools({
      hybrid: createRetriever(),
      messages: createRetriever(),
      episodes: createRetriever(),
    });

    await expect(executeRagSearchTool(tool!, { query: "   " })).rejects.toThrow("搜索 query 必须是非空字符串。");
    await expect(executeRagSearchTool(tool!, {})).rejects.toThrow("搜索 query 必须是非空字符串。");
  });
});
