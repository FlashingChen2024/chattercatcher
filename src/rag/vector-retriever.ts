import type { EmbeddingModel } from "./embedding.js";
import type { Retriever } from "./retriever.js";
import type { EvidenceBlock } from "./types.js";
import type { VectorStore } from "./vector-store.js";

export class VectorRetriever implements Retriever {
  constructor(
    private readonly embedding: EmbeddingModel,
    private readonly store: VectorStore,
    private readonly limit = 8,
  ) {}

  async retrieve(question: string): Promise<EvidenceBlock[]> {
    const vector = await this.embedding.embed(question);
    return this.store.search(vector, this.limit);
  }
}

