import type { Citation, EvidenceSource } from "./types.js";

function isOpaqueId(value: string | undefined): boolean {
  return Boolean(value && /^(ou|oc|om|cli|on|un|uid)_?[a-z0-9]+/i.test(value));
}

function formatTime(value: string | undefined): string {
  if (!value) {
    return "未知时间";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  const pad = (input: number) => String(input).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatSpeaker(source: EvidenceSource): string {
  if (source.type === "file") {
    return isOpaqueId(source.label) ? "文件" : `文件 ${source.label}`;
  }

  if (source.sender && !isOpaqueId(source.sender)) {
    return source.sender;
  }

  return "群成员";
}

function clipText(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}...` : normalized;
}

export function formatCitation(citation: Citation, options: { maxTextLength?: number } = {}): string {
  const maxTextLength = options.maxTextLength ?? 120;
  const speaker = formatSpeaker(citation.source);
  const time = formatTime(citation.source.timestamp);
  const verb = citation.source.type === "file" ? "记录" : "说";
  return `[${citation.marker}] ${speaker}在 ${time} ${verb}：“${clipText(citation.text, maxTextLength)}”`;
}

export function formatCitations(citations: Citation[], options: { maxTextLength?: number } = {}): string {
  return citations.map((citation) => formatCitation(citation, options)).join("\n");
}
