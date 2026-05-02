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

function evidenceTimestampMs(evidence: EvidenceBlock): number {
  const timestamp = evidence.source.timestamp;
  if (!timestamp) {
    return 0;
  }

  const parsed = Date.parse(timestamp);
  return Number.isFinite(parsed) ? parsed : 0;
}

export class HybridRetriever implements Retriever {
  constructor(
    private readonly retrievers: Retriever[],
    private readonly options: HybridRetrieverOptions = {},
  ) {}

  async retrieve(question: string): Promise<EvidenceBlock[]> {
    const results = await Promise.all(this.retrievers.map((retriever) => retriever.retrieve(question)));
    const merged = new Map<string, EvidenceBlock>();

    for (const evidenceList of results) {
      for (const evidence of evidenceList) {
        const existing = merged.get(evidence.id);
        const score = normalizeScore(evidence.score);

        if (!existing || score > existing.score) {
          merged.set(evidence.id, {
            ...evidence,
            score,
          });
        }
      }
    }

    return [...merged.values()]
      .sort((left, right) => right.score - left.score || evidenceTimestampMs(right) - evidenceTimestampMs(left))
      .slice(0, this.options.limit ?? 8);
  }
}

