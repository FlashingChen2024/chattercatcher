import type { SqliteDatabase } from "../db/database.js";
import {
  normalizeFeishuReceiveMessageEvent,
  type FeishuAttachmentMetadata,
  type FeishuReceiveMessageEvent,
} from "../feishu/normalize.js";
import type { FeishuDownloadedResource, FeishuResourceDownloader } from "../feishu/resource-downloader.js";
import { isSupportedTextFile, ingestLocalFile } from "../files/ingest.js";
import { FileJobRepository } from "../files/jobs.js";
import { MessageRepository } from "../messages/repository.js";
import type { IngestMessageInput } from "../messages/types.js";

export interface GatewayIngestResult {
  accepted: boolean;
  messageId?: string;
  message?: IngestMessageInput;
  reason?: string;
}

export interface GatewayAttachmentIngestResult {
  downloaded?: FeishuDownloadedResource;
  indexedMessageId?: string;
  vectorIndexed?: {
    chunks: number;
    vectors: number;
  };
  skippedReason?: string;
}

export interface GatewayIngestAndDownloadResult extends GatewayIngestResult {
  attachment?: GatewayAttachmentIngestResult;
}

function extractAttachment(message: IngestMessageInput): FeishuAttachmentMetadata | undefined {
  const raw = message.rawPayload;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return undefined;
  }

  const attachment = (raw as { attachment?: unknown }).attachment;
  if (!attachment || typeof attachment !== "object" || Array.isArray(attachment)) {
    return undefined;
  }

  const candidate = attachment as Partial<FeishuAttachmentMetadata>;
  if (candidate.platform !== "feishu" || !candidate.kind || !candidate.fileKey) {
    return undefined;
  }

  return candidate as FeishuAttachmentMetadata;
}

export class GatewayIngestor {
  private readonly messages: MessageRepository;
  private readonly jobs: FileJobRepository;

  constructor(database: SqliteDatabase) {
    this.messages = new MessageRepository(database);
    this.jobs = new FileJobRepository(database);
  }

  ingestFeishuEvent(payload: FeishuReceiveMessageEvent): GatewayIngestResult {
    const normalized = normalizeFeishuReceiveMessageEvent(payload);
    if (!normalized) {
      return {
        accepted: false,
        reason: "事件不是可入库的飞书消息。",
      };
    }

    const messageId = this.messages.ingest(normalized);
    return {
      accepted: true,
      messageId,
      message: normalized,
    };
  }

  async ingestFeishuEventAndDownloadAttachments(input: {
    payload: FeishuReceiveMessageEvent;
    downloader: FeishuResourceDownloader;
    config: Parameters<typeof ingestLocalFile>[0]["config"];
    vectorIndexMessage?: (messageId: string) => Promise<{ chunks: number; vectors: number }>;
  }): Promise<GatewayIngestAndDownloadResult> {
    const result = this.ingestFeishuEvent(input.payload);
    if (!result.accepted || !result.messageId || !result.message) {
      return result;
    }

    const attachment = extractAttachment(result.message);
    if (!attachment) {
      return result;
    }

    const downloaded = await input.downloader.download({
      messageId: result.message.platformMessageId,
      attachment,
    });

    if (!isSupportedTextFile(downloaded.storedPath)) {
      return {
        ...result,
        attachment: {
          downloaded,
          skippedReason: "附件已下载，但当前文件类型暂不支持解析。",
        },
      };
    }

    const indexedMessageId = await ingestLocalFile({
      config: input.config,
      messages: this.messages,
      jobs: this.jobs,
      filePath: downloaded.storedPath,
    }).then((file) => file.messageId);
    const vectorIndexed = input.vectorIndexMessage ? await input.vectorIndexMessage(indexedMessageId) : undefined;

    return {
      ...result,
      attachment: {
        downloaded,
        indexedMessageId,
        vectorIndexed,
      },
    };
  }
}
