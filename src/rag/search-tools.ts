import type { Retriever } from "./retriever.js";
import type { ChatTool, EvidenceBlock } from "./types.js";

export interface RagSearchTool extends ChatTool {
  execute(input: unknown): Promise<EvidenceBlock[]>;
}

export interface CreateRagSearchToolsInput {
  hybrid: Retriever;
  messages: Retriever;
  episodes: Retriever;
  semantic?: Retriever;
}

const searchInputSchema = {
  type: "object",
  properties: {
    query: { type: "string", description: "Search query written by the model." },
    limit: { type: "number", description: "Maximum number of evidence blocks to return." },
  },
  required: ["query"],
  additionalProperties: false,
};

interface SearchInput {
  query: string;
  limit: number;
}

function parseSearchInput(input: unknown): SearchInput {
  const rawQuery =
    typeof input === "object" && input !== null && "query" in input
      ? (input as { query?: unknown }).query
      : undefined;

  if (typeof rawQuery !== "string") {
    throw new Error("搜索 query 必须是非空字符串。");
  }

  const query = rawQuery.trim();
  if (!query) {
    throw new Error("搜索 query 必须是非空字符串。");
  }

  const rawLimit =
    typeof input === "object" && input !== null && "limit" in input
      ? (input as { limit?: unknown }).limit
      : undefined;
  const numericLimit = typeof rawLimit === "number" && Number.isFinite(rawLimit) ? rawLimit : 5;
  const limit = Math.min(12, Math.max(1, Math.floor(numericLimit)));

  return { query, limit };
}

async function runRetriever(retriever: Retriever, input: unknown): Promise<EvidenceBlock[]> {
  const { query, limit } = parseSearchInput(input);
  const results = await retriever.retrieve(query);
  return results.slice(0, limit);
}

function createSearchTool(name: string, description: string, retriever: Retriever): RagSearchTool {
  return {
    name,
    description,
    inputSchema: searchInputSchema,
    execute: (input) => runRetriever(retriever, input),
  };
}

export async function executeRagSearchTool(tool: RagSearchTool, input: unknown): Promise<EvidenceBlock[]> {
  const { limit } = parseSearchInput(input);
  const results = await tool.execute(input);
  return results.slice(0, limit);
}

export function createRagSearchTools(input: CreateRagSearchToolsInput): RagSearchTool[] {
  const tools: RagSearchTool[] = [
    createSearchTool(
      "hybrid_search",
      "Search across all indexed RAG evidence using the default hybrid retrieval strategy.",
      input.hybrid,
    ),
    createSearchTool(
      "search_messages",
      "Search chat messages only when the answer likely depends on message-level evidence.",
      input.messages,
    ),
    createSearchTool(
      "search_episodes",
      "Search episode summaries only when the answer likely depends on longer-running context.",
      input.episodes,
    ),
  ];

  if (input.semantic) {
    tools.push(
      createSearchTool(
        "semantic_search",
        "Search semantic vector evidence only when broader conceptual recall is needed.",
        input.semantic,
      ),
    );
  }

  return tools;
}
