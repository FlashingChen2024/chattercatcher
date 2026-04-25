export function applySecretInput(currentValue: string, nextValue: string | undefined): string {
  const trimmed = nextValue?.trim() ?? "";
  return trimmed ? trimmed : currentValue;
}

export function resolveEmbeddingApiKey(input: {
  currentEmbeddingKey: string;
  nextEmbeddingKey?: string;
  llmApiKey: string;
}): string {
  const explicit = applySecretInput(input.currentEmbeddingKey, input.nextEmbeddingKey);
  return explicit || input.llmApiKey;
}

