export type ImageMultimodalTaskStatus = "pending" | "running" | "succeeded" | "skipped" | "failed";

export interface ImageMultimodalTaskRecord {
  id: string;
  sourceMessageId: string;
  platformMessageId: string;
  imageKey: string;
  storedPath: string;
  mimeType: string;
  status: ImageMultimodalTaskStatus;
  attempts: number;
  lastError?: string;
  derivedMessageId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface EnqueueImageMultimodalTaskInput {
  sourceMessageId: string;
  platformMessageId: string;
  imageKey: string;
  storedPath: string;
  mimeType: string;
}

export interface DescribeImageInput {
  imagePath: string;
  mimeType: string;
  prompt: string;
}

export interface DescribeImageResult {
  text: string;
}

export interface MultimodalModel {
  describeImage(input: DescribeImageInput): Promise<DescribeImageResult>;
}
