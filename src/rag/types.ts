export type SourceType = "message" | "file" | "image" | "audio" | "link" | "feishu_doc";

export interface EvidenceSource {
  type: SourceType;
  label: string;
  timestamp?: string;
  sender?: string;
  location?: string;
}

export interface EvidenceBlock {
  id: string;
  text: string;
  score: number;
  source: EvidenceSource;
}

export interface Citation {
  marker: string;
  evidenceId: string;
  source: EvidenceSource;
}

export interface GroundedAnswer {
  answer: string;
  citations: Citation[];
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatModel {
  complete(messages: ChatMessage[]): Promise<string>;
}
