import fs from "node:fs/promises";
import path from "node:path";
import {
  type AppConfig,
  type AppSecrets,
  appConfigSchema,
  appSecretsSchema,
  createDefaultConfig,
  createDefaultSecrets,
} from "./schema.js";
import { getChatterCatcherHome, getConfigPath, getSecretsPath } from "./paths.js";

async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return fallback;
    }

    throw error;
  }
}

async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function loadConfig(): Promise<AppConfig> {
  const raw = await readJsonFile(getConfigPath(), createDefaultConfig());
  return appConfigSchema.parse(raw);
}

export async function saveConfig(config: AppConfig): Promise<void> {
  await writeJsonFile(getConfigPath(), appConfigSchema.parse(config));
}

export async function loadSecrets(): Promise<AppSecrets> {
  const raw = await readJsonFile(getSecretsPath(), createDefaultSecrets());
  return appSecretsSchema.parse(raw);
}

export async function saveSecrets(secrets: AppSecrets): Promise<void> {
  await writeJsonFile(getSecretsPath(), appSecretsSchema.parse(secrets));
}

export async function ensureConfigFiles(): Promise<{ config: AppConfig; secrets: AppSecrets }> {
  await fs.mkdir(getChatterCatcherHome(), { recursive: true });
  const config = await loadConfig();
  const secrets = await loadSecrets();
  await saveConfig(config);
  await saveSecrets(secrets);
  return { config, secrets };
}

export async function resetConfigFiles(): Promise<void> {
  await saveConfig(createDefaultConfig());
  await saveSecrets(createDefaultSecrets());
}

export function maskSecret(value: string): string {
  if (!value) {
    return "";
  }

  if (value.length <= 8) {
    return "********";
  }

  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}
