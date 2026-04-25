#!/usr/bin/env node
import { input, password, select, confirm, number } from "@inquirer/prompts";
import { Command } from "commander";
import { loadConfig, loadSecrets, resetConfigFiles, saveConfig, saveSecrets, ensureConfigFiles, maskSecret } from "./config/store.js";
import { getChatterCatcherHome, getConfigPath, getSecretsPath } from "./config/paths.js";
import { getGatewayStatus } from "./gateway/index.js";
import { startWebServer } from "./web/server.js";

const program = new Command();

program
  .name("chattercatcher")
  .description("本地优先的飞书/Lark 家庭群知识机器人")
  .version("0.1.0");

program.command("setup").description("交互式初始化配置").action(async () => {
  const { config, secrets } = await ensureConfigFiles();

  config.feishu.domain = await select({
    message: "选择飞书区域",
    choices: [
      { name: "飞书（中国）", value: "feishu" as const },
      { name: "Lark（国际）", value: "lark" as const },
    ],
    default: config.feishu.domain,
  });
  config.feishu.appId = await input({ message: "飞书 App ID", default: config.feishu.appId });
  secrets.feishu.appSecret = await password({ message: "飞书 App Secret", mask: "*" });
  config.llm.baseUrl = await input({ message: "LLM Base URL（OpenAI-compatible）", default: config.llm.baseUrl });
  secrets.llm.apiKey = await password({ message: "LLM API Key", mask: "*" });
  config.llm.model = await input({ message: "Chat Model", default: config.llm.model });
  config.embedding.baseUrl = await input({
    message: "Embedding Base URL（留空则使用 LLM Base URL）",
    default: config.embedding.baseUrl || config.llm.baseUrl,
  });
  secrets.embedding.apiKey = await password({
    message: "Embedding API Key（留空则使用 LLM API Key）",
    mask: "*",
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

  if (!secrets.embedding.apiKey) {
    secrets.embedding.apiKey = secrets.llm.apiKey;
  }

  await saveConfig(config);
  await saveSecrets(secrets);
  console.log(`配置已保存：${getConfigPath()}`);
  console.log(`密钥已保存：${getSecretsPath()}`);
});

const settings = program.command("settings").description("查看或修改配置");

settings.action(async () => {
  const config = await loadConfig();
  const secrets = await loadSecrets();

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

program.command("doctor").description("检查本地配置状态").action(async () => {
  const config = await loadConfig();
  const secrets = await loadSecrets();
  const checks = [
    ["配置目录", getChatterCatcherHome()],
    ["飞书 App ID", config.feishu.appId ? "已配置" : "未配置"],
    ["飞书 App Secret", secrets.feishu.appSecret ? "已配置" : "未配置"],
    ["LLM Base URL", config.llm.baseUrl || "未配置"],
    ["LLM API Key", secrets.llm.apiKey ? "已配置" : "未配置"],
    ["Chat Model", config.llm.model || "未配置"],
    ["Embedding Model", config.embedding.model || "未配置"],
    ["RAG 模式", "强制：必须先检索证据再回答"],
    ["Web UI", `${config.web.host}:${config.web.port}`],
  ];

  for (const [name, value] of checks) {
    console.log(`${name}: ${value}`);
  }
});

const gateway = program.command("gateway").description("管理本地飞书 Gateway");

gateway.command("status").description("查看 Gateway 状态").action(async () => {
  const config = await loadConfig();
  console.log(JSON.stringify(getGatewayStatus(config), null, 2));
});

gateway.command("start").description("启动 Gateway（当前开发骨架会启动本地 Web UI）").action(async () => {
  const config = await loadConfig();
  console.log(getGatewayStatus(config).message);
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

index.command("status").description("查看索引状态").action(() => {
  console.log("索引模块尚未连接数据库；RAG 边界已实现，后续会接入 SQLite FTS 和本地向量库。");
});

index.command("rebuild").description("重建索引").action(() => {
  console.log("索引重建将在消息入库和向量库接入后实现。");
});

program.command("logs").description("查看日志").option("--follow", "持续输出日志").action((options: { follow?: boolean }) => {
  console.log(options.follow ? "日志跟随将在日志文件接入后实现。" : "日志查看将在日志文件接入后实现。");
});

program.command("export").description("导出本地数据").action(() => {
  console.log("导出将在本地数据库接入后实现。");
});

program.parseAsync().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
