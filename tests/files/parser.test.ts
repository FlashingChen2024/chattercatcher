import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseFileToText, isSupportedParseFile } from "../../src/files/parser.js";
import { createDocxBuffer } from "./docx-fixture.js";

let testDir: string;

describe("file parser", () => {
  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), "chattercatcher-parser-"));
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it("支持文本、DOCX 和 PDF 扩展名", () => {
    expect(isSupportedParseFile("a.md")).toBe(true);
    expect(isSupportedParseFile("a.docx")).toBe(true);
    expect(isSupportedParseFile("a.pdf")).toBe(true);
    expect(isSupportedParseFile("a.exe")).toBe(false);
  });

  it("解析 UTF-8 文本文件", async () => {
    const sourcePath = path.join(testDir, "note.txt");
    await fs.writeFile(sourcePath, "端午活动改到 2026/6/30。", "utf8");

    const parsed = await parseFileToText(sourcePath);

    expect(parsed).toMatchObject({
      parser: "text",
      text: "端午活动改到 2026/6/30。",
      warnings: [],
    });
  });

  it("解析 DOCX 文件", async () => {
    const sourcePath = path.join(testDir, "activity.docx");
    await fs.writeFile(sourcePath, await createDocxBuffer("端午活动改到 2026/6/30。"));

    const parsed = await parseFileToText(sourcePath);

    expect(parsed.parser).toBe("docx");
    expect(parsed.text).toContain("端午活动改到 2026/6/30");
  });
});
