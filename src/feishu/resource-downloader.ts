import * as lark from "@larksuiteoapi/node-sdk";
import fs from "node:fs/promises";
import path from "node:path";
import type { AppConfig, AppSecrets } from "../config/schema.js";
import { resolveHomePath } from "../config/paths.js";
import { mapDomain } from "./sender.js";
import type { FeishuAttachmentMetadata } from "./normalize.js";

interface DownloadResponseLike {
  writeFile(filePath: string): Promise<unknown>;
}

interface FeishuResourceClientLike {
  im: {
    v1?: {
      messageResource?: {
        get(payload: {
          params: { type: string };
          path: { message_id: string; file_key: string };
        }): Promise<DownloadResponseLike>;
      };
    };
    messageResource?: {
      get(payload: {
        params: { type: string };
        path: { message_id: string; file_key: string };
      }): Promise<DownloadResponseLike>;
    };
  };
}

export interface FeishuDownloadResourceInput {
  messageId: string;
  attachment: FeishuAttachmentMetadata;
}

export interface FeishuDownloadedResource {
  messageId: string;
  fileKey: string;
  fileName: string;
  resourceType: string;
  storedPath: string;
}

const RESOURCE_TYPE_BY_KIND: Record<FeishuAttachmentMetadata["kind"], string> = {
  file: "file",
  image: "image",
  audio: "audio",
  media: "media",
};

const DEFAULT_EXTENSION_BY_KIND: Record<FeishuAttachmentMetadata["kind"], string> = {
  file: ".bin",
  image: ".jpg",
  audio: ".mp3",
  media: ".mp4",
};

function sanitizeFileName(value: string): string {
  const sanitized = value.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").trim();
  return sanitized || "feishu-resource";
}

function buildStoredFileName(input: FeishuDownloadResourceInput): string {
  const rawName = input.attachment.fileName || `${input.attachment.fileKey}${DEFAULT_EXTENSION_BY_KIND[input.attachment.kind]}`;
  return `${input.messageId}-${sanitizeFileName(rawName)}`;
}

export class FeishuResourceDownloader {
  constructor(
    private readonly client: FeishuResourceClientLike,
    private readonly dataDir: string,
  ) {}

  static fromConfig(config: AppConfig, secrets: AppSecrets): FeishuResourceDownloader {
    const client = new lark.Client({
      appId: config.feishu.appId,
      appSecret: secrets.feishu.appSecret,
      domain: mapDomain(config.feishu.domain),
    }) as FeishuResourceClientLike;

    return new FeishuResourceDownloader(client, resolveHomePath(config.storage.dataDir));
  }

  async download(input: FeishuDownloadResourceInput): Promise<FeishuDownloadedResource> {
    const resourceType = RESOURCE_TYPE_BY_KIND[input.attachment.kind];
    const targetDir = path.join(this.dataDir, "files", "feishu");
    await fs.mkdir(targetDir, { recursive: true });

    const fileName = buildStoredFileName(input);
    const storedPath = path.join(targetDir, fileName);
    const payload = {
      params: { type: resourceType },
      path: { message_id: input.messageId, file_key: input.attachment.fileKey },
    };

    const api = this.client.im.v1?.messageResource?.get ?? this.client.im.messageResource?.get;
    if (!api) {
      throw new Error("当前飞书 SDK 不支持 messageResource.get，无法下载消息资源。");
    }

    const response = await api(payload);
    await response.writeFile(storedPath);

    return {
      messageId: input.messageId,
      fileKey: input.attachment.fileKey,
      fileName,
      resourceType,
      storedPath,
    };
  }
}
