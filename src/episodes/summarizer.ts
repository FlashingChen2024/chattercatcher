import type { ChatModel } from "../rag/types.js";
import type { EpisodeWindow } from "./repository.js";
import { sanitizeEpisodeSummary } from "./sanitizer.js";

export async function summarizeEpisodeWindow(window: EpisodeWindow, model: ChatModel): Promise<string> {
  const transcript = window.messages
    .map((message) => `[${message.sentAt}] ${message.senderName}：${message.text}`)
    .join("\n");

  const summary = await model.complete([
    {
      role: "system",
      content:
        "你是 ChatterCatcher 的会话记忆整理模块。你的任务是把碎片化闲聊整理成可检索事实，补全短消息、代词、缩写与上下文之间的关系。只总结明确事实，不要编造。保留重要数字、日期、链接和代码；如果内容像密码、API key、token 或密钥，只描述其上下文关系，不要在摘要中复写原文。",
    },
    {
      role: "user",
      content: `群聊：${window.chatName}\n时间：${window.startedAt} - ${window.endedAt}\n\n聊天记录：\n${transcript}\n\n请输出一段简洁的会话记忆摘要。`,
    },
  ]);

  return sanitizeEpisodeSummary(summary);
}
