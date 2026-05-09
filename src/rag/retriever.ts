import type { MessageSearchScope } from "../messages/types.js";
import type { EvidenceBlock } from "./types.js";

export type RetrievalScope = MessageSearchScope;

export interface Retriever {
  retrieve(question: string, scope?: RetrievalScope): Promise<EvidenceBlock[]>;
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
