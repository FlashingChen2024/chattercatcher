import fs from "node:fs/promises";
import { watch } from "node:fs";
import path from "node:path";
import { getChatterCatcherHome } from "../config/paths.js";

export interface LogFileInfo {
  name: string;
  path: string;
  updatedAt: Date;
  bytes: number;
}

export interface LogTailResult {
  file: LogFileInfo;
  content: string;
}

export function getLogsDirectory(): string {
  return path.join(getChatterCatcherHome(), "logs");
}

export function resolveLogPath(fileName: string, logsDir = getLogsDirectory()): string {
  return path.isAbsolute(fileName) ? fileName : path.join(logsDir, fileName);
}

export function normalizeLineCount(value: number | string | undefined, fallback = 200): number {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) ? Math.min(Math.max(Math.trunc(parsed), 1), 10_000) : fallback;
}

export async function listLogFiles(logsDir = getLogsDirectory()): Promise<LogFileInfo[]> {
  let entries: Array<{ isFile: () => boolean; name: string }>;
  try {
    entries = await fs.readdir(logsDir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }

    throw error;
  }

  const files = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".log"))
      .map(async (entry) => {
        const filePath = path.join(logsDir, entry.name);
        const stats = await fs.stat(filePath);
        return {
          name: entry.name,
          path: filePath,
          updatedAt: stats.mtime,
          bytes: stats.size,
        };
      }),
  );

  return files.sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime());
}

function tailLines(content: string, lines: number): string {
  const normalized = content.replace(/\r\n/g, "\n");
  const parts = normalized.endsWith("\n") ? normalized.slice(0, -1).split("\n") : normalized.split("\n");
  return parts.slice(-lines).join("\n");
}

export async function readLogTail(input: { filePath: string; lines?: number }): Promise<LogTailResult> {
  const stats = await fs.stat(input.filePath);
  const content = await fs.readFile(input.filePath, "utf8");
  return {
    file: {
      name: path.basename(input.filePath),
      path: input.filePath,
      updatedAt: stats.mtime,
      bytes: stats.size,
    },
    content: tailLines(content, normalizeLineCount(input.lines)),
  };
}

export async function readLatestLogTail(input: {
  fileName?: string;
  lines?: number;
  logsDir?: string;
} = {}): Promise<LogTailResult | null> {
  if (input.fileName) {
    return readLogTail({
      filePath: resolveLogPath(input.fileName, input.logsDir),
      lines: input.lines,
    });
  }

  const [latest] = await listLogFiles(input.logsDir);
  if (!latest) {
    return null;
  }

  return readLogTail({ filePath: latest.path, lines: input.lines });
}

export async function followLogFile(input: {
  filePath: string;
  onChunk: (chunk: string) => void;
  onError?: (error: Error) => void;
}): Promise<() => void> {
  let offset = (await fs.stat(input.filePath)).size;
  const directory = path.dirname(input.filePath);
  const fileName = path.basename(input.filePath);

  async function readAppended(): Promise<void> {
    const stats = await fs.stat(input.filePath);
    if (stats.size < offset) {
      offset = 0;
    }

    if (stats.size === offset) {
      return;
    }

    const handle = await fs.open(input.filePath, "r");
    try {
      const length = stats.size - offset;
      const buffer = Buffer.alloc(length);
      await handle.read(buffer, 0, length, offset);
      offset = stats.size;
      input.onChunk(buffer.toString("utf8"));
    } finally {
      await handle.close();
    }
  }

  const watcher = watch(directory, (eventType, changedFileName) => {
    if (eventType !== "change" || changedFileName?.toString() !== fileName) {
      return;
    }

    void readAppended().catch((error: unknown) => {
      input.onError?.(error instanceof Error ? error : new Error(String(error)));
    });
  });

  return () => watcher.close();
}
