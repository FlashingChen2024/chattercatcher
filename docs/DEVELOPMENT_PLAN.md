# Development Plan

## Strategy

Build ChatterCatcher from the narrowest useful loop:

```text
receive Feishu text -> store locally -> retrieve -> answer with citation
```

Only after that loop is reliable should the project expand into full file understanding, richer conflict resolution, and long-running operational polish.

## Milestone M1: Working Text Memory

Goal: ChatterCatcher can be installed, configured, connected to Feishu/Lark, and used for text-message question answering.

### Scope

- Project scaffold with TypeScript.
- Global npm CLI package.
- Interactive `chattercatcher setup`.
- Editable `chattercatcher settings`.
- Feishu/Lark gateway start/status/stop commands.
- Feishu long connection event receiver.
- Text message ingestion.
- SQLite metadata database.
- Local vector store.
- SQLite FTS keyword index.
- OpenAI-compatible chat provider.
- OpenAI-compatible embedding provider.
- Mention-triggered answer generation.
- Source citations.
- Basic conflict handling.
- Local Web UI with status, history, and settings.
- `chattercatcher doctor`.

### Acceptance Criteria

- `npm install -g chattercatcher` exposes the CLI.
- `chattercatcher setup` creates a usable local config.
- `chattercatcher gateway start` connects to Feishu/Lark.
- The bot receives group text messages.
- The bot stores message text, sender, chat, timestamp, and raw payload.
- `@ChatterCatcher` questions return concise answers with citations.
- Newer explicit updates are preferred over older facts.
- Ambiguous discussion is not treated as a confirmed update.
- Web UI is available on `http://127.0.0.1:<port>`.

### Self-Tests

- CLI setup dry run with temporary config directory.
- Feishu event payload fixture ingestion test.
- Retrieval test with known messages.
- Answer generation test with mocked LLM.
- Conflict resolver tests:
  - explicit update
  - casual suggestion
  - old fact with no replacement
- Web UI build test.

## Milestone M2: Files as Knowledge

Goal: Files, images, audio, and links become first-class searchable sources.

### Scope

- Feishu media/file downloader.
- File storage under local data directory.
- PDF parser.
- DOCX parser.
- XLSX parser.
- PPTX parser.
- Plain text and Markdown parser.
- Image OCR path.
- Audio transcription path.
- Link metadata extraction.
- Chunking pipeline.
- Indexing job queue.
- File library in Web UI.
- Reindex command.
- File citations.
- Multi-file question answering.

### Acceptance Criteria

- Files sent in group chat are downloaded and stored locally.
- Parsed file text is visible in indexing metadata.
- Failed parsing jobs are visible and retryable.
- Questions can be answered from file content.
- Answers cite file name and location when available.
- Multiple files can contribute to one answer.

### Self-Tests

- Parser fixture tests for each supported file type.
- OCR fixture test.
- Audio transcription mock test.
- Indexing retry test.
- Citation format test.
- Web UI file library build and interaction test.

## Milestone M3: Reliable Family Knowledge Base

Goal: ChatterCatcher becomes trustworthy enough for long-term family use.

### Scope

- Feishu cloud document sync.
- Fact extraction pipeline.
- Fact version history.
- Conflict explanation UI.
- Group-level and member-level configuration.
- Data deletion controls.
- Backup and restore.
- Scheduled summaries.
- Service installation:
  - Windows service
  - macOS launchd
  - Linux systemd
- Optional Docker deployment.
- Parser plugin interface.

### Acceptance Criteria

- Users can inspect why a fact is current.
- Superseded facts remain available as history.
- Users can delete selected local data.
- Data can be exported and restored.
- Gateway can run as a background service.
- Scheduled summaries can be configured from CLI or Web UI.

### Self-Tests

- Fact extraction and versioning tests.
- Backup and restore test.
- Service command dry-run tests.
- Group/member config tests.
- Data deletion tests.

## Backlog

- Additional chat platforms.
- Mobile-friendly Web UI.
- Local-only LLM and embedding defaults.
- Knowledge graph visualization.
- Browser extension for manual capture.
- Rich Feishu cards.
- Public package hardening.

## Release Discipline

Each milestone should end with:

- Passing automated tests.
- Manual smoke test notes.
- Updated documentation.
- One or more focused git commits.
- Versioned changelog entry once releases begin.

