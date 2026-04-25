import type { EmbeddingModel } from "./embedding.js";
import type { VectorRecord, VectorStore } from "./vector-store.js";
import type { MessageRepository } from "../messages/repository.js";

export interface VectorIndexStats {
  chunks: number;
  vectors: number;
}

export async function indexMessageChunks(input: {
  messages: MessageRepository;
  embedding: EmbeddingModel;
  store: VectorStore;
  limit?: number;
}): Promise<VectorIndexStats> {
  const chunks = input.messages.listAllMessageChunks(input.limit ?? 10000);
  if (chunks.length === 0) {
    return { chunks: 0, vectors: 0 };
  }

  const vectors = await input.embedding.embedBatch(chunks.map((chunk) => chunk.text));
  const records: VectorRecord[] = [];

  for (const [index, chunk] of chunks.entries()) {
    const vector = vectors[index];
    if (!vector || vector.length === 0) {
      continue;
    }

    records.push({
      id: chunk.chunkId,
      vector,
      evidence: {
        id: chunk.chunkId,
        text: chunk.text,
        score: 1,
        source: {
          type: "message",
          label: chunk.chatName,
          sender: chunk.senderName,
          timestamp: chunk.sentAt,
        },
      },
    });
  }

  await input.store.upsert(records);

  return {
    chunks: chunks.length,
    vectors: records.length,
  };
}

