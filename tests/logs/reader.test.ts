import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listLogFiles, normalizeLineCount, readLatestLogTail, resolveLogPath } from "../../src/logs/reader.js";

let testDir: string;

describe("log reader", () => {
  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), "chattercatcher-logs-"));
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it("按更新时间选择最新日志并读取尾部行", async () => {
    const oldPath = path.join(testDir, "old.log");
    const latestPath = path.join(testDir, "gateway.log");
    await fs.writeFile(oldPath, "old\n", "utf8");
    await fs.writeFile(latestPath, "line1\nline2\nline3\n", "utf8");

    const oldTime = new Date("2026-04-25T00:00:00.000Z");
    const latestTime = new Date("2026-04-26T00:00:00.000Z");
    await fs.utimes(oldPath, oldTime, oldTime);
    await fs.utimes(latestPath, latestTime, latestTime);

    const files = await listLogFiles(testDir);
    const result = await readLatestLogTail({ logsDir: testDir, lines: 2 });

    expect(files.map((file) => file.name)).toEqual(["gateway.log", "old.log"]);
    expect(result?.file.path).toBe(latestPath);
    expect(result?.content).toBe("line2\nline3");
  });

  it("支持指定日志文件并忽略非 log 文件", async () => {
    await fs.writeFile(path.join(testDir, "notes.txt"), "not a log", "utf8");
    await fs.writeFile(path.join(testDir, "gateway.log"), "a\nb\nc", "utf8");

    const files = await listLogFiles(testDir);
    const result = await readLatestLogTail({ logsDir: testDir, fileName: "gateway.log", lines: 1 });

    expect(files).toHaveLength(1);
    expect(result?.content).toBe("c");
  });

  it("没有日志目录时返回空列表", async () => {
    await expect(listLogFiles(path.join(testDir, "missing"))).resolves.toEqual([]);
    await expect(readLatestLogTail({ logsDir: path.join(testDir, "missing") })).resolves.toBeNull();
  });

  it("规范化行数并解析相对路径", () => {
    expect(normalizeLineCount("3")).toBe(3);
    expect(normalizeLineCount("0")).toBe(1);
    expect(normalizeLineCount("100000")).toBe(10_000);
    expect(normalizeLineCount("bad", 50)).toBe(50);
    expect(resolveLogPath("gateway.log", testDir)).toBe(path.join(testDir, "gateway.log"));
  });
});
