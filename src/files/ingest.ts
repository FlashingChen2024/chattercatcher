import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { AppConfig } from "../config/schema.js";
import { resolveHomePath } from "../config/paths.js";
import type { MessageRepository } from "../messages/repository.js";

const TEXT_EXTENSIONS = new Set([".txt", ".md", ".markdown", ".json", ".csv", ".tsv", ".log"]);

export interface IngestLocalFileResult {
  messageId: string;
  sourcePath: string;
  storedPath: string;
  fileName: string;
  bytes: number;
  characters: number;
}

export function isSupportedTextFile(filePath: string): boolean {
  const extension = path.extname(filePath).toLowerCase();
  return TEXT_EXTENSIONS.has(extension);
}

function ensureSupportedTextFile(filePath: string): void {
  if (!isSupportedTextFile(filePath)) {
    const extension = path.extname(filePath).toLowerCase();
    throw new Error(`暂不支持该文件类型：${extension || "无扩展名"}。当前支持 txt、md、json、csv、tsv、log。`);
  }
}

function stableStoredName(sourcePath: string, fileName: string): string {
  const digest = crypto.createHash("sha256").update(sourcePath).digest("hex").slice(0, 16);
  return `${digest}-${fileName}`;
}

export async function ingestLocalFile(input: {
  config: AppConfig;
  messages: MessageRepository;
  filePath: string;
}): Promise<IngestLocalFileResult> {
  const sourcePath = path.resolve(input.filePath);
  ensureSupportedTextFile(sourcePath);

  const stat = await fs.stat(sourcePath);
  if (!stat.isFile()) {
    throw new Error(`不是文件：${sourcePath}`);
  }

  const fileName = path.basename(sourcePath);
  const text = await fs.readFile(sourcePath, "utf8");
  const fileDir = path.join(resolveHomePath(input.config.storage.dataDir), "files");
  await fs.mkdir(fileDir, { recursive: true });

  const storedPath = path.join(fileDir, stableStoredName(sourcePath, fileName));
  await fs.copyFile(sourcePath, storedPath);

  const messageId = input.messages.ingest({
    platform: "local-file",
    platformChatId: "local-files",
    chatName: "文件库",
    platformMessageId: sourcePath,
    senderId: "local-file",
    senderName: fileName,
    messageType: "file",
    text,
    sentAt: stat.mtime.toISOString(),
    rawPayload: {
      sourcePath,
      storedPath,
      bytes: stat.size,
      fileName,
    },
  });

  return {
    messageId,
    sourcePath,
    storedPath,
    fileName,
    bytes: stat.size,
    characters: text.length,
  };
}
