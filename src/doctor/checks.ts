import fs from "node:fs/promises";
import type { AppConfig, AppSecrets } from "../config/schema.js";
import { getChatterCatcherHome } from "../config/paths.js";
import { getDatabasePath, openDatabase } from "../db/database.js";
import { getGatewayStatus } from "../gateway/index.js";
import { createChatModel, createEmbeddingModel } from "../llm/openai-compatible.js";
import { MessageRepository } from "../messages/repository.js";
import { getLanceDbPath, LanceDbVectorStore } from "../rag/lancedb-store.js";
import { hasEmbeddingConfig } from "../rag/factory.js";

export type DoctorStatus = "pass" | "warn" | "fail";

export interface DoctorCheck {
  name: string;
  status: DoctorStatus;
  message: string;
}

export interface DoctorOptions {
  online?: boolean;
}

function pass(name: string, message: string): DoctorCheck {
  return { name, status: "pass", message };
}

function warn(name: string, message: string): DoctorCheck {
  return { name, status: "warn", message };
}

function fail(name: string, message: string): DoctorCheck {
  return { name, status: "fail", message };
}

export async function runDoctor(
  config: AppConfig,
  secrets: AppSecrets,
  options: DoctorOptions = {},
): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [];

  checks.push(await checkHomeDirectory());
  checks.push(checkFeishu(config, secrets));
  checks.push(checkLlmConfig(config, secrets));
  checks.push(checkEmbeddingConfig(config, secrets));
  checks.push(await checkSqlite(config));
  checks.push(await checkLanceDb(config));
  checks.push(checkRagPolicy());

  if (options.online) {
    checks.push(await checkChatModel(config, secrets));
    checks.push(await checkEmbeddingModel(config, secrets));
  }

  return checks;
}

async function checkHomeDirectory(): Promise<DoctorCheck> {
  const home = getChatterCatcherHome();
  try {
    await fs.mkdir(home, { recursive: true });
    await fs.access(home);
    return pass("配置目录", home);
  } catch (error) {
    return fail("配置目录", error instanceof Error ? error.message : String(error));
  }
}

function checkFeishu(config: AppConfig, secrets: AppSecrets): DoctorCheck {
  const status = getGatewayStatus(config, secrets);
  if (status.configured) {
    return pass("飞书 Gateway", status.message);
  }

  return warn("飞书 Gateway", status.message);
}

function checkLlmConfig(config: AppConfig, secrets: AppSecrets): DoctorCheck {
  if (!config.llm.baseUrl || !config.llm.model || !secrets.llm.apiKey) {
    return warn("LLM 配置", "未配置完整；@ 提问时无法生成模型回答。");
  }

  return pass("LLM 配置", `${config.llm.model} @ ${config.llm.baseUrl}`);
}

function checkEmbeddingConfig(config: AppConfig, secrets: AppSecrets): DoctorCheck {
  if (!hasEmbeddingConfig(config, secrets)) {
    return warn("Embedding 配置", "未配置完整；RAG 会使用 SQLite FTS，无法使用 LanceDB 语义检索。");
  }

  return pass("Embedding 配置", `${config.embedding.model} @ ${config.embedding.baseUrl || config.llm.baseUrl}`);
}

async function checkSqlite(config: AppConfig): Promise<DoctorCheck> {
  let database: ReturnType<typeof openDatabase> | null = null;
  try {
    database = openDatabase(config);
    const messages = new MessageRepository(database);
    return pass("SQLite", `${getDatabasePath(config)}；messages=${messages.getMessageCount()}`);
  } catch (error) {
    return fail("SQLite", error instanceof Error ? error.message : String(error));
  } finally {
    database?.close();
  }
}

async function checkLanceDb(config: AppConfig): Promise<DoctorCheck> {
  let store: LanceDbVectorStore | null = null;
  try {
    store = await LanceDbVectorStore.connectFromConfig(config);
    const count = await store.count();
    return pass("LanceDB", `${getLanceDbPath(config)}；vectors=${count}`);
  } catch (error) {
    return fail("LanceDB", error instanceof Error ? error.message : String(error));
  } finally {
    store?.close();
  }
}

function checkRagPolicy(): DoctorCheck {
  return pass("RAG 策略", "强制先检索证据再回答；禁止全量上下文堆叠。");
}

async function checkChatModel(config: AppConfig, secrets: AppSecrets): Promise<DoctorCheck> {
  if (!config.llm.baseUrl || !config.llm.model || !secrets.llm.apiKey) {
    return warn("LLM 连通性", "跳过：LLM 配置不完整。");
  }

  try {
    const answer = await createChatModel(config, secrets).complete([
      { role: "user", content: "Reply with OK only." },
    ]);
    return pass("LLM 连通性", answer.slice(0, 80));
  } catch (error) {
    return fail("LLM 连通性", error instanceof Error ? error.message : String(error));
  }
}

async function checkEmbeddingModel(config: AppConfig, secrets: AppSecrets): Promise<DoctorCheck> {
  if (!hasEmbeddingConfig(config, secrets)) {
    return warn("Embedding 连通性", "跳过：Embedding 配置不完整。");
  }

  try {
    const vector = await createEmbeddingModel(config, secrets).embed("chattercatcher doctor");
    if (vector.length === 0) {
      return fail("Embedding 连通性", "返回向量为空。");
    }

    return pass("Embedding 连通性", `dimension=${vector.length}`);
  } catch (error) {
    return fail("Embedding 连通性", error instanceof Error ? error.message : String(error));
  }
}

export function formatDoctorChecks(checks: DoctorCheck[]): string {
  const icon: Record<DoctorStatus, string> = {
    pass: "PASS",
    warn: "WARN",
    fail: "FAIL",
  };

  return checks.map((check) => `[${icon[check.status]}] ${check.name}: ${check.message}`).join("\n");
}

