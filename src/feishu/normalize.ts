import type { IngestMessageInput } from "../messages/types.js";

type JsonObject = Record<string, unknown>;

export interface FeishuReceiveMessageEvent {
  event?: {
    sender?: {
      sender_id?: {
        open_id?: string;
        user_id?: string;
        union_id?: string;
      };
    };
    message?: {
      message_id?: string;
      chat_id?: string;
      chat_type?: string;
      create_time?: string;
      message_type?: string;
      content?: string;
      mentions?: Array<{
        name?: string;
        key?: string;
        id?: {
          open_id?: string;
          user_id?: string;
          union_id?: string;
        };
      }>;
    };
  };
}

function asObject(value: unknown): JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as JsonObject) : {};
}

function parseContent(content: string | undefined): JsonObject {
  if (!content) {
    return {};
  }

  try {
    return asObject(JSON.parse(content));
  } catch {
    return { text: content };
  }
}

function stringifyUnknown(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return "";
}

function extractPostText(content: JsonObject): string {
  const post = asObject(content.post);
  const zhCn = asObject(post.zh_cn ?? post["zh-CN"] ?? post.en_us ?? post["en-US"]);
  const title = stringifyUnknown(zhCn.title);
  const blocks = Array.isArray(zhCn.content) ? zhCn.content : [];
  const parts: string[] = [];

  if (title) {
    parts.push(title);
  }

  for (const block of blocks) {
    if (!Array.isArray(block)) {
      continue;
    }

    for (const item of block) {
      const object = asObject(item);
      const text = stringifyUnknown(object.text);
      if (text) {
        parts.push(text);
      }
    }
  }

  return parts.join(" ").trim();
}

function extractMessageText(messageType: string, content: JsonObject): string {
  if (messageType === "text") {
    return stringifyUnknown(content.text).trim();
  }

  if (messageType === "post") {
    return extractPostText(content);
  }

  if (messageType === "image") {
    return `[图片] ${stringifyUnknown(content.image_key)}`.trim();
  }

  if (messageType === "file") {
    return `[文件] ${stringifyUnknown(content.file_name) || stringifyUnknown(content.file_key)}`.trim();
  }

  if (messageType === "audio") {
    return `[语音] ${stringifyUnknown(content.file_key)}`.trim();
  }

  if (messageType === "media") {
    return `[媒体] ${stringifyUnknown(content.file_name) || stringifyUnknown(content.file_key)}`.trim();
  }

  const fallback = Object.entries(content)
    .map(([key, value]) => `${key}: ${stringifyUnknown(value)}`)
    .filter((line) => !line.endsWith(": "))
    .join(" ");

  return fallback || `[${messageType}]`;
}

function normalizeTimestamp(createTime: string | undefined): string {
  if (!createTime) {
    return new Date().toISOString();
  }

  const numeric = Number(createTime);
  if (Number.isFinite(numeric)) {
    const milliseconds = createTime.length <= 10 ? numeric * 1000 : numeric;
    return new Date(milliseconds).toISOString();
  }

  const date = new Date(createTime);
  if (Number.isNaN(date.getTime())) {
    return new Date().toISOString();
  }

  return date.toISOString();
}

export function normalizeFeishuReceiveMessageEvent(payload: FeishuReceiveMessageEvent): IngestMessageInput | null {
  const event = payload.event;
  const message = event?.message;
  if (!event || !message?.message_id || !message.chat_id) {
    return null;
  }

  const messageType = message.message_type || "unknown";
  const content = parseContent(message.content);
  const text = extractMessageText(messageType, content);
  if (!text) {
    return null;
  }

  const senderId =
    event.sender?.sender_id?.open_id ||
    event.sender?.sender_id?.user_id ||
    event.sender?.sender_id?.union_id ||
    "unknown";

  return {
    platform: "feishu",
    platformChatId: message.chat_id,
    chatName: message.chat_id,
    platformMessageId: message.message_id,
    senderId,
    senderName: senderId,
    messageType,
    text,
    sentAt: normalizeTimestamp(message.create_time),
    rawPayload: payload,
  };
}

