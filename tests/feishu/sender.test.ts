import { describe, expect, it } from "vitest";
import { FeishuMessageSender } from "../../src/feishu/sender.js";

describe("FeishuMessageSender", () => {
  it("通过飞书 im.v1.message.create 发送文本消息", async () => {
    const calls: unknown[] = [];
    const sender = new FeishuMessageSender({
      im: {
        v1: {
          message: {
            async create(payload) {
              calls.push(payload);
            },
          },
        },
      },
    });

    await sender.sendTextToChat("oc_family", "回答");

    expect(calls).toEqual([
      {
        data: {
          receive_id: "oc_family",
          msg_type: "text",
          content: JSON.stringify({ text: "回答" }),
        },
        params: {
          receive_id_type: "chat_id",
        },
      },
    ]);
  });
});

