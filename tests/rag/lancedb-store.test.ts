import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LanceDbVectorStore } from "../../src/rag/lancedb-store.js";

let testDir: string;

describe("LanceDbVectorStore", () => {
  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), "chattercatcher-lancedb-"));
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it("写入并检索向量证据", async () => {
    const store = await LanceDbVectorStore.connect(testDir);

    try {
      await store.upsert([
        {
          id: "activity",
          vector: [1, 0],
          evidence: {
            id: "activity",
            text: "端午活动改到 2026/6/30。",
            score: 1,
            source: { type: "message", label: "家庭群", sender: "老妈" },
          },
        },
        {
          id: "bill",
          vector: [0, 1],
          evidence: {
            id: "bill",
            text: "水电费已缴。",
            score: 1,
            source: { type: "message", label: "家庭群" },
          },
        },
      ]);

      const results = await store.search([1, 0], 1);

      expect(await store.count()).toBe(2);
      expect(results[0]?.id).toBe("activity");
      expect(results[0]?.source).toMatchObject({ label: "家庭群" });
    } finally {
      store.close();
    }
  });

  it("重复 upsert 会更新原证据", async () => {
    const store = await LanceDbVectorStore.connect(testDir);

    try {
      await store.upsert([
        {
          id: "activity",
          vector: [1, 0],
          evidence: {
            id: "activity",
            text: "旧时间 2026/5/30。",
            score: 1,
            source: { type: "message", label: "家庭群" },
          },
        },
      ]);
      await store.upsert([
        {
          id: "activity",
          vector: [1, 0],
          evidence: {
            id: "activity",
            text: "新时间 2026/6/30。",
            score: 1,
            source: { type: "message", label: "家庭群" },
          },
        },
      ]);

      const results = await store.search([1, 0], 5);

      expect(await store.count()).toBe(1);
      expect(results[0]?.text).toContain("2026/6/30");
    } finally {
      store.close();
    }
  });
});

