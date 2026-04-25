import type { AppConfig, AppSecrets } from "../config/schema.js";
import type { ChatMessage, ChatModel } from "../rag/types.js";

export interface OpenAICompatibleChatOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature?: number;
}

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

export class OpenAICompatibleChatModel implements ChatModel {
  constructor(private readonly options: OpenAICompatibleChatOptions) {}

  async complete(messages: ChatMessage[]): Promise<string> {
    if (!this.options.baseUrl || !this.options.apiKey || !this.options.model) {
      throw new Error("LLM 配置不完整。请运行 chattercatcher setup 或 chattercatcher settings。");
    }

    const response = await fetch(`${normalizeBaseUrl(this.options.baseUrl)}/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.options.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: this.options.model,
        messages,
        temperature: this.options.temperature ?? 0.2,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`LLM 请求失败：${response.status} ${body}`);
    }

    const data = (await response.json()) as ChatCompletionResponse;
    const content = data.choices?.[0]?.message?.content?.trim();
    if (!content) {
      throw new Error("LLM 返回为空。");
    }

    return content;
  }
}

export function createChatModel(config: AppConfig, secrets: AppSecrets): OpenAICompatibleChatModel {
  return new OpenAICompatibleChatModel({
    baseUrl: config.llm.baseUrl,
    apiKey: secrets.llm.apiKey,
    model: config.llm.model,
  });
}

