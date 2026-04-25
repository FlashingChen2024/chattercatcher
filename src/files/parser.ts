import fs from "node:fs/promises";
import path from "node:path";
import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";

const TEXT_EXTENSIONS = new Set([".txt", ".md", ".markdown", ".json", ".csv", ".tsv", ".log"]);
const DOCX_EXTENSIONS = new Set([".docx"]);
const PDF_EXTENSIONS = new Set([".pdf"]);

export interface ParsedFile {
  text: string;
  parser: "text" | "docx" | "pdf";
  warnings: string[];
}

export function isSupportedParseFile(filePath: string): boolean {
  const extension = path.extname(filePath).toLowerCase();
  return TEXT_EXTENSIONS.has(extension) || DOCX_EXTENSIONS.has(extension) || PDF_EXTENSIONS.has(extension);
}

export function describeSupportedParseTypes(): string {
  return "txt、md、json、csv、tsv、log、docx、pdf";
}

export async function parseFileToText(filePath: string): Promise<ParsedFile> {
  const extension = path.extname(filePath).toLowerCase();

  if (TEXT_EXTENSIONS.has(extension)) {
    return {
      text: await fs.readFile(filePath, "utf8"),
      parser: "text",
      warnings: [],
    };
  }

  if (DOCX_EXTENSIONS.has(extension)) {
    const result = await mammoth.extractRawText({ path: filePath });
    return {
      text: result.value,
      parser: "docx",
      warnings: result.messages.map((message) => message.message),
    };
  }

  if (PDF_EXTENSIONS.has(extension)) {
    const buffer = await fs.readFile(filePath);
    const parser = new PDFParse({ data: buffer });
    try {
      const result = await parser.getText();
      return {
        text: result.text,
        parser: "pdf",
        warnings: [],
      };
    } finally {
      await parser.destroy();
    }
  }

  throw new Error(`暂不支持该文件类型：${extension || "无扩展名"}。当前支持 ${describeSupportedParseTypes()}。`);
}
