import * as lark from "@larksuiteoapi/node-sdk";
import type { AppConfig, AppSecrets } from "../config/schema.js";

export interface MessageSender {
  sendTextToChat(chatId: string, text: string): Promise<void>;
}

interface FeishuClientLike {
  im: {
    v1?: {
      message: {
        create(payload: {
          data: {
            receive_id: string;
            msg_type: string;
            content: string;
          };
          params: {
            receive_id_type: "chat_id";
          };
        }): Promise<unknown>;
      };
    };
    message?: {
      create(payload: {
        data: {
          receive_id: string;
          msg_type: string;
          content: string;
        };
        params: {
          receive_id_type: "chat_id";
        };
      }): Promise<unknown>;
    };
  };
}

export function mapDomain(domain: AppConfig["feishu"]["domain"]): lark.Domain {
  return domain === "lark" ? lark.Domain.Lark : lark.Domain.Feishu;
}

export class FeishuMessageSender implements MessageSender {
  constructor(private readonly client: FeishuClientLike) {}

  static fromConfig(config: AppConfig, secrets: AppSecrets): FeishuMessageSender {
    const client = new lark.Client({
      appId: config.feishu.appId,
      appSecret: secrets.feishu.appSecret,
      domain: mapDomain(config.feishu.domain),
    }) as FeishuClientLike;

    return new FeishuMessageSender(client);
  }

  async sendTextToChat(chatId: string, text: string): Promise<void> {
    const payload = {
      data: {
        receive_id: chatId,
        msg_type: "text",
        content: JSON.stringify({ text }),
      },
      params: {
        receive_id_type: "chat_id" as const,
      },
    };

    if (this.client.im.v1?.message.create) {
      await this.client.im.v1.message.create(payload);
      return;
    }

    if (this.client.im.message?.create) {
      await this.client.im.message.create(payload);
      return;
    }

    {
      throw new Error("当前飞书 SDK 不支持消息发送接口。");
    }
  }
}
