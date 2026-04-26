import { describe, expect, it } from "vitest";
import { formatCitation } from "../../src/rag/citations.js";

describe("citation formatting", () => {
  it("把证据格式化成可读的谁在什么时候说了什么", () => {
    expect(
      formatCitation({
        marker: "S1",
        evidenceId: "msg-1",
        text: "端午活动改到 2026/6/30，以这个为准。",
        source: {
          type: "message",
          label: "家庭群",
          sender: "老妈",
          timestamp: "2026-04-25T08:00:00.000Z",
        },
      }),
    ).toBe("[S1] 老妈在 2026-04-25 16:00 说：“端午活动改到 2026/6/30，以这个为准。”");
  });

  it("隐藏不可读的飞书 open_id", () => {
    expect(
      formatCitation({
        marker: "S1",
        evidenceId: "msg-1",
        text: "明天要上编程课，时间是13:20",
        source: {
          type: "message",
          label: "oc_3667970950ac87caabfbc3786568480f",
          sender: "ou_1fc8541e0f5440180b879131de81ac8e",
          timestamp: "2026-04-26T05:10:30.253Z",
        },
      }),
    ).toBe("[S1] 群成员在 2026-04-26 13:10 说：“明天要上编程课，时间是13:20”");
  });
});
