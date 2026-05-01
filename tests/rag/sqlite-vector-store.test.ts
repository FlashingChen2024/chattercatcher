import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDefaultConfig } from "../../src/config/schema.js";
import { openDatabase } from "../../src/db/database.js";

let testDir: string;

describe("SqliteVectorStore", () => {
  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), "chattercatcher-sqlite-vector-"));
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it("migration 创建 message_chunk_embeddings 表", () => {
    const config = createDefaultConfig();
    config.storage.dataDir = testDir;
    const database = openDatabase(config);

    try {
      const row = database
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'message_chunk_embeddings'")
        .get() as { name: string } | undefined;

      expect(row?.name).toBe("message_chunk_embeddings");
    } finally {
      database.close();
    }
  });
});
