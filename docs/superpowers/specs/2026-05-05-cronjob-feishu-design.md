# CRONJob 飞书群定时消息设计

## 背景与目标

ChatterCatcher 已经支持飞书群消息入库、RAG 问答、飞书文本发送，以及分钟级 cron 调度能力。新功能要让用户在飞书群里 @ 机器人，用自然语言创建、查看、删除定时任务。任务到点后由 AI 基于任务提示词和已保存的群聊知识库生成纯文本消息，并发送回创建任务的同一个飞书群。

首版目标：

- AI 可在当前飞书群创建定时任务。
- AI 可列出当前飞书群的定时任务。
- AI 可按任务 ID 删除当前飞书群的定时任务。
- Gateway 运行时自动执行到期任务。
- WebUI 可查看和删除任务，用于审计和清理。

## 范围边界

首版不做以下能力：

- 暂停、恢复、修改任务。
- 跨群创建或管理任务。
- 一次性任务。
- 富文本卡片或图片消息。
- WebUI 创建任务表单。
- 完整 cron 语法解析。

## 数据模型

新增 SQLite 表 `cron_jobs`，用于持久化任务。建议字段：

- `id`：任务 ID。
- `chat_id`：飞书群 ID。
- `created_by_open_id`：创建者 open_id，可为空。
- `schedule`：5 段 cron 表达式。
- `prompt`：任务到点时用于生成消息的提示词。
- `status`：任务状态，首版使用 `active` / `deleted`。
- `last_run_at`：上次执行时间。
- `next_run_at`：下次预计执行时间。
- `last_error`：最近一次执行错误。
- `created_at`：创建时间。
- `updated_at`：更新时间。

所有 AI 工具操作都按当前飞书事件里的 `chat_id` 过滤。创建时只能写入当前群的 `chat_id`；查看和删除也只作用于当前群，避免跨群误操作。

## AI 工具交互

在飞书问答链路中，为 `FeishuQuestionHandler` 的 LLM 工具列表增加 CRONJob 工具：

1. `create_cron_job`
   - 输入：`schedule`、`prompt`。
   - 行为：在当前群创建 `active` 任务。
   - 输出：任务 ID、cron、prompt、下次执行时间。

2. `list_cron_jobs`
   - 输入：无必填参数。
   - 行为：返回当前群未删除任务列表。
   - 输出：任务 ID、cron、prompt、状态、上次执行时间、下次执行时间。

3. `delete_cron_job`
   - 输入：`id`。
   - 行为：仅当任务属于当前群时删除或标记为 `deleted`。
   - 输出：删除结果。

用户可以说“每天 9 点总结昨天群聊”，LLM 将自然语言时间转换成 cron，例如 `0 9 * * *`，再调用 `create_cron_job`。创建、查看、删除完成后，机器人用普通文本回复执行结果。

## 调度与执行

Gateway 启动时创建 `CronJobScheduler`。调度器每分钟扫描 SQLite 中 `status = active` 且 `next_run_at <= now` 的任务。同一个任务执行中不得重复启动。

任务执行流程：

1. 读取任务的 `prompt`、`chat_id`、`schedule`。
2. 调用 LLM 生成最终群消息。
3. 生成时提供系统上下文：这是飞书群定时消息，需要基于任务 prompt 和当前时间输出适合直接发送到群里的纯文本。
4. 复用现有 Agentic RAG 检索工具，让模型查询历史消息和会话记忆。
5. 使用 `FeishuMessageSender.sendTextToChat(chat_id, text)` 发送消息。
6. 发送成功后更新 `last_run_at`、`next_run_at`、`updated_at`，清空或保留历史错误按实现简化处理。
7. 执行失败时写入 `last_error` 和 `updated_at`，不删除任务，下次到期继续尝试。

## Cron 语法

首版支持 5 段 cron：分钟、小时、日、月、周。

语法沿用现有简化能力：

- 分钟字段支持 `*`、`*/N`、逗号列表、精确数字。
- 小时、日、月、周字段支持 `*` 或精确数字。

无效 cron 创建时直接返回错误，不创建任务。自然语言到 cron 的转换由 LLM 完成，工具层只接收 cron 字符串并验证。

## WebUI

WebUI 增加“定时任务 / CRONJob”区域，展示本地数据库中的任务列表。字段包括：

- 任务 ID。
- 群 ID。
- cron。
- prompt。
- 状态。
- 上次执行时间。
- 下次执行时间。
- 最近错误。

后端增加 API：

- `GET /api/cron-jobs`：返回任务列表。
- `DELETE /api/cron-jobs/:id`：按任务 ID 删除或标记删除。

WebUI 首版只支持查看和删除，不提供创建表单。任务创建仍通过飞书群里 @ 机器人完成。

## 错误处理

- 飞书配置不完整时，Gateway 启动应继续沿用现有配置校验行为。
- cron 无效时，AI 工具返回明确错误。
- 任务不存在或不属于当前群时，删除工具返回失败。
- LLM 生成失败、RAG 检索失败或飞书发送失败时，任务保留并记录 `last_error`。
- 调度器捕获单个任务错误，不影响其他任务执行。

## 测试策略

- 数据库迁移和 repository 测试：创建、列出、按群过滤、删除、错误记录。
- cron 解析和 next run 计算测试：覆盖有效和无效表达式。
- AI 工具测试：确保工具只能操作当前群任务。
- 调度器测试：到期执行、失败记录、并发去重、下一次执行时间更新。
- Web API 测试：列表和删除接口。
- WebUI 测试：页面渲染任务列表和删除操作。
