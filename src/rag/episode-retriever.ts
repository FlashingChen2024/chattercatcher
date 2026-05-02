import { EpisodeRepository } from "../episodes/repository.js";
import type { EpisodeSearchResult } from "../episodes/repository.js";
import type { EvidenceBlock } from "./types.js";
import type { Retriever } from "./retriever.js";

function toEpisodeEvidence(result: EpisodeSearchResult): EvidenceBlock {
  return {
    id: result.chunkId,
    text: result.text,
    score: result.score,
    source: {
      type: "episode",
      label: result.chatName,
      sender: result.senderName,
      timestamp: result.endedAt,
      location: `${result.startedAt} - ${result.endedAt}`,
    },
  };
}

export class EpisodeFtsRetriever implements Retriever {
  constructor(private readonly episodes: EpisodeRepository) {}

  async retrieve(question: string): Promise<EvidenceBlock[]> {
    return this.episodes.searchEpisodes(question, 8).map(toEpisodeEvidence);
  }
}
