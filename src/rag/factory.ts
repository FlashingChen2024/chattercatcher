import type { AppConfig, AppSecrets } from "../config/schema.js";
import type { MessageRepository } from "../messages/repository.js";
import { createEmbeddingModel } from "../llm/openai-compatible.js";
import { HybridRetriever } from "./hybrid-retriever.js";
import { LanceDbVectorStore } from "./lancedb-store.js";
import { MessageFtsRetriever } from "./message-retriever.js";
import type { Retriever } from "./retriever.js";
import { VectorRetriever } from "./vector-retriever.js";

export function hasEmbeddingConfig(config: AppConfig, secrets: AppSecrets): boolean {
  return Boolean((config.embedding.baseUrl || config.llm.baseUrl) && config.embedding.model && (secrets.embedding.apiKey || secrets.llm.apiKey));
}

export async function createHybridRetriever(input: {
  config: AppConfig;
  secrets: AppSecrets;
  messages: MessageRepository;
  excludeMessageIds?: string[];
}): Promise<{ retriever: Retriever; close: () => void }> {
  const retrievers: Retriever[] = [new MessageFtsRetriever(input.messages, { excludeMessageIds: input.excludeMessageIds })];
  const closers: Array<() => void> = [];

  if (hasEmbeddingConfig(input.config, input.secrets)) {
    const vectorStore = await LanceDbVectorStore.connectFromConfig(input.config);
    retrievers.push(new VectorRetriever(createEmbeddingModel(input.config, input.secrets), vectorStore));
    closers.push(() => vectorStore.close());
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
