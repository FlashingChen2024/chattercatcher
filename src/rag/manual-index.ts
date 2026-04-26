import type { AppConfig, AppSecrets } from "../config/schema.js";
import type { SqliteDatabase } from "../db/database.js";
import { createEmbeddingModel } from "../llm/openai-compatible.js";
import { MessageRepository } from "../messages/repository.js";
import { hasEmbeddingConfig } from "./factory.js";
import { indexMessageChunks } from "./indexer.js";
import { LanceDbVectorStore } from "./lancedb-store.js";

export interface ManualMessageIndexResult {
  status: "completed" | "skipped";
  reason?: string;
  chunks: number;
  vectors: number;
  startedAt: string;
  finishedAt: string;
}

export async function processMessagesNow(input: {
  config: AppConfig;
  secrets: AppSecrets;
  database: SqliteDatabase;
  limit?: number;
}): Promise<ManualMessageIndexResult> {
  const startedAt = new Date().toISOString();

  if (!hasEmbeddingConfig(input.config, input.secrets)) {
    return {
      status: "skipped",
      reason: "Embedding 配置不完整；SQLite FTS 已在消息入库时即时更新。",
      chunks: 0,
      vectors: 0,
      startedAt,
      finishedAt: new Date().toISOString(),
    };
  }

  const vectorStore = await LanceDbVectorStore.connectFromConfig(input.config);
  try {
    const stats = await indexMessageChunks({
      messages: new MessageRepository(input.database),
      embedding: createEmbeddingModel(input.config, input.secrets),
      store: vectorStore,
      limit: input.limit,
    });

    return {
      status: "completed",
      chunks: stats.chunks,
      vectors: stats.vectors,
      startedAt,
      finishedAt: new Date().toISOString(),
    };
  } finally {
    vectorStore.close();
  }
}
