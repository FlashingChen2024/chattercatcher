import { generateGroundedAnswer } from "./answer.js";
import type { ChatModel, GroundedAnswer } from "./types.js";
import type { Retriever } from "./retriever.js";

export interface AskWithRagInput {
  question: string;
  retriever: Retriever;
  model: ChatModel;
}

export async function askWithRag(input: AskWithRagInput): Promise<GroundedAnswer> {
  const evidence = await input.retriever.retrieve(input.question);

  if (evidence.length === 0) {
    return {
      answer: "不知道。当前本地知识库没有检索到足够证据。",
      citations: [],
    };
  }

  return generateGroundedAnswer({
    question: input.question,
    evidence,
    model: input.model,
  });
}
