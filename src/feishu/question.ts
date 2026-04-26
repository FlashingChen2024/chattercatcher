import type { AppConfig, AppSecrets } from "../config/schema.js";
import type { SqliteDatabase } from "../db/database.js";
import { MessageRepository } from "../messages/repository.js";
import { formatCitations } from "../rag/citations.js";
import { createHybridRetriever } from "../rag/factory.js";
import { askWithRag } from "../rag/qa-service.js";
import type { ChatModel } from "../rag/types.js";
import type { MessageSender } from "./sender.js";
import type { FeishuReceiveMessageEvent } from "./normalize.js";

export interface FeishuQuestionHandlerOptions {
  config: AppConfig;
  secrets: AppSecrets;
  database: SqliteDatabase;
  model: ChatModel;
  sender: MessageSender;
}

export interface FeishuQuestionDecision {
  shouldAnswer: boolean;
  question?: string;
  chatId?: string;
  reason?: string;
}

function parseTextContent(content: string | undefined): string {
  if (!content) {
    return "";
  }

  try {
    const parsed = JSON.parse(content) as { text?: unknown };
    return typeof parsed.text === "string" ? parsed.text : "";
  } catch {
    return content;
  }
}

function stripMentions(text: string, mentions: NonNullable<NonNullable<FeishuReceiveMessageEvent["event"]>["message"]>["mentions"]): string {
  let result = text;

  for (const mention of mentions ?? []) {
    for (const token of [mention.key, mention.name, mention.name ? `@${mention.name}` : undefined]) {
      if (token) {
        result = result.replaceAll(token, " ");
      }
    }
  }

  return result.replace(/@\s*ChatterCatcher/gi, " ").replace(/@/g, " ").replace(/\s+/g, " ").trim();
}

export function getFeishuQuestionDecision(
  payload: FeishuReceiveMessageEvent,
  config: AppConfig,
): FeishuQuestionDecision {
  const message = payload.event?.message;
  if (!message?.chat_id || message.message_type !== "text") {
    return {
      shouldAnswer: false,
      reason: "不是可回答的文本消息。",
    };
  }

  const mentions = message.mentions ?? [];
  const text = parseTextContent(message.content);
  const hasMention =
    mentions.length > 0 ||
    /@?ChatterCatcher/i.test(text);

  if (config.feishu.requireMention && !hasMention) {
    return {
      shouldAnswer: false,
      reason: "群聊配置为必须 @ 后回答。",
    };
  }

  const question = stripMentions(text, mentions);
  if (!question) {
    return {
      shouldAnswer: false,
      reason: "没有可回答的问题文本。",
    };
  }

  return {
    shouldAnswer: true,
    question,
    chatId: message.chat_id,
  };
}

export class FeishuQuestionHandler {
  constructor(private readonly options: FeishuQuestionHandlerOptions) {}

  async handle(
    payload: FeishuReceiveMessageEvent,
    options: { excludeMessageIds?: string[] } = {},
  ): Promise<FeishuQuestionDecision> {
    const decision = getFeishuQuestionDecision(payload, this.options.config);
    if (!decision.shouldAnswer || !decision.question || !decision.chatId) {
      return decision;
    }

    const { retriever, close } = await createHybridRetriever({
      config: this.options.config,
      secrets: this.options.secrets,
      messages: new MessageRepository(this.options.database),
      excludeMessageIds: options.excludeMessageIds,
    });

    try {
      try {
        const result = await askWithRag({
          question: decision.question,
          retriever,
          model: this.options.model,
        });
        const citations = formatCitations(result.citations);
        const text = citations ? `${result.answer}\n\n引用：\n${citations}` : result.answer;
        const questionMessageId = payload.event?.message?.message_id;
        if (questionMessageId && this.options.sender.replyTextToMessage) {
          try {
            await this.options.sender.replyTextToMessage(questionMessageId, text);
          } catch {
            await this.options.sender.sendTextToChat(decision.chatId, text);
          }
        } else {
          await this.options.sender.sendTextToChat(decision.chatId, text);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await this.options.sender.sendTextToChat(decision.chatId, `暂时无法回答：${message}`);
      }
      return decision;
    } finally {
      close();
    }
  }
}
