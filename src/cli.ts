#!/usr/bin/env node
import { input, password, select, confirm, number } from "@inquirer/prompts";
import { Command } from "commander";
import fs from "node:fs/promises";
import type { AppConfig, AppSecrets } from "./config/schema.js";
import { loadConfig, loadSecrets, resetConfigFiles, saveConfig, saveSecrets, ensureConfigFiles, maskSecret } from "./config/store.js";
import { applySecretInput, resolveEmbeddingApiKey } from "./config/update.js";
import { getChatterCatcherHome, getConfigPath, getSecretsPath } from "./config/paths.js";
import { getDatabasePath, openDatabase } from "./db/database.js";
import { formatDoctorChecks, runDoctor } from "./doctor/checks.js";
import { createFeishuGateway } from "./feishu/gateway.js";
import type { FeishuReceiveMessageEvent } from "./feishu/normalize.js";
import { FeishuQuestionHandler } from "./feishu/question.js";
import { FeishuResourceDownloader } from "./feishu/resource-downloader.js";
import { FeishuMessageSender } from "./feishu/sender.js";
import { ingestLocalFile } from "./files/ingest.js";
import { GatewayIngestor } from "./gateway/ingest.js";
import { getGatewayStatus } from "./gateway/index.js";
import { createChatModel, createEmbeddingModel } from "./llm/openai-compatible.js";
import { MessageRepository } from "./messages/repository.js";
import { createHybridRetriever, hasEmbeddingConfig } from "./rag/factory.js";
import { indexMessageChunks } from "./rag/indexer.js";
import { getLanceDbPath, LanceDbVectorStore } from "./rag/lancedb-store.js";
import { askWithRag } from "./rag/qa-service.js";
import { startWebServer } from "./web/server.js";

const program = new Command();

async function promptForConfiguration(config: AppConfig, secrets: AppSecrets): Promise<void> {
  config.feishu.domain = await select({
    message: "选择飞书区域",
    choices: [
      { name: "飞书（中国）", value: "feishu" as const },
      { name: "Lark（国际）", value: "lark" as const },
    ],
    default: config.feishu.domain,
  });
  config.feishu.appId = await input({ message: "飞书 App ID", default: config.feishu.appId });
  secrets.feishu.appSecret = applySecretInput(
    secrets.feishu.appSecret,
    await password({ message: secrets.feishu.appSecret ? "飞书 App Secret（留空保留）" : "飞书 App Secret", mask: "*" }),
  );

  config.llm.baseUrl = await input({ message: "LLM Base URL（OpenAI-compatible）", default: config.llm.baseUrl });
  secrets.llm.apiKey = applySecretInput(
    secrets.llm.apiKey,
    await password({ message: secrets.llm.apiKey ? "LLM API Key（留空保留）" : "LLM API Key", mask: "*" }),
  );
  config.llm.model = await input({ message: "Chat Model", default: config.llm.model });

  config.embedding.baseUrl = await input({
    message: "Embedding Base URL（留空则使用 LLM Base URL）",
    default: config.embedding.baseUrl || config.llm.baseUrl,
  });
  secrets.embedding.apiKey = resolveEmbeddingApiKey({
    currentEmbeddingKey: secrets.embedding.apiKey,
    nextEmbeddingKey: await password({
      message: secrets.embedding.apiKey ? "Embedding API Key（留空保留）" : "Embedding API Key（留空则使用 LLM API Key）",
      mask: "*",
    }),
    llmApiKey: secrets.llm.apiKey,
  });
  config.embedding.model = await input({ message: "Embedding Model", default: config.embedding.model });
  const dimension = await number({
    message: "Embedding 维度（不知道可先留空）",
    default: config.embedding.dimension ?? undefined,
    required: false,
  });
  config.embedding.dimension = dimension ?? null;

  config.web.port =
    (await number({ message: "Web UI 端口", default: config.web.port, required: true })) ?? config.web.port;
  config.feishu.requireMention = await confirm({
    message: "群聊回答是否要求 @ChatterCatcher？",
    default: config.feishu.requireMention,
  });
}

function printSettings(config: AppConfig, secrets: AppSecrets): void {
  console.log(JSON.stringify(
    {
      home: getChatterCatcherHome(),
      config,
      secrets: {
        feishu: { appSecret: maskSecret(secrets.feishu.appSecret) },
        llm: { apiKey: maskSecret(secrets.llm.apiKey) },
        embedding: { apiKey: maskSecret(secrets.embedding.apiKey) },
      },
    },
    null,
    2,
  ));
}

program
  .name("chattercatcher")
  .description("本地优先的飞书/Lark 家庭群知识机器人")
  .version("0.1.0");

program.command("setup").description("交互式初始化配置").action(async () => {
  const { config, secrets } = await ensureConfigFiles();
  await promptForConfiguration(config, secrets);
  await saveConfig(config);
  await saveSecrets(secrets);
  console.log(`配置已保存：${getConfigPath()}`);
  console.log(`密钥已保存：${getSecretsPath()}`);
});

const settings = program.command("settings").description("查看或修改配置");

settings.action(async () => {
  const { config, secrets } = await ensureConfigFiles();
  await promptForConfiguration(config, secrets);
  await saveConfig(config);
  await saveSecrets(secrets);
  console.log(`配置已更新：${getConfigPath()}`);
  console.log(`密钥已更新：${getSecretsPath()}`);
});

settings.command("show").description("查看当前配置（密钥脱敏）").action(async () => {
  printSettings(await loadConfig(), await loadSecrets());
});

settings.command("reset").description("重置本地配置和密钥").action(async () => {
  const shouldReset = await confirm({ message: "确认重置 ChatterCatcher 配置？", default: false });
  if (!shouldReset) {
    console.log("已取消。");
    return;
  }

  await resetConfigFiles();
  console.log("配置已重置。");
});

program.command("doctor").description("检查本地配置、存储和可选在线连通性").option("--online", "检查 LLM 和 Embedding 接口连通性").action(async (options: { online?: boolean }) => {
  const config = await loadConfig();
  const secrets = await loadSecrets();
  const checks = await runDoctor(config, secrets, { online: options.online });
  console.log(formatDoctorChecks(checks));
});

const gateway = program.command("gateway").description("管理本地飞书 Gateway");

gateway.command("status").description("查看 Gateway 状态").action(async () => {
  const config = await loadConfig();
  const secrets = await loadSecrets();
  console.log(JSON.stringify(getGatewayStatus(config, secrets), null, 2));
});

gateway.command("start").description("启动飞书长连接 Gateway 和本地 Web UI").action(async () => {
  const config = await loadConfig();
  const secrets = await loadSecrets();
  const status = getGatewayStatus(config, secrets);
  if (!status.configured) {
    console.log(status.message);
    console.log("本地 Web UI 仍会启动，方便继续配置。");
    await startWebServer(config);
    return;
  }

  const database = openDatabase(config);
  const gatewayRuntime = createFeishuGateway({
    config,
    secrets,
    ingestor: new GatewayIngestor(database),
    resourceDownloader: FeishuResourceDownloader.fromConfig(config, secrets),
    questionHandler: new FeishuQuestionHandler({
      config,
      secrets,
      database,
      sender: FeishuMessageSender.fromConfig(config, secrets),
      model: createChatModel(config, secrets),
    }),
  });

  process.on("SIGINT", () => {
    gatewayRuntime.stop();
    database.close();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    gatewayRuntime.stop();
    database.close();
    process.exit(0);
  });

  console.log(status.message);
  await gatewayRuntime.start();
  await startWebServer(config);
});

gateway.command("stop").description("停止 Gateway").action(() => {
  console.log("当前开发骨架尚未安装后台服务；请在运行 gateway 的终端按 Ctrl+C 停止。");
});

gateway.command("restart").description("重启 Gateway").action(() => {
  console.log("当前开发骨架尚未安装后台服务；请先停止进程，再运行 chattercatcher gateway start。");
});

const web = program.command("web").description("管理本地 Web UI");

web.command("start").description("启动本地 Web UI").action(async () => {
  const config = await loadConfig();
  await startWebServer(config);
});

const index = program.command("index").description("管理 RAG 索引");

index.command("status").description("查看索引状态").action(async () => {
  const config = await loadConfig();
  const secrets = await loadSecrets();
  const database = openDatabase(config);
  const messages = new MessageRepository(database);
  const vectorStore = await LanceDbVectorStore.connectFromConfig(config);
  const vectors = await vectorStore.count();
  console.log(JSON.stringify(
    {
      database: getDatabasePath(config),
      vectorDatabase: getLanceDbPath(config),
      chats: messages.getChatCount(),
      messages: messages.getMessageCount(),
      vectors,
      retrieval: {
        keyword: "SQLite FTS5",
        vector: hasEmbeddingConfig(config, secrets) ? "LanceDB 已可用于语义检索" : "LanceDB 已接入；需配置 embedding 后启用语义检索",
        hybrid: "启用：SQLite FTS + LanceDB Vector",
        rag: "强制先检索证据再回答，禁止全量上下文堆叠",
      },
    },
    null,
    2,
  ));
  vectorStore.close();
  database.close();
});

index.command("rebuild").description("重建 LanceDB 向量索引").option("--limit <number>", "最多索引的 chunk 数", "10000").action(async (options: { limit: string }) => {
  const config = await loadConfig();
  const secrets = await loadSecrets();

  if (!hasEmbeddingConfig(config, secrets)) {
    console.log("Embedding 配置不完整，无法重建向量索引。请运行 chattercatcher setup 或 chattercatcher settings。");
    return;
  }

  const database = openDatabase(config);
  const vectorStore = await LanceDbVectorStore.connectFromConfig(config);

  try {
    const stats = await indexMessageChunks({
      messages: new MessageRepository(database),
      embedding: createEmbeddingModel(config, secrets),
      store: vectorStore,
      limit: Number(options.limit),
    });
    console.log(`向量索引完成：chunks=${stats.chunks}, vectors=${stats.vectors}`);
  } finally {
    vectorStore.close();
    database.close();
  }
});

const files = program.command("files").description("管理本地文件知识源");

files
  .command("add")
  .description("把本地文本类文件保存到数据目录并写入 RAG 知识库")
  .argument("<paths...>", "文件路径，支持 txt、md、json、csv、tsv、log")
  .action(async (paths: string[]) => {
    const config = await loadConfig();
    const database = openDatabase(config);
    const messages = new MessageRepository(database);

    try {
      for (const filePath of paths) {
        const result = await ingestLocalFile({ config, messages, filePath });
        console.log(`已导入文件：${result.fileName}，字符数=${result.characters}，消息ID=${result.messageId}`);
      }
      console.log("文件已进入 SQLite FTS 检索；如已配置 embedding，可运行 chattercatcher index rebuild 更新 LanceDB 向量索引。");
    } finally {
      database.close();
    }
  });

files
  .command("list")
  .description("查看已进入 RAG 的本地文件")
  .option("--limit <number>", "最多显示的文件数", "50")
  .action(async (options: { limit: string }) => {
    const config = await loadConfig();
    const database = openDatabase(config);
    const messages = new MessageRepository(database);
    const limit = Number(options.limit);

    try {
      const files = messages.listFiles(Number.isFinite(limit) ? limit : 50);
      if (files.length === 0) {
        console.log("还没有文件。可运行 chattercatcher files add <path...> 导入文本类文件。");
        return;
      }

      for (const file of files) {
        console.log(`${file.fileName} | 字符数=${file.characters} | 导入时间=${file.importedAt}`);
        if (file.storedPath) {
          console.log(`  本地保存：${file.storedPath}`);
        }
      }
    } finally {
      database.close();
    }
  });

program.command("logs").description("查看日志").option("--follow", "持续输出日志").action((options: { follow?: boolean }) => {
  console.log(options.follow ? "日志跟随将在日志文件接入后实现。" : "日志查看将在日志文件接入后实现。");
});

program.command("export").description("导出本地数据").action(() => {
  console.log("导出将在本地数据库接入后实现。");
});

const dev = program.command("dev").description("开发调试命令");

dev
  .command("ingest-message")
  .description("写入一条本地测试消息")
  .requiredOption("--text <text>", "消息文本")
  .option("--chat <name>", "群名", "家庭群")
  .option("--sender <name>", "发送人", "测试用户")
  .action(async (options: { text: string; chat: string; sender: string }) => {
    const config = await loadConfig();
    const database = openDatabase(config);
    const messages = new MessageRepository(database);
    const now = new Date().toISOString();
    const id = messages.ingest({
      platform: "dev",
      platformChatId: options.chat,
      chatName: options.chat,
      platformMessageId: `dev-${Date.now()}`,
      senderId: options.sender,
      senderName: options.sender,
      messageType: "text",
      text: options.text,
      sentAt: now,
      rawPayload: { dev: true },
    });

    console.log(`已写入消息：${id}`);
    database.close();
  });

dev
  .command("ingest-feishu-event")
  .description("从 JSON 文件模拟写入一条飞书消息事件")
  .requiredOption("--file <path>", "飞书事件 JSON 文件")
  .action(async (options: { file: string }) => {
    const config = await loadConfig();
    const database = openDatabase(config);

    try {
      const raw = await fs.readFile(options.file, "utf8");
      const payload = JSON.parse(raw) as FeishuReceiveMessageEvent;
      const result = new GatewayIngestor(database).ingestFeishuEvent(payload);

      if (!result.accepted) {
        console.log(result.reason);
        return;
      }

      console.log(`已写入飞书消息：${result.messageId}`);
    } finally {
      database.close();
    }
  });

dev
  .command("search")
  .description("通过本地 FTS 检索测试 RAG 证据")
  .argument("<question>", "检索问题")
  .action(async (question: string) => {
    const config = await loadConfig();
    const secrets = await loadSecrets();
    const database = openDatabase(config);
    const { retriever, close } = await createHybridRetriever({
      config,
      secrets,
      messages: new MessageRepository(database),
    });
    const evidence = await retriever.retrieve(question);

    if (evidence.length === 0) {
      console.log("没有检索到证据。");
      close();
      database.close();
      return;
    }

    console.log(JSON.stringify(evidence, null, 2));
    close();
    database.close();
  });

dev
  .command("ask")
  .description("通过本地检索证据调用 LLM 回答")
  .argument("<question>", "问题")
  .action(async (question: string) => {
    const config = await loadConfig();
    const secrets = await loadSecrets();
    const database = openDatabase(config);
    const { retriever, close } = await createHybridRetriever({
      config,
      secrets,
      messages: new MessageRepository(database),
    });

    try {
      const result = await askWithRag({
        question,
        retriever,
        model: createChatModel(config, secrets),
      });

      console.log(result.answer);
      if (result.citations.length > 0) {
        console.log("\n引用：");
        for (const citation of result.citations) {
          const source = citation.source;
          console.log(`- [${citation.marker}] ${source.label}${source.sender ? `，${source.sender}` : ""}${source.timestamp ? `，${source.timestamp}` : ""}`);
        }
      }
    } finally {
      close();
      database.close();
    }
  });

program.parseAsync().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
