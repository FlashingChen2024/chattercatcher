import type { ChatMessage, ChatModel, Citation, EvidenceBlock, GroundedAnswer } from "./types.js";

export interface BuildEvidencePromptOptions {
  maxEvidenceBlocks?: number;
  maxCharsPerBlock?: number;
}

export interface EvidencePrompt {
  messages: ChatMessage[];
  citations: Citation[];
}

const DEFAULT_MAX_EVIDENCE_BLOCKS = 8;
const DEFAULT_MAX_CHARS_PER_BLOCK = 1200;

export function buildEvidencePrompt(
  question: string,
  evidence: EvidenceBlock[],
  options: BuildEvidencePromptOptions = {},
): EvidencePrompt {
  if (evidence.length === 0) {
    throw new Error("RAG evidence is required before answer generation.");
  }

  const maxEvidenceBlocks = options.maxEvidenceBlocks ?? DEFAULT_MAX_EVIDENCE_BLOCKS;
  const maxCharsPerBlock = options.maxCharsPerBlock ?? DEFAULT_MAX_CHARS_PER_BLOCK;
  const selected = [...evidence].sort((left, right) => right.score - left.score).slice(0, maxEvidenceBlocks);

  const citations = selected.map<Citation>((item, index) => ({
    marker: `S${index + 1}`,
    evidenceId: item.id,
    source: item.source,
  }));

  const evidenceText = selected
    .map((item, index) => {
      const marker = citations[index]?.marker;
      const clippedText =
        item.text.length > maxCharsPerBlock ? `${item.text.slice(0, maxCharsPerBlock)}...` : item.text;
      const sourceParts = [
        item.source.label,
        item.source.sender ? `发送人：${item.source.sender}` : undefined,
        item.source.timestamp ? `时间：${item.source.timestamp}` : undefined,
        item.source.location ? `位置：${item.source.location}` : undefined,
      ].filter(Boolean);

      return `[${marker}]\n来源：${sourceParts.join("；")}\n内容：${clippedText}`;
    })
    .join("\n\n");

  return {
    citations,
    messages: [
      {
        role: "system",
        content:
          "你是 ChatterCatcher 的问答模块。只能根据提供的证据回答。必须简短直接。事实性结论必须引用 [S1] 这样的来源标记。证据不足时说不知道，不要猜。",
      },
      {
        role: "user",
        content: `问题：${question}\n\n检索证据：\n${evidenceText}`,
      },
    ],
  };
}

export async function generateGroundedAnswer(input: {
  question: string;
  evidence: EvidenceBlock[];
  model: ChatModel;
}): Promise<GroundedAnswer> {
  const prompt = buildEvidencePrompt(input.question, input.evidence);
  const answer = await input.model.complete(prompt.messages);

  return {
    answer,
    citations: prompt.citations,
  };
}
