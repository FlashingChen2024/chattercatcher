# ChatterCatcher PRD

## Summary

ChatterCatcher is a local-first Feishu/Lark group bot for family use. It quietly listens to group chats, stores messages and files locally, builds a searchable knowledge base, and answers questions when mentioned.

The core promise is simple:

```text
Pull the bot into the family group. It remembers important chat and files. Ask it later and it answers with sources.
```

## Problem

Important family information is often published casually in group chat:

- event dates
- school or travel arrangements
- bills and payment details
- documents
- screenshots
- voice messages
- links
- changed plans

People forget where the information was posted and repeatedly ask the same family member to search manually. This is inefficient and annoying.

## Goals

- Capture family group information without manual tagging.
- Support text, files, images, links, audio, and Feishu document links.
- Store all data locally by default.
- Use LLMs for understanding, answering, summarization, and conflict handling.
- Use embeddings and retrieval so answers are grounded in collected evidence.
- Answer concise questions when users `@ChatterCatcher`.
- Provide citations for every factual answer.
- Preserve history when newer information supersedes older information.
- Provide an interactive CLI and a basic local Web UI.

## Non-Goals

- ChatterCatcher is not an autonomous agent.
- It does not execute arbitrary user tasks.
- It does not need multi-tenant SaaS behavior in the MVP.
- It does not need non-Feishu platforms in the MVP.
- It does not need public internet exposure.
- It does not need enterprise-grade permission management for the first family-use version.

## Target User

Primary user:

- One technical family member installs and maintains the service.

End users:

- Family members in Feishu/Lark groups who ask questions by mentioning the bot.

## Core User Stories

### Silent Capture

As a family member, I want the bot to silently capture messages and files in the group so I do not need to manually organize information.

Acceptance criteria:

- Bot receives Feishu group messages after being added to the group.
- Bot stores text messages with sender, group, timestamp, and raw platform metadata.
- Bot downloads supported media and files locally.
- Bot does not reply unless explicitly mentioned or configured otherwise.

### Question Answering

As a family member, I want to mention the bot and ask a natural-language question so I can find information quickly.

Acceptance criteria:

- `@ChatterCatcher 问题` triggers retrieval and answer generation.
- The answer is concise.
- The answer includes source citations.
- If there is insufficient evidence, the bot says it does not know.

### File Understanding

As a family member, I want files to be searchable and answerable like chat messages.

Acceptance criteria:

- PDF, Word, Excel, PowerPoint, text, Markdown, images, links, audio, and Feishu document links are captured.
- Parsed text is chunked, embedded, indexed, and linked back to the source file.
- Answers can cite file name and location such as page, sheet, or slide when available.

### Conflict Handling

As a family member, I want the bot to prefer newer confirmed information while preserving old context.

Acceptance criteria:

- Explicit updates supersede older facts about the same subject and predicate.
- Casual discussion, guesses, and proposals do not automatically supersede confirmed facts.
- The bot can mention old information when it is relevant to explain a change.

Example:

```text
Old: 活动 2026/5/30 举办。
New: 活动改到 2026/6/30。
Answer: 活动目前是 2026/6/30。此前 2026/5/30 是旧信息。
```

### Guided Setup

As the maintainer, I want `npm install -g chattercatcher` followed by an interactive setup command.

Acceptance criteria:

- `chattercatcher setup` guides Feishu, model, embedding, storage, schedule, and Web UI configuration.
- `chattercatcher settings` can edit and reset configuration.
- `chattercatcher doctor` validates Feishu credentials, model connectivity, embedding compatibility, and local storage.

## MVP Scope

MVP must include:

- Global npm package.
- Interactive CLI.
- Feishu/Lark self-built app connection.
- Local gateway using Feishu long connection.
- Local storage.
- Text message capture.
- RAG over captured messages.
- OpenAI-compatible chat model.
- OpenAI-compatible embedding model.
- Mention-triggered answer generation.
- Citations.
- Basic conflict handling.
- Basic local Web UI.

MVP should defer:

- Deep Feishu cloud document sync.
- Advanced permissions.
- Multi-platform support.
- Cloud deployment.
- Complex autonomous workflows.

## Product Commands

Required CLI commands:

```bash
chattercatcher setup
chattercatcher settings
chattercatcher settings reset
chattercatcher gateway start
chattercatcher gateway stop
chattercatcher gateway restart
chattercatcher gateway status
chattercatcher logs
chattercatcher logs --follow
chattercatcher index status
chattercatcher index rebuild
chattercatcher web start
chattercatcher doctor
chattercatcher export
```

## Web UI Requirements

The local Web UI should expose:

- Gateway status.
- Feishu connection state.
- LLM and embedding configuration status.
- Recent group messages.
- Group chat history.
- File library.
- Indexing jobs.
- Question-answer logs.
- Settings editor.
- Reindex and export actions.

Default bind address:

```text
127.0.0.1
```

## Privacy Requirements

- Store data locally by default.
- Do not expose Web UI publicly by default.
- Separate secrets from non-sensitive configuration.
- Do not log secrets.
- Allow future deletion of group, message, and file data.

## Feishu/Lark Integration

MVP integration model:

- User creates a Feishu/Lark self-built app.
- User enables bot capability.
- User configures required permissions.
- User enables long connection event subscription.
- User subscribes to message receive events.
- ChatterCatcher gateway connects locally through the Feishu/Lark SDK.

The setup should be inspired by OpenClaw's gateway pattern: local gateway, App ID/App Secret config, long connection event delivery, group mention trigger, and CLI-visible status.

## Success Metrics

For the family MVP:

- Installation can be completed by one technical user in under 30 minutes.
- Bot can answer at least 80% of straightforward factual questions from recent chat history with citations.
- Bot does not answer confidently when retrieval evidence is missing.
- Gateway can run for multiple days without manual restart.
- Reindexing can recover from parser or embedding failures.

