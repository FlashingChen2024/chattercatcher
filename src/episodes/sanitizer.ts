const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/-----BEGIN [^-]+ PRIVATE KEY-----[\s\S]*?-----END [^-]+ PRIVATE KEY-----/g, "[REDACTED_SECRET]"],
  [/(\bAuthorization\s*:\s*Bearer\s+)[A-Za-z0-9._~+/=-]{12,}/gi, "$1[REDACTED_SECRET]"],
  [/(https?:\/\/)[^\s/@:]+:[^\s/@]+@/gi, "$1[REDACTED_SECRET]@"],
  [/([?&](?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|password|session(?:id)?|client[_-]?secret)=)[^\s&，。；;]+/gi, "$1[REDACTED_SECRET]"],
  [/("(?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|password|session(?:id)?|client[_-]?secret|private[_-]?key)"\s*:\s*")[^"]+(")/gi, "$1[REDACTED_SECRET]$2"],
  [/(\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|password|session(?:id)?|client[_-]?secret)\s*[=:]\s*)[^\s;，。]+/gi, "$1[REDACTED_SECRET]"],
  [/\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{20,}\b/g, "[REDACTED_SECRET]"],
  [/\bxox[baprs]-[A-Za-z0-9-]{20,}\b/g, "[REDACTED_SECRET]"],
  [/\bsk-[A-Za-z0-9_-]{6,}\b/g, "[REDACTED_SECRET]"],
];

export function sanitizeEpisodeSummary(summary: string): string {
  let sanitized = summary;
  for (const [pattern, replacement] of SECRET_PATTERNS) {
    sanitized = sanitized.replace(pattern, replacement);
  }
  return sanitized;
}
