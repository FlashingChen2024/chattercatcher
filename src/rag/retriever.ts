import type { EvidenceBlock } from "./types.js";

export interface Retriever {
  retrieve(question: string): Promise<EvidenceBlock[]>;
}

export class EmptyRetriever implements Retriever {
  async retrieve(): Promise<EvidenceBlock[]> {
    return [];
  }
}

export class StaticRetriever implements Retriever {
  constructor(private readonly evidence: EvidenceBlock[]) {}

  async retrieve(): Promise<EvidenceBlock[]> {
    return this.evidence;
  }
}
