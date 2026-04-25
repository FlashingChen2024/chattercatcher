# ChatterCatcher Agent Guidelines

## Project Mission

ChatterCatcher is a local-first family knowledge bot for Feishu/Lark groups. Its job is to quietly capture important information from everyday chat, files, images, links, and audio, then answer questions with concise answers and traceable citations.

It is not an autonomous agent. It must not execute arbitrary external actions on behalf of users. The product exists to preserve, retrieve, and explain family knowledge.

## First Principles

Every design decision must be justified from these fundamentals:

1. Family information is scattered in casual conversation.
2. Retrieval without evidence is not trustworthy.
3. Newer information is often more useful, but only when it is clearly about the same fact.
4. Local ownership matters because family chat data is private.
5. Installation must be simple enough for one technical family member to maintain.
6. The bot should reduce interruption, not create another noisy participant.

When tradeoffs arise, optimize in this order:

1. Correctness and source traceability.
2. Privacy and local data control.
3. A working end-to-end MVP.
4. Operational simplicity.
5. Extensibility.

## Development Workflow

- Keep changes small and coherent.
- Finish one logical unit of work at a time.
- After every completed logical unit, run appropriate self-tests.
- After self-tests pass, create one git commit for that unit.
- Do not mix unrelated changes in one commit.
- Do not leave half-finished behavior hidden behind undocumented assumptions.

Required loop:

```text
understand -> implement -> self-test -> fix -> commit -> report
```

If tests cannot be run, document exactly why in the final response and in the commit message when relevant.

## Git Rules

- Commit after each completed task or milestone.
- Use concise conventional commit style where practical:
  - `docs: add product requirements`
  - `feat: add feishu gateway`
  - `fix: handle empty retrieval results`
  - `test: cover conflict resolution`
- Never rewrite or discard user changes unless explicitly requested.
- Before committing, check `git status --short`.
- A commit should include only files related to the completed task.

## Self-Test Requirements

Every code change must include a self-test appropriate to the risk:

- CLI changes: run the command locally or add/update automated tests.
- Gateway changes: verify startup, config loading, and graceful shutdown.
- Feishu integration changes: use mocks for unit tests and document any manual Feishu validation.
- RAG changes: test retrieval, citation presence, and empty-result behavior.
- Conflict resolution changes: test old/new facts, ambiguous discussion, and explicit update wording.
- File parsing changes: test at least one representative fixture for the touched format.
- Web UI changes: run build checks and inspect the affected page locally.

Minimum expected commands once the project is scaffolded:

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

If a command does not exist yet, either add it as part of project setup or explicitly state that the project has not reached that stage.

## Product Constraints

- Default deployment is local-first.
- Default Web UI bind address must be `127.0.0.1`.
- All answers must include citations unless the bot is explicitly saying it does not know.
- The bot must not treat casual suggestions as confirmed facts.
- The bot must preserve historical evidence when newer confirmed facts supersede older ones.
- Files are first-class knowledge sources, equivalent to chat messages.
- The first supported chat platform is Feishu/Lark only.
- LLM and embedding providers must use OpenAI-compatible APIs in the MVP.

## Architecture Constraints

- Runtime: Node.js 20+.
- Language: TypeScript.
- CLI-first product surface.
- Local metadata storage should start with SQLite.
- Vector storage should be local and RAG-friendly.
- Keyword retrieval should coexist with vector retrieval.
- Background jobs must be observable from CLI and Web UI.
- Avoid SaaS-only dependencies for core local operation.

## Documentation Rules

- Product decisions belong in `docs/PRD.md`.
- Milestones and implementation sequencing belong in `docs/DEVELOPMENT_PLAN.md`.
- Architecture and technical stack belong in `docs/TECHNICAL_ARCHITECTURE.md`.
- Update documentation when behavior or scope changes.
- Prefer concrete acceptance criteria over vague intent.

## Security and Privacy

- Do not log secrets.
- Do not print full API keys, App Secrets, or tokens.
- Store secrets separately from non-sensitive config.
- Treat chat history, files, OCR output, and transcripts as private data.
- Do not expose the local Web UI publicly by default.
- Any remote model call must be clear from configuration.

## Answer Quality Standard

Bot answers should be:

- Short.
- Direct.
- Evidence-backed.
- Clear about uncertainty.
- Explicit when newer information supersedes older information.

Bad answer:

```text
活动应该是 6 月 30 日。
```

Good answer:

```text
端午活动目前是 2026/6/30。来源：老妈在 2026-xx-xx 说“改成 2026/6/30”。此前 2026/5/30 是旧信息。
```

