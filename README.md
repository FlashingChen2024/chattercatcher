# ChatterCatcher

ChatterCatcher 是一个本地优先的飞书/Lark 家庭群知识库机器人。它静默捕获家庭群里的消息和文件，在被 `@` 提问时先检索本地 RAG 证据，再用简短答案和可追溯引用回复。

它不是自主 Agent，不会替用户执行任意外部操作。它只做三件事：保存、检索、解释家庭知识。

## 当前能力

- 接收飞书/Lark 群消息。
- 普通群消息写入本地 SQLite，并进入本地 RAG 检索。
- `@` 机器人提问不会入库，避免污染知识库。
- 被 `@` 后立即反馈，随后基于检索证据回答。
- 回答引用来源，展示“谁在什么时候说了什么”。
- 支持本地文件导入：文本、Markdown、JSON、CSV、TSV、日志、DOCX、PDF。
- SQLite FTS 关键词检索和 LanceDB 向量检索并存。
- 提供 CLI、本地 Web UI、doctor 检查、导出/恢复和本地数据删除命令。

## 安装

要求 Node.js 20+。

```bash
npm install -g chattercatcher
```

安装后检查 CLI：

```bash
chattercatcher --help
```

## 快速开始

1. 在飞书开放平台创建自建应用。
2. 开通机器人能力，并把机器人拉进目标群。
3. 在事件订阅里选择长连接模式，订阅 `im.message.receive_v1`。
4. 配置 ChatterCatcher：

```bash
chattercatcher setup
```

5. 检查配置和在线连通性：

```bash
chattercatcher doctor --online
```

6. 启动飞书 Gateway 和本地 Web UI：

```bash
chattercatcher gateway start
```

默认 Web UI 监听：

```text
http://127.0.0.1:3878
```

## 常用命令

```bash
chattercatcher settings show
chattercatcher settings
chattercatcher doctor --online

chattercatcher gateway start
chattercatcher gateway status
chattercatcher gateway stop
chattercatcher gateway restart

chattercatcher process messages
chattercatcher index status
chattercatcher index rebuild

chattercatcher files add ./family-plan.pdf
chattercatcher files list
chattercatcher files jobs

chattercatcher export --out ./chattercatcher-export.json
chattercatcher restore ./chattercatcher-export.json
```

## 配置

配置文件默认保存在：

```text
~/.chattercatcher/
  config.json
  secrets.json
  data/
```

`config.json` 保存普通配置，例如飞书 App ID、模型 base URL、模型名、Web UI 端口和本地数据目录。

`secrets.json` 保存敏感值，例如飞书 App Secret、LLM API Key 和 Embedding API Key。不要把这个文件提交到 Git。

MVP 的 LLM 和 embedding provider 需要兼容 OpenAI API。

## 使用方式

普通群消息会静默入库。例如：

```text
编程课的时间改成了后天13:40
```

提问时在群里 `@` 机器人：

```text
@小陈 最近一次编程课是什么时候
```

机器人会先检索本地证据，再回答并给出引用。提问消息本身不会进入知识库。

## 隐私边界

- 默认本地部署。
- 默认 Web UI 只监听 `127.0.0.1`。
- 聊天记录、文件内容、OCR 和转写结果都视为隐私数据。
- API Key、App Secret 和 token 与普通配置分开保存。
- 导出功能不包含密钥。
- 回答必须基于 RAG 检索证据；检索不到证据时应说不知道。

## 开发

```bash
npm install
npm run lint
npm run typecheck
npm test
npm run build
```

本地运行开发版：

```bash
npm run dev -- --help
```

## 项目状态

ChatterCatcher 仍处于早期 MVP 阶段。当前重点是飞书/Lark、本地优先存储、可追溯 RAG 问答和简单运维。

