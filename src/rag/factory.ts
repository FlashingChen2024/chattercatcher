import type { AppConfig, AppSecrets } from "../config/schema.js";
import type { SqliteDatabase } from "../db/database.js";
import type { MessageRepository } from "../messages/repository.js";
import { createEmbeddingModel } from "../llm/openai-compatible.js";
import { HybridRetriever } from "./hybrid-retriever.js";
import { MessageFtsRetriever } from "./message-retriever.js";
import type { Retriever } from "./retriever.js";
import { SqliteVectorStore } from "./sqlite-vector-store.js";
import { VectorRetriever } from "./vector-retriever.js";

export function hasEmbeddingConfig(config: AppConfig, secrets: AppSecrets): boolean {
  return Boolean((config.embedding.baseUrl || config.llm.baseUrl) && config.embedding.model && (secrets.embedding.apiKey || secrets.llm.apiKey));
}

export async function createHybridRetriever(input: {
  config: AppConfig;
  secrets: AppSecrets;
  database: SqliteDatabase;
  messages: MessageRepository;
  excludeMessageIds?: string[];
}): Promise<{ retriever: Retriever; close: () => void }> {
  const retrievers: Retriever[] = [new MessageFtsRetriever(input.messages, { excludeMessageIds: input.excludeMessageIds })];
  const closers: Array<() => void> = [];

  if (hasEmbeddingConfig(input.config, input.secrets)) {
    const vectorStore = new SqliteVectorStore(input.database, {
      model: input.config.embedding.model,
    });
    retrievers.push(new VectorRetriever(createEmbeddingModel(input.config, input.secrets), vectorStore));
  }

  return {
    retriever: new HybridRetriever(retrievers),
    close: () => {
      for (const closer of closers) {
        closer();
      }
    },
  };
}
