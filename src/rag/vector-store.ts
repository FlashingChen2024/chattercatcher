import { cosineSimilarity } from "./embedding.js";
import type { EvidenceBlock } from "./types.js";

export interface VectorRecord {
  id: string;
  vector: number[];
  evidence: EvidenceBlock;
}

export interface VectorSearchResult extends EvidenceBlock {
  vectorScore: number;
}

export interface VectorStore {
  upsert(records: VectorRecord[]): Promise<void>;
  search(vector: number[], limit: number): Promise<VectorSearchResult[]>;
}

export class MemoryVectorStore implements VectorStore {
  private readonly records = new Map<string, VectorRecord>();

  async upsert(records: VectorRecord[]): Promise<void> {
    for (const record of records) {
      this.records.set(record.id, record);
    }
  }

  async search(vector: number[], limit: number): Promise<VectorSearchResult[]> {
    return [...this.records.values()]
      .map((record) => {
        const vectorScore = cosineSimilarity(vector, record.vector);
        return {
          ...record.evidence,
          score: vectorScore,
          vectorScore,
        };
      })
      .sort((left, right) => right.vectorScore - left.vectorScore)
      .slice(0, limit);
  }
}

