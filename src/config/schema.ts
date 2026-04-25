import os from "node:os";
import path from "node:path";
import { z } from "zod";

function defaultDataDir(): string {
  return path.join(process.env.CHATTERCATCHER_HOME || path.join(os.homedir(), ".chattercatcher"), "data");
}

export const appConfigSchema = z.object({
  feishu: z.object({
    domain: z.enum(["feishu", "lark"]).default("feishu"),
    appId: z.string().default(""),
    groupPolicy: z.enum(["open", "allowlist", "disabled"]).default("open"),
    requireMention: z.boolean().default(true),
  }),
  llm: z.object({
    baseUrl: z.string().url().or(z.literal("")).default(""),
    model: z.string().default(""),
  }),
  embedding: z.object({
    baseUrl: z.string().url().or(z.literal("")).default(""),
    model: z.string().default(""),
    dimension: z.number().int().positive().nullable().default(null),
  }),
  storage: z.object({
    dataDir: z.string().default(defaultDataDir),
  }),
  web: z.object({
    host: z.string().default("127.0.0.1"),
    port: z.number().int().min(1).max(65535).default(3878),
  }),
  schedules: z.object({
    indexing: z.string().default("*/10 * * * *"),
  }),
});

export const appSecretsSchema = z.object({
  feishu: z.object({
    appSecret: z.string().default(""),
  }),
  llm: z.object({
    apiKey: z.string().default(""),
  }),
  embedding: z.object({
    apiKey: z.string().default(""),
  }),
});

export type AppConfig = z.infer<typeof appConfigSchema>;
export type AppSecrets = z.infer<typeof appSecretsSchema>;

export function createDefaultConfig(): AppConfig {
  return appConfigSchema.parse({
    feishu: {},
    llm: {},
    embedding: {},
    storage: {},
    web: {},
    schedules: {},
  });
}

export function createDefaultSecrets(): AppSecrets {
  return appSecretsSchema.parse({
    feishu: {},
    llm: {},
    embedding: {},
  });
}
