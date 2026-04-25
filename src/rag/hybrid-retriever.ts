import type { Retriever } from "./retriever.js";
import type { EvidenceBlock } from "./types.js";

export interface HybridRetrieverOptions {
  limit?: number;
}

function normalizeScore(score: number): number {
  if (!Number.isFinite(score)) {
    return 0;
  }

  return Math.max(0, Math.min(1, score));
}

export class HybridRetriever implements Retriever {
  constructor(
    private readonly retrievers: Retriever[],
    private readonly options: HybridRetrieverOptions = {},
  ) {}

  async retrieve(question: string): Promise<EvidenceBlock[]> {
    const results = await Promise.all(this.retrievers.map((retriever) => retriever.retrieve(question)));
    const merged = new Map<string, EvidenceBlock>();

    for (const [retrieverIndex, evidenceList] of results.entries()) {
      for (const evidence of evidenceList) {
        const existing = merged.get(evidence.id);
        const weightedScore = normalizeScore(evidence.score) + (this.retrievers.length - retrieverIndex) * 0.01;

        if (!existing || weightedScore > existing.score) {
          merged.set(evidence.id, {
            ...evidence,
            score: weightedScore,
          });
        }
      }
    }

    return [...merged.values()]
      .sort((left, right) => right.score - left.score)
      .slice(0, this.options.limit ?? 8);
  }
}

