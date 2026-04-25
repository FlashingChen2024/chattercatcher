# 开发计划

## 策略

从最小可用闭环开始：

```text
接收飞书文字 -> 本地保存 -> RAG 检索 -> 带引用回答
```

这个闭环稳定后，再扩展文件理解、冲突处理和长期运行能力。

## M1：可用的文字记忆

目标：ChatterCatcher 可以安装、配置、连接飞书/Lark，并对群聊文字消息进行问答。

### 范围

- TypeScript 项目脚手架。
- npm 全局 CLI 包。
- 交互式 `chattercatcher setup`。
- 可编辑的 `chattercatcher settings`。
- 飞书/Lark Gateway start/status/stop 命令。
- 飞书长连接事件接收。
- 文字消息入库。
- SQLite 元数据数据库。
- 本地向量库。
- SQLite FTS 关键词索引。
- OpenAI-compatible chat provider。
- OpenAI-compatible embedding provider。
- `@机器人` 触发回答。
- 来源引用。
- 基础冲突处理。
- 基础本地 Web UI：状态、历史、配置。
- `chattercatcher doctor`。

`doctor` 需要覆盖两类检查：

- 默认离线检查：配置目录、飞书配置完整性、SQLite、LanceDB、RAG 策略。
- 可选在线检查：`chattercatcher doctor --online` 调用 OpenAI-compatible chat 和 embedding 接口，确认模型连通性。

### 验收标准

- `npm install -g chattercatcher` 暴露 CLI。
- `chattercatcher setup` 生成可用本地配置。
- `chattercatcher gateway start` 能连接飞书/Lark。
- 机器人能接收群文字消息。
- 机器人保存消息文本、发送人、群、时间戳和原始 payload。
- `@ChatterCatcher` 提问能返回简短答案和引用。
- 明确的新信息优先于旧事实。
- 模糊讨论不会被当成确定更新。
- Web UI 可通过 `http://127.0.0.1:<port>` 访问。

### 自测

- CLI setup 使用临时配置目录 dry run。
- 飞书事件 payload fixture 入库测试。
- 已知消息检索测试。
- 使用 mock LLM 的答案生成测试。
- 冲突处理测试：
  - 明确更新。
  - 普通建议。
  - 旧事实没有替代。
- Web UI build 测试。

## M2：文件成为知识源

目标：文件、图片、语音、链接成为一等可检索来源。

### 范围

- 飞书媒体/文件下载。
- 文件保存到本地数据目录。
- PDF 解析。
- DOCX 解析。
- XLSX 解析。
- PPTX 解析。
- 纯文本和 Markdown 解析。
- 图片 OCR 路径。
- 语音转写路径。
- 链接元数据提取。
- chunking pipeline。
- 索引任务队列。
- Web UI 文件库。
- 重建索引命令。
- 文件引用。
- 多文件交叉问答。

### 验收标准

- 群里发送的文件会被下载并本地保存。
- 解析后的文件文本能在索引元数据中看到。
- 解析失败任务可见、可重试。
- 问题可以从文件内容中得到回答。
- 答案能引用文件名和可用位置。
- 多个文件可以共同参与一个答案。

### 自测

- 每种支持格式的 parser fixture 测试。
- OCR fixture 测试。
- 语音转写 mock 测试。
- 索引重试测试。
- 引用格式测试。
- Web UI 文件库构建和交互测试。

## M3：可信的家庭知识库

目标：ChatterCatcher 足够可靠，可以长期作为家庭记忆系统运行。

### 范围

- 飞书云文档同步。
- 事实抽取 pipeline。
- 事实版本历史。
- 冲突解释 UI。
- 群级和成员级配置。
- 数据删除控制。
- 备份和恢复。
- 定时摘要。
- 服务安装：
  - Windows service。
  - macOS launchd。
  - Linux systemd。
- 可选 Docker 部署。
- parser 插件接口。

### 验收标准

- 用户能检查某个事实为什么是当前版本。
- 被覆盖的旧事实仍作为历史保留。
- 用户能删除指定本地数据。
- 数据可以导出和恢复。
- Gateway 可以作为后台服务运行。
- 定时摘要可以通过 CLI 或 Web UI 配置。

### 自测

- 事实抽取和版本测试。
- 备份恢复测试。
- 服务命令 dry-run 测试。
- 群/成员配置测试。
- 数据删除测试。

## Backlog

- 更多聊天平台。
- 移动端友好的 Web UI。
- 本地 LLM 和 embedding 默认配置。
- 知识图谱可视化。
- 手动捕获浏览器扩展。
- 飞书富文本卡片。
- 公开 npm 包发布加固。

## 发布纪律

每个里程碑结束时必须有：

- 通过的自动化测试。
- 手工 smoke test 记录。
- 已更新的文档。
- 一个或多个聚焦的 git commit。
- 开始发版后维护 changelog。
