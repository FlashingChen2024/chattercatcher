import * as lark from "@larksuiteoapi/node-sdk";
import type { AppConfig, AppSecrets } from "../config/schema.js";
import type { GatewayIngestAndDownloadResult, GatewayIngestor } from "../gateway/ingest.js";
import type { FeishuReceiveMessageEvent } from "./normalize.js";
import type { FeishuQuestionHandler } from "./question.js";
import { FeishuResourceDownloader } from "./resource-downloader.js";
import { mapDomain } from "./sender.js";

export interface FeishuGatewayRuntime {
  start(): Promise<void>;
  stop(): void;
}

interface WsClientLike {
  start(params: { eventDispatcher: lark.EventDispatcher }): Promise<void>;
  close(params?: { force?: boolean }): void;
}

export interface FeishuGatewayOptions {
  config: AppConfig;
  secrets: AppSecrets;
  ingestor: GatewayIngestor;
  questionHandler?: FeishuQuestionHandler;
  resourceDownloader?: FeishuResourceDownloader;
  wsClientFactory?: (params: {
    appId: string;
    appSecret: string;
    domain: lark.Domain;
    onReady: () => void;
    onError: (error: Error) => void;
    onReconnecting: () => void;
    onReconnected: () => void;
  }) => WsClientLike;
}

function assertFeishuConfig(config: AppConfig, secrets: AppSecrets): void {
  if (!config.feishu.appId || !secrets.feishu.appSecret) {
    throw new Error("飞书配置不完整。请先运行 chattercatcher setup 或 chattercatcher settings。");
  }
}

export function createFeishuEventDispatcher(options: {
  config: AppConfig;
  ingestor: GatewayIngestor;
  questionHandler?: FeishuQuestionHandler;
  resourceDownloader?: FeishuResourceDownloader;
}): lark.EventDispatcher {
  return new lark.EventDispatcher({}).register({
    "im.message.receive_v1": async (data: FeishuReceiveMessageEvent["event"]) => {
      const payload = { event: data };
      const result: GatewayIngestAndDownloadResult = options.resourceDownloader
        ? await options.ingestor.ingestFeishuEventAndDownloadAttachments({
            payload,
            downloader: options.resourceDownloader,
            config: options.config,
          })
        : options.ingestor.ingestFeishuEvent(payload);

      if (!result.accepted) {
        console.log(`飞书消息未入库：${result.reason}`);
        return;
      }

      console.log(`飞书消息已入库：${result.messageId}`);
      if (result.attachment?.downloaded) {
        console.log(`飞书附件已下载：${result.attachment.downloaded.storedPath}`);
        if (result.attachment.indexedMessageId) {
          console.log(`飞书附件已进入 RAG：${result.attachment.indexedMessageId}`);
        } else if (result.attachment.skippedReason) {
          console.log(`飞书附件暂未进入 RAG：${result.attachment.skippedReason}`);
        }
      }

      if (options.questionHandler) {
        const decision = await options.questionHandler.handle(payload, {
          excludeMessageIds: result.messageId ? [result.messageId] : [],
        });
        if (!decision.shouldAnswer) {
          console.log(`飞书消息不触发回答：${decision.reason}`);
        }
      }
    },
  });
}

export function createFeishuGateway(options: FeishuGatewayOptions): FeishuGatewayRuntime {
  assertFeishuConfig(options.config, options.secrets);

  const wsClient =
    options.wsClientFactory?.({
      appId: options.config.feishu.appId,
      appSecret: options.secrets.feishu.appSecret,
      domain: mapDomain(options.config.feishu.domain),
      onReady: () => console.log("飞书长连接已建立。"),
      onError: (error) => console.error(`飞书长连接错误：${error.message}`),
      onReconnecting: () => console.log("飞书长连接正在重连。"),
      onReconnected: () => console.log("飞书长连接已重连。"),
    }) ??
    new lark.WSClient({
      appId: options.config.feishu.appId,
      appSecret: options.secrets.feishu.appSecret,
      domain: mapDomain(options.config.feishu.domain),
      loggerLevel: lark.LoggerLevel.info,
      source: "chattercatcher",
      onReady: () => console.log("飞书长连接已建立。"),
      onError: (error) => console.error(`飞书长连接错误：${error.message}`),
      onReconnecting: () => console.log("飞书长连接正在重连。"),
      onReconnected: () => console.log("飞书长连接已重连。"),
    });

  const eventDispatcher = createFeishuEventDispatcher({
    config: options.config,
    ingestor: options.ingestor,
    questionHandler: options.questionHandler,
    resourceDownloader: options.resourceDownloader,
  });

  return {
    async start() {
      await wsClient.start({ eventDispatcher });
    },
    stop() {
      wsClient.close({ force: true });
    },
  };
}
