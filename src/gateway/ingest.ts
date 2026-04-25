import type { SqliteDatabase } from "../db/database.js";
import { normalizeFeishuReceiveMessageEvent, type FeishuReceiveMessageEvent } from "../feishu/normalize.js";
import { MessageRepository } from "../messages/repository.js";
import type { IngestMessageInput } from "../messages/types.js";

export interface GatewayIngestResult {
  accepted: boolean;
  messageId?: string;
  message?: IngestMessageInput;
  reason?: string;
}

export class GatewayIngestor {
  private readonly messages: MessageRepository;

  constructor(database: SqliteDatabase) {
    this.messages = new MessageRepository(database);
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
}
