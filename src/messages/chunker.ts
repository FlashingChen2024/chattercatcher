export interface TextChunk {
  index: number;
  text: string;
}

export function chunkText(text: string, maxChars = 900, overlapChars = 120): TextChunk[] {
  const normalized = text.trim().replace(/\s+/g, " ");
  if (!normalized) {
    return [];
  }

  if (normalized.length <= maxChars) {
    return [{ index: 0, text: normalized }];
  }

  const chunks: TextChunk[] = [];
  let cursor = 0;

  while (cursor < normalized.length) {
    const end = Math.min(cursor + maxChars, normalized.length);
    chunks.push({ index: chunks.length, text: normalized.slice(cursor, end) });

    if (end === normalized.length) {
      break;
    }

    cursor = Math.max(end - overlapChars, cursor + 1);
  }

  return chunks;
}

