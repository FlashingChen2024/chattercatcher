import { MessageRepository } from "../messages/repository.js";
import type { EvidenceBlock } from "./types.js";
import type { Retriever } from "./retriever.js";

export class MessageFtsRetriever implements Retriever {
  constructor(
    private readonly messages: MessageRepository,
    private readonly options: { excludeMessageIds?: string[] } = {},
  ) {}

  async retrieve(question: string): Promise<EvidenceBlock[]> {
    const results = this.messages.searchMessages(question, 8, {
      excludeMessageIds: this.options.excludeMessageIds,
    });

    return results.map((result) => ({
      id: result.chunkId,
      text: result.text,
      score: result.score,
      source: {
        type: "message",
        label: result.chatName,
        sender: result.senderName,
        timestamp: result.sentAt,
      },
    }));
  }
}
