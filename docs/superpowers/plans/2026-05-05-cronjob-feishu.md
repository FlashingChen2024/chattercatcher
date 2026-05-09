# CRONJob Feishu Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build AI-managed CRONJob tasks that let Feishu users create, list, and delete current-group scheduled AI messages, execute them through Gateway, and inspect/delete them in WebUI.

**Architecture:** Add a SQLite-backed `cron_jobs` domain with a focused repository and shared cron parser. Expose current-chat-scoped tools to `FeishuQuestionHandler`, run due jobs from Gateway with a dedicated scheduler, and add Web API/UI read/delete surfaces. Execution reuses existing Agentic RAG search tools and Feishu text sender.

**Tech Stack:** TypeScript, Node.js, better-sqlite3, Vitest, Fastify, Feishu/Lark SDK, OpenAI-compatible chat tool calling.

---

## File Structure

- Create `src/cron/schedule.ts`: shared 5-field cron validation, due matching, and next-run calculation.
- Create `tests/cron/schedule.test.ts`: unit tests for supported cron syntax and next-run behavior.
- Create `src/cron/jobs.ts`: SQLite repository for `cron_jobs` records.
- Create `tests/cron/jobs.test.ts`: repository tests for create/list/filter/delete/due/failure state.
- Modify `src/db/database.ts`: add `cron_jobs` table and indexes.
- Create `src/cron/tools.ts`: current-chat-scoped LLM tools for create/list/delete.
- Create `tests/cron/tools.test.ts`: tool behavior tests for validation and chat scoping.
- Modify `src/feishu/question.ts`: append CRONJob tools to the existing RAG tools and execute all tools in one tool loop.
- Create `tests/feishu/question-cron-tools.test.ts`: integration-style tests proving Feishu mentions can create/list/delete jobs.
- Create `src/cron/generator.ts`: generate final scheduled message text with Agentic RAG.
- Create `tests/cron/generator.test.ts`: generation tests covering RAG invocation and output shaping.
- Create `src/cron/scheduler.ts`: minute-based due-job runner with non-overlap and failure recording.
- Create `tests/cron/scheduler.test.ts`: scheduler tests for due execution, errors, next-run updates, and concurrency.
- Modify `src/feishu/gateway.ts`: wire the CRONJob scheduler lifecycle into Gateway.
- Modify `src/cli.ts`: pass cron dependencies when building Gateway foreground runtime.
- Modify `src/web/server.ts`: add cron repository, `/api/cron-jobs`, `/api/cron-jobs/:id`, and WebUI section.
- Modify `tests/web/server.test.ts`: cover cron API and homepage rendering.
- Modify `src/index.ts`: export cron modules needed by consumers.

## Current Baseline

From worktree `/Users/flashingchen/Coding/VibeCoding/ChatterCatcher/.claude/worktrees/cronjob-feishu`:

- Initial `npm test` fails until `dist/cli.js` exists, because `tests/release/package-artifacts.test.ts` checks built package artifacts.
- Baseline command passes after build:

```bash
npm run build && npm test && npm run typecheck
```

Expected output includes:

```text
Test Files  48 passed (48)
Tests  181 passed (181)
```

---

### Task 1: Shared cron schedule utility

**Files:**
- Create: `src/cron/schedule.ts`
- Create: `tests/cron/schedule.test.ts`

- [ ] **Step 1: Write the failing cron schedule tests**

Create `tests/cron/schedule.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { getNextCronRun, isValidCronSchedule, matchesCronSchedule } from "../../src/cron/schedule.js";

describe("cron schedule utility", () => {
  it("validates supported five-field cron syntax", () => {
    expect(isValidCronSchedule("0 9 * * *")).toBe(true);
    expect(isValidCronSchedule("*/15 * * * *")).toBe(true);
    expect(isValidCronSchedule("0,30 8 * * 1")).toBe(true);
    expect(isValidCronSchedule("0 24 * * *")).toBe(false);
    expect(isValidCronSchedule("bad cron")).toBe(false);
    expect(isValidCronSchedule("0 9 * * * *")).toBe(false);
  });

  it("matches supported schedules against a date", () => {
    expect(matchesCronSchedule("0 9 * * *", new Date("2026-05-05T09:00:00.000Z"))).toBe(true);
    expect(matchesCronSchedule("0 9 * * *", new Date("2026-05-05T09:01:00.000Z"))).toBe(false);
    expect(matchesCronSchedule("*/10 * * * *", new Date("2026-05-05T09:20:00.000Z"))).toBe(true);
    expect(matchesCronSchedule("5,35 * * * *", new Date("2026-05-05T09:35:00.000Z"))).toBe(true);
    expect(matchesCronSchedule("5,35 * * * *", new Date("2026-05-05T09:36:00.000Z"))).toBe(false);
  });

  it("calculates the next matching minute after a reference time", () => {
    expect(getNextCronRun("0 9 * * *", new Date("2026-05-05T08:58:30.000Z"))?.toISOString()).toBe(
      "2026-05-05T09:00:00.000Z",
    );
    expect(getNextCronRun("*/15 * * * *", new Date("2026-05-05T09:14:59.000Z"))?.toISOString()).toBe(
      "2026-05-05T09:15:00.000Z",
    );
    expect(getNextCronRun("0 9 * * *", new Date("2026-05-05T09:00:00.000Z"))?.toISOString()).toBe(
      "2026-05-06T09:00:00.000Z",
    );
  });

  it("returns null for invalid schedules", () => {
    expect(getNextCronRun("bad cron", new Date("2026-05-05T09:00:00.000Z"))).toBeNull();
    expect(matchesCronSchedule("bad cron", new Date("2026-05-05T09:00:00.000Z"))).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- tests/cron/schedule.test.ts
```

Expected: FAIL with an import error for `../../src/cron/schedule.js`.

- [ ] **Step 3: Implement the cron schedule utility**

Create `src/cron/schedule.ts`:

```ts
interface ParsedCronSchedule {
  minute: FieldMatcher;
  hour: FieldMatcher;
  dayOfMonth: FieldMatcher;
  month: FieldMatcher;
  dayOfWeek: FieldMatcher;
}

type FieldMatcher = (value: number) => boolean;

export function isValidCronSchedule(schedule: string): boolean {
  return parseCronSchedule(schedule) !== null;
}

export function matchesCronSchedule(schedule: string, date: Date): boolean {
  const parsed = parseCronSchedule(schedule);
  if (!parsed) {
    return false;
  }

  return matchesParsedSchedule(parsed, date);
}

export function getNextCronRun(schedule: string, after: Date): Date | null {
  const parsed = parseCronSchedule(schedule);
  if (!parsed) {
    return null;
  }

  const candidate = new Date(after);
  candidate.setSeconds(0, 0);
  candidate.setMinutes(candidate.getMinutes() + 1);

  const maxMinutes = 366 * 24 * 60;
  for (let i = 0; i < maxMinutes; i += 1) {
    if (matchesParsedSchedule(parsed, candidate)) {
      return new Date(candidate);
    }
    candidate.setMinutes(candidate.getMinutes() + 1);
  }

  return null;
}

function matchesParsedSchedule(schedule: ParsedCronSchedule, date: Date): boolean {
  return (
    schedule.minute(date.getMinutes()) &&
    schedule.hour(date.getHours()) &&
    schedule.dayOfMonth(date.getDate()) &&
    schedule.month(date.getMonth() + 1) &&
    schedule.dayOfWeek(date.getDay())
  );
}

function parseCronSchedule(schedule: string): ParsedCronSchedule | null {
  const fields = schedule.trim().split(/\s+/);
  if (fields.length !== 5) {
    return null;
  }

  const minute = parseMinuteField(fields[0]);
  const hour = parseExactOrWildcardField(fields[1], 0, 23);
  const dayOfMonth = parseExactOrWildcardField(fields[2], 1, 31);
  const month = parseExactOrWildcardField(fields[3], 1, 12);
  const dayOfWeek = parseExactOrWildcardField(fields[4], 0, 6);

  if (!minute || !hour || !dayOfMonth || !month || !dayOfWeek) {
    return null;
  }

  return { minute, hour, dayOfMonth, month, dayOfWeek };
}

function parseMinuteField(field: string): FieldMatcher | null {
  if (field === "*") {
    return () => true;
  }

  const stepMatch = /^\*\/(\d+)$/.exec(field);
  if (stepMatch) {
    const step = Number(stepMatch[1]);
    if (!Number.isInteger(step) || step <= 0 || step > 59) {
      return null;
    }

    return (value) => value % step === 0;
  }

  if (field.includes(",")) {
    const values = field.split(",").map((part) => parseExactNumber(part, 0, 59));
    if (values.some((value) => value === null)) {
      return null;
    }

    const allowed = new Set(values as number[]);
    return (value) => allowed.has(value);
  }

  const exact = parseExactNumber(field, 0, 59);
  if (exact === null) {
    return null;
  }

  return (value) => value === exact;
}

function parseExactOrWildcardField(field: string, min: number, max: number): FieldMatcher | null {
  if (field === "*") {
    return () => true;
  }

  const exact = parseExactNumber(field, min, max);
  if (exact === null) {
    return null;
  }

  return (value) => value === exact;
}

function parseExactNumber(field: string, min: number, max: number): number | null {
  if (!/^\d+$/.test(field)) {
    return null;
  }

  const value = Number(field);
  if (!Number.isInteger(value) || value < min || value > max) {
    return null;
  }

  return value;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
npm test -- tests/cron/schedule.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/cron/schedule.ts tests/cron/schedule.test.ts
git commit -m "feat: add cron schedule utility"
```

---

### Task 2: Cron job database repository

**Files:**
- Modify: `src/db/database.ts`
- Create: `src/cron/jobs.ts`
- Create: `tests/cron/jobs.test.ts`

- [ ] **Step 1: Write failing repository tests**

Create `tests/cron/jobs.test.ts`:

```ts
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDefaultConfig } from "../../src/config/schema.js";
import { CronJobRepository } from "../../src/cron/jobs.js";
import { openDatabase } from "../../src/db/database.js";

let testDir: string;

describe("CronJobRepository", () => {
  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), "chattercatcher-cron-jobs-"));
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it("creates and lists active jobs by chat", () => {
    const config = createDefaultConfig();
    config.storage.dataDir = testDir;
    const database = openDatabase(config);

    try {
      const repository = new CronJobRepository(database, { now: () => new Date("2026-05-05T08:58:00.000Z") });
      const created = repository.create({
        chatId: "chat-a",
        createdByOpenId: "user-a",
        schedule: "0 9 * * *",
        prompt: "总结昨天群聊",
      });
      repository.create({ chatId: "chat-b", schedule: "0 10 * * *", prompt: "提醒喝水" });

      expect(created).toMatchObject({
        chatId: "chat-a",
        createdByOpenId: "user-a",
        schedule: "0 9 * * *",
        prompt: "总结昨天群聊",
        status: "active",
        nextRunAt: "2026-05-05T09:00:00.000Z",
      });
      expect(repository.listByChat("chat-a")).toMatchObject([{ id: created.id, chatId: "chat-a" }]);
    } finally {
      database.close();
    }
  });

  it("rejects invalid cron schedules", () => {
    const config = createDefaultConfig();
    config.storage.dataDir = testDir;
    const database = openDatabase(config);

    try {
      const repository = new CronJobRepository(database);
      expect(() => repository.create({ chatId: "chat-a", schedule: "bad cron", prompt: "总结" })).toThrow("cron 表达式无效");
    } finally {
      database.close();
    }
  });

  it("soft deletes only the matching chat job", () => {
    const config = createDefaultConfig();
    config.storage.dataDir = testDir;
    const database = openDatabase(config);

    try {
      const repository = new CronJobRepository(database, { now: () => new Date("2026-05-05T08:58:00.000Z") });
      const created = repository.create({ chatId: "chat-a", schedule: "0 9 * * *", prompt: "总结" });

      expect(repository.deleteByChat(created.id, "chat-b")).toBe(false);
      expect(repository.deleteByChat(created.id, "chat-a")).toBe(true);
      expect(repository.listByChat("chat-a")).toHaveLength(0);
      expect(repository.list(10)[0]).toMatchObject({ id: created.id, status: "deleted" });
    } finally {
      database.close();
    }
  });

  it("lists due jobs and records success or failure", () => {
    const config = createDefaultConfig();
    config.storage.dataDir = testDir;
    const database = openDatabase(config);

    try {
      const repository = new CronJobRepository(database, { now: () => new Date("2026-05-05T08:58:00.000Z") });
      const created = repository.create({ chatId: "chat-a", schedule: "0 9 * * *", prompt: "总结" });

      expect(repository.listDue(new Date("2026-05-05T08:59:00.000Z"))).toHaveLength(0);
      expect(repository.listDue(new Date("2026-05-05T09:00:00.000Z"))[0]).toMatchObject({ id: created.id });

      repository.markSuccess(created.id, new Date("2026-05-05T09:00:00.000Z"));
      expect(repository.get(created.id)).toMatchObject({
        lastRunAt: "2026-05-05T09:00:00.000Z",
        nextRunAt: "2026-05-06T09:00:00.000Z",
      });

      repository.markFailure(created.id, "LLM 请求失败", new Date("2026-05-06T09:00:00.000Z"));
      expect(repository.get(created.id)).toMatchObject({
        lastError: "LLM 请求失败",
        nextRunAt: "2026-05-07T09:00:00.000Z",
      });
    } finally {
      database.close();
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- tests/cron/jobs.test.ts
```

Expected: FAIL with an import error for `../../src/cron/jobs.js`.

- [ ] **Step 3: Add database schema**

Modify `src/db/database.ts` inside `migrateDatabase()` after the `image_multimodal_tasks` index statement:

```ts
    CREATE TABLE IF NOT EXISTS cron_jobs (
      id TEXT PRIMARY KEY,
      chat_id TEXT NOT NULL,
      created_by_open_id TEXT,
      schedule TEXT NOT NULL,
      prompt TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('active','deleted')),
      last_run_at TEXT,
      next_run_at TEXT NOT NULL,
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS cron_jobs_chat_status_idx ON cron_jobs(chat_id, status, updated_at);
    CREATE INDEX IF NOT EXISTS cron_jobs_due_idx ON cron_jobs(status, next_run_at);
```

Keep this inside the existing SQL template string.

- [ ] **Step 4: Implement repository**

Create `src/cron/jobs.ts`:

```ts
import crypto from "node:crypto";
import type { SqliteDatabase } from "../db/database.js";
import { getNextCronRun, isValidCronSchedule } from "./schedule.js";

export type CronJobStatus = "active" | "deleted";

export interface CronJobRecord {
  id: string;
  chatId: string;
  createdByOpenId?: string;
  schedule: string;
  prompt: string;
  status: CronJobStatus;
  lastRunAt?: string;
  nextRunAt: string;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}

interface CronJobRepositoryOptions {
  now?: () => Date;
}

interface CronJobRow {
  id: string;
  chatId: string;
  createdByOpenId: string | null;
  schedule: string;
  prompt: string;
  status: CronJobStatus;
  lastRunAt: string | null;
  nextRunAt: string;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export class CronJobRepository {
  private readonly now: () => Date;

  constructor(private readonly database: SqliteDatabase, options: CronJobRepositoryOptions = {}) {
    this.now = options.now ?? (() => new Date());
  }

  create(input: { chatId: string; createdByOpenId?: string; schedule: string; prompt: string }): CronJobRecord {
    const schedule = input.schedule.trim();
    const prompt = input.prompt.trim();
    if (!isValidCronSchedule(schedule)) {
      throw new Error("cron 表达式无效。");
    }
    if (!prompt) {
      throw new Error("定时任务 prompt 不能为空。");
    }

    const now = this.now();
    const nextRunAt = getNextCronRun(schedule, now);
    if (!nextRunAt) {
      throw new Error("无法计算下一次执行时间。");
    }

    const record: CronJobRecord = {
      id: crypto.randomUUID(),
      chatId: input.chatId,
      createdByOpenId: input.createdByOpenId,
      schedule,
      prompt,
      status: "active",
      nextRunAt: nextRunAt.toISOString(),
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };

    this.database
      .prepare(
        `
        INSERT INTO cron_jobs (
          id, chat_id, created_by_open_id, schedule, prompt, status,
          last_run_at, next_run_at, last_error, created_at, updated_at
        )
        VALUES (
          @id, @chatId, @createdByOpenId, @schedule, @prompt, @status,
          NULL, @nextRunAt, NULL, @createdAt, @updatedAt
        )
      `,
      )
      .run(record);

    return record;
  }

  get(id: string): CronJobRecord | null {
    return this.listByWhere("WHERE id = ?", [id], 1)[0] ?? null;
  }

  list(limit = 100): CronJobRecord[] {
    return this.listByWhere("", [], limit);
  }

  listByChat(chatId: string, limit = 50): CronJobRecord[] {
    return this.listByWhere("WHERE chat_id = ? AND status = 'active'", [chatId], limit);
  }

  listDue(now: Date, limit = 20): CronJobRecord[] {
    return this.listByWhere("WHERE status = 'active' AND next_run_at <= ?", [now.toISOString()], limit);
  }

  deleteByChat(id: string, chatId: string): boolean {
    const now = this.now().toISOString();
    const result = this.database
      .prepare(
        `
        UPDATE cron_jobs
        SET status = 'deleted', updated_at = @updatedAt
        WHERE id = @id AND chat_id = @chatId AND status = 'active'
      `,
      )
      .run({ id, chatId, updatedAt: now });
    return result.changes > 0;
  }

  markSuccess(id: string, ranAt: Date): void {
    const job = this.get(id);
    if (!job) {
      return;
    }

    const nextRunAt = getNextCronRun(job.schedule, ranAt);
    if (!nextRunAt) {
      throw new Error("无法计算下一次执行时间。");
    }

    this.database
      .prepare(
        `
        UPDATE cron_jobs
        SET last_run_at = @lastRunAt, next_run_at = @nextRunAt, last_error = NULL, updated_at = @updatedAt
        WHERE id = @id
      `,
      )
      .run({ id, lastRunAt: ranAt.toISOString(), nextRunAt: nextRunAt.toISOString(), updatedAt: ranAt.toISOString() });
  }

  markFailure(id: string, error: string, failedAt: Date): void {
    const job = this.get(id);
    if (!job) {
      return;
    }

    const nextRunAt = getNextCronRun(job.schedule, failedAt);
    if (!nextRunAt) {
      throw new Error("无法计算下一次执行时间。");
    }

    this.database
      .prepare(
        `
        UPDATE cron_jobs
        SET last_error = @lastError, next_run_at = @nextRunAt, updated_at = @updatedAt
        WHERE id = @id
      `,
      )
      .run({ id, lastError: error, nextRunAt: nextRunAt.toISOString(), updatedAt: failedAt.toISOString() });
  }

  private listByWhere(whereSql: string, params: unknown[], limit: number): CronJobRecord[] {
    const rows = this.database
      .prepare(
        `
        SELECT
          id,
          chat_id AS chatId,
          created_by_open_id AS createdByOpenId,
          schedule,
          prompt,
          status,
          last_run_at AS lastRunAt,
          next_run_at AS nextRunAt,
          last_error AS lastError,
          created_at AS createdAt,
          updated_at AS updatedAt
        FROM cron_jobs
        ${whereSql}
        ORDER BY updated_at DESC
        LIMIT ?
      `,
      )
      .all(...params, limit) as CronJobRow[];

    return rows.map((row) => ({
      id: row.id,
      chatId: row.chatId,
      createdByOpenId: row.createdByOpenId ?? undefined,
      schedule: row.schedule,
      prompt: row.prompt,
      status: row.status,
      lastRunAt: row.lastRunAt ?? undefined,
      nextRunAt: row.nextRunAt,
      lastError: row.lastError ?? undefined,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }));
  }
}
```

- [ ] **Step 5: Run repository tests**

Run:

```bash
npm test -- tests/cron/jobs.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/db/database.ts src/cron/jobs.ts tests/cron/jobs.test.ts
git commit -m "feat: persist cron jobs"
```

---

### Task 3: Current-chat CRONJob tools

**Files:**
- Create: `src/cron/tools.ts`
- Create: `tests/cron/tools.test.ts`

- [ ] **Step 1: Write failing tool tests**

Create `tests/cron/tools.test.ts`:

```ts
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDefaultConfig } from "../../src/config/schema.js";
import { CronJobRepository } from "../../src/cron/jobs.js";
import { createCronJobTools } from "../../src/cron/tools.js";
import { openDatabase } from "../../src/db/database.js";

let testDir: string;

describe("createCronJobTools", () => {
  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), "chattercatcher-cron-tools-"));
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it("creates, lists, and deletes jobs in the current chat", async () => {
    const config = createDefaultConfig();
    config.storage.dataDir = testDir;
    const database = openDatabase(config);

    try {
      const repository = new CronJobRepository(database, { now: () => new Date("2026-05-05T08:58:00.000Z") });
      const tools = createCronJobTools({ repository, chatId: "chat-a", createdByOpenId: "user-a" });
      const byName = new Map(tools.map((tool) => [tool.name, tool]));

      const created = JSON.parse(await byName.get("create_cron_job")!.execute({ schedule: "0 9 * * *", prompt: "总结昨天群聊" }));
      expect(created).toMatchObject({ ok: true, job: { chatId: "chat-a", schedule: "0 9 * * *", prompt: "总结昨天群聊" } });

      const list = JSON.parse(await byName.get("list_cron_jobs")!.execute({}));
      expect(list.jobs).toHaveLength(1);
      expect(list.jobs[0]).toMatchObject({ id: created.job.id, chatId: "chat-a" });

      const deleted = JSON.parse(await byName.get("delete_cron_job")!.execute({ id: created.job.id }));
      expect(deleted).toMatchObject({ ok: true, id: created.job.id });
      expect(repository.listByChat("chat-a")).toHaveLength(0);
    } finally {
      database.close();
    }
  });

  it("returns tool errors for invalid input and wrong chat deletion", async () => {
    const config = createDefaultConfig();
    config.storage.dataDir = testDir;
    const database = openDatabase(config);

    try {
      const repository = new CronJobRepository(database, { now: () => new Date("2026-05-05T08:58:00.000Z") });
      const otherJob = repository.create({ chatId: "chat-b", schedule: "0 9 * * *", prompt: "总结" });
      const tools = createCronJobTools({ repository, chatId: "chat-a" });
      const byName = new Map(tools.map((tool) => [tool.name, tool]));

      await expect(byName.get("create_cron_job")!.execute({ schedule: "bad cron", prompt: "总结" })).rejects.toThrow("cron 表达式无效");
      const deleted = JSON.parse(await byName.get("delete_cron_job")!.execute({ id: otherJob.id }));
      expect(deleted).toMatchObject({ ok: false });
      expect(repository.get(otherJob.id)).toMatchObject({ status: "active" });
    } finally {
      database.close();
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- tests/cron/tools.test.ts
```

Expected: FAIL with an import error for `../../src/cron/tools.js`.

- [ ] **Step 3: Implement CRONJob tools**

Create `src/cron/tools.ts`:

```ts
import type { ChatTool } from "../rag/types.js";
import type { CronJobRepository } from "./jobs.js";

export interface CronJobTool extends ChatTool {
  execute(input: unknown): Promise<string>;
}

interface CreateCronJobToolsInput {
  repository: CronJobRepository;
  chatId: string;
  createdByOpenId?: string;
}

function readString(input: unknown, key: string): string {
  const value = typeof input === "object" && input !== null && key in input ? (input as Record<string, unknown>)[key] : undefined;
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${key} 必须是非空字符串。`);
  }
  return value.trim();
}

export function createCronJobTools(input: CreateCronJobToolsInput): CronJobTool[] {
  return [
    {
      name: "create_cron_job",
      description: "Create a scheduled AI message for the current Feishu chat only. The schedule must be a five-field cron string.",
      inputSchema: {
        type: "object",
        properties: {
          schedule: { type: "string", description: "Five-field cron schedule, for example 0 9 * * *." },
          prompt: { type: "string", description: "Prompt used later to generate the scheduled message." },
        },
        required: ["schedule", "prompt"],
        additionalProperties: false,
      },
      execute: async (rawInput) => {
        const job = input.repository.create({
          chatId: input.chatId,
          createdByOpenId: input.createdByOpenId,
          schedule: readString(rawInput, "schedule"),
          prompt: readString(rawInput, "prompt"),
        });
        return JSON.stringify({ ok: true, job });
      },
    },
    {
      name: "list_cron_jobs",
      description: "List active scheduled AI messages for the current Feishu chat only.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      execute: async () => JSON.stringify({ ok: true, jobs: input.repository.listByChat(input.chatId) }),
    },
    {
      name: "delete_cron_job",
      description: "Delete a scheduled AI message by ID, only if it belongs to the current Feishu chat.",
      inputSchema: {
        type: "object",
        properties: { id: { type: "string", description: "Cron job ID returned by create_cron_job or list_cron_jobs." } },
        required: ["id"],
        additionalProperties: false,
      },
      execute: async (rawInput) => {
        const id = readString(rawInput, "id");
        const ok = input.repository.deleteByChat(id, input.chatId);
        return JSON.stringify({ ok, id, message: ok ? "定时任务已删除。" : "没有找到当前群里的这个定时任务。" });
      },
    },
  ];
}
```

- [ ] **Step 4: Run tool tests**

Run:

```bash
npm test -- tests/cron/tools.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/cron/tools.ts tests/cron/tools.test.ts
git commit -m "feat: add cron job ai tools"
```

---

### Task 4: Feishu question handler uses CRONJob tools

**Files:**
- Modify: `src/feishu/question.ts`
- Create: `tests/feishu/question-cron-tools.test.ts`

- [ ] **Step 1: Write failing Feishu tool integration tests**

Create `tests/feishu/question-cron-tools.test.ts`:

```ts
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDefaultConfig, createDefaultSecrets } from "../../src/config/schema.js";
import { CronJobRepository } from "../../src/cron/jobs.js";
import { openDatabase } from "../../src/db/database.js";
import { FeishuQuestionHandler } from "../../src/feishu/question.js";
import type { MessageSender } from "../../src/feishu/sender.js";
import type { ChatMessage, ChatModel, ChatTool, ToolChatResult } from "../../src/rag/types.js";

let testDir: string;

class ToolCallingModel implements ChatModel {
  constructor(private readonly action: "create" | "list" | "delete") {}
  calls = 0;

  async complete(_messages: ChatMessage[]): Promise<string> {
    return "已处理定时任务。";
  }

  async completeWithTools(messages: ChatMessage[], tools: ChatTool[]): Promise<ToolChatResult> {
    this.calls += 1;
    const hasToolResult = messages.some((message) => message.role === "tool");
    if (hasToolResult) {
      return { content: "定时任务操作完成。", toolCalls: [] };
    }

    expect(tools.map((tool) => tool.name)).toContain("create_cron_job");
    if (this.action === "create") {
      return { content: "", toolCalls: [{ id: "call-1", name: "create_cron_job", input: { schedule: "0 9 * * *", prompt: "总结昨天群聊" } }] };
    }
    if (this.action === "list") {
      return { content: "", toolCalls: [{ id: "call-1", name: "list_cron_jobs", input: {} }] };
    }
    return { content: "", toolCalls: [{ id: "call-1", name: "delete_cron_job", input: { id: "job-to-delete" } }] };
  }
}

class MemorySender implements MessageSender {
  sent: string[] = [];
  async sendTextToChat(_chatId: string, text: string): Promise<void> {
    this.sent.push(text);
  }
  async replyTextToMessage(_messageId: string, text: string): Promise<void> {
    this.sent.push(text);
  }
}

function payload(text: string) {
  return {
    event: {
      message: {
        chat_id: "chat-a",
        message_id: "message-a",
        message_type: "text",
        content: JSON.stringify({ text }),
        mentions: [{ key: "@bot", id: { open_id: "bot-open-id" }, name: "bot" }],
      },
      sender: { sender_id: { open_id: "user-a" } },
    },
  };
}

describe("FeishuQuestionHandler CRONJob tools", () => {
  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), "chattercatcher-feishu-cron-tools-"));
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it("creates a cron job through a model tool call", async () => {
    const config = createDefaultConfig();
    config.storage.dataDir = testDir;
    config.feishu.botOpenId = "bot-open-id";
    const secrets = createDefaultSecrets();
    const database = openDatabase(config);

    try {
      const sender = new MemorySender();
      const model = new ToolCallingModel("create");
      const handler = new FeishuQuestionHandler({ config, secrets, database, model, sender });

      await handler.handle(payload("@bot 每天 9 点总结昨天群聊"));

      expect(new CronJobRepository(database).listByChat("chat-a")).toMatchObject([
        { chatId: "chat-a", createdByOpenId: "user-a", schedule: "0 9 * * *", prompt: "总结昨天群聊" },
      ]);
      expect(sender.sent.at(-1)).toContain("定时任务操作完成");
    } finally {
      database.close();
    }
  });

  it("keeps delete scoped to the current chat", async () => {
    const config = createDefaultConfig();
    config.storage.dataDir = testDir;
    config.feishu.botOpenId = "bot-open-id";
    const secrets = createDefaultSecrets();
    const database = openDatabase(config);

    try {
      const repository = new CronJobRepository(database, { now: () => new Date("2026-05-05T08:58:00.000Z") });
      repository.create({ chatId: "chat-b", schedule: "0 9 * * *", prompt: "总结" });
      database.prepare("UPDATE cron_jobs SET id = 'job-to-delete' WHERE chat_id = 'chat-b'").run();

      const sender = new MemorySender();
      const handler = new FeishuQuestionHandler({ config, secrets, database, model: new ToolCallingModel("delete"), sender });
      await handler.handle(payload("@bot 删除任务 job-to-delete"));

      expect(repository.get("job-to-delete")).toMatchObject({ chatId: "chat-b", status: "active" });
      expect(sender.sent.at(-1)).toContain("定时任务操作完成");
    } finally {
      database.close();
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- tests/feishu/question-cron-tools.test.ts
```

Expected: FAIL because `FeishuQuestionHandler` does not include CRONJob tools yet.

- [ ] **Step 3: Modify FeishuQuestionHandler to use general executable tools**

Modify `src/feishu/question.ts` imports:

```ts
import { CronJobRepository } from "../cron/jobs.js";
import { createCronJobTools, type CronJobTool } from "../cron/tools.js";
import type { RagSearchTool } from "../rag/search-tools.js";
import type { ChatMessage, ChatModel, ChatTool, ToolCall } from "../rag/types.js";
```

Replace the existing `ChatModel` import line with the expanded type import above.

Add these helpers before `export class FeishuQuestionHandler`:

```ts
type FeishuExecutableTool = (RagSearchTool | CronJobTool) & ChatTool;

const FEISHU_TOOL_SYSTEM_PROMPT =
  "你是飞书群知识库机器人。回答用户问题前可以搜索本地知识库；当用户明确要求创建、查看或删除定时群消息任务时，使用 CRONJob 工具。CRONJob 工具只能管理当前群。自然语言时间需要转换成 5 段 cron。";

function toToolResultContent(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

function toToolErrorContent(message: string): string {
  return JSON.stringify({ ok: false, error: message });
}

async function executeFeishuTool(tool: FeishuExecutableTool, input: unknown): Promise<string> {
  const result = await tool.execute(input);
  return toToolResultContent(result);
}

async function runFeishuToolLoop(input: {
  question: string;
  model: ChatModel;
  tools: FeishuExecutableTool[];
  maxModelTurns?: number;
  maxToolCalls?: number;
}): Promise<string> {
  if (!input.model.completeWithTools) {
    throw new Error("当前 LLM 客户端不支持工具调用。");
  }

  const messages: ChatMessage[] = [
    { role: "system", content: FEISHU_TOOL_SYSTEM_PROMPT },
    { role: "user", content: input.question },
  ];
  const toolsByName = new Map(input.tools.map((tool) => [tool.name, tool]));
  const maxModelTurns = input.maxModelTurns ?? 4;
  const maxToolCalls = input.maxToolCalls ?? 8;
  let toolCallsUsed = 0;
  let lastContent = "";

  for (let turn = 0; turn < maxModelTurns; turn += 1) {
    const assistantResult = await input.model.completeWithTools(messages, input.tools);
    lastContent = assistantResult.content;
    messages.push({ role: "assistant", content: assistantResult.content, toolCalls: assistantResult.toolCalls });

    if (assistantResult.toolCalls.length === 0) {
      return assistantResult.content || "已处理。";
    }

    for (const toolCall of assistantResult.toolCalls as ToolCall[]) {
      if (toolCallsUsed >= maxToolCalls) {
        break;
      }
      toolCallsUsed += 1;
      const tool = toolsByName.get(toolCall.name);
      if (!tool) {
        messages.push({ role: "tool", toolCallId: toolCall.id, content: toToolErrorContent(`未知工具：${toolCall.name}`) });
        continue;
      }
      try {
        messages.push({ role: "tool", toolCallId: toolCall.id, content: await executeFeishuTool(tool, toolCall.input) });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        messages.push({ role: "tool", toolCallId: toolCall.id, content: toToolErrorContent(message) });
      }
    }
  }

  return lastContent || "定时任务操作已提交，但模型没有生成最终回复。";
}
```

Inside `handle()`, replace the current `askWithAgenticRag(...)` block with:

```ts
        const cronTools = createCronJobTools({
          repository: new CronJobRepository(this.options.database),
          chatId: decision.chatId,
          createdByOpenId: payload.event?.sender?.sender_id?.open_id,
        });
        const allTools: FeishuExecutableTool[] = [...tools, ...cronTools];
        const answer = await runFeishuToolLoop({
          question: decision.question,
          tools: allTools,
          model: this.options.model,
        });
        qaLogs.create({
          chatId: decision.chatId,
          questionMessageId,
          question: decision.question,
          answer,
          citations: [],
          retrievalDebug: {},
          status: "answered",
          createdAt: new Date().toISOString(),
        });
        await this.sendResponse(decision.chatId, questionMessageId, answer);
```

Remove now-unused imports `formatCitations` and `askWithAgenticRag` from this file.

- [ ] **Step 4: Run Feishu CRONJob tests**

Run:

```bash
npm test -- tests/feishu/question-cron-tools.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run existing Feishu question tests**

Run:

```bash
npm test -- tests/feishu
```

Expected: PASS. If existing tests expected citations from `askWithAgenticRag`, update only the assertions to reflect the new general tool loop output and keep behavior equivalent for user-visible answers.

- [ ] **Step 6: Commit**

```bash
git add src/feishu/question.ts tests/feishu/question-cron-tools.test.ts
git commit -m "feat: enable feishu cron job tools"
```

---

### Task 5: Scheduled message generator

**Files:**
- Create: `src/cron/generator.ts`
- Create: `tests/cron/generator.test.ts`

- [ ] **Step 1: Write failing generator tests**

Create `tests/cron/generator.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { generateCronJobMessage } from "../../src/cron/generator.js";
import type { RagSearchTool } from "../../src/rag/search-tools.js";
import type { ChatMessage, ChatModel, ChatTool, ToolChatResult } from "../../src/rag/types.js";

class ModelWithSearch implements ChatModel {
  async complete(messages: ChatMessage[]): Promise<string> {
    expect(messages.at(-1)?.content).toContain("证据：");
    return "昨天群里确认端午活动改到 6 月 30 日。";
  }

  async completeWithTools(messages: ChatMessage[], tools: ChatTool[]): Promise<ToolChatResult> {
    const hasToolResult = messages.some((message) => message.role === "tool");
    if (hasToolResult) {
      return { content: "证据已足够。", toolCalls: [] };
    }
    expect(tools.map((tool) => tool.name)).toContain("hybrid_search");
    return { content: "", toolCalls: [{ id: "call-1", name: "hybrid_search", input: { query: "昨天 群聊 总结", limit: 3 } }] };
  }
}

describe("generateCronJobMessage", () => {
  it("uses RAG tools and returns final sendable text", async () => {
    const tool: RagSearchTool = {
      name: "hybrid_search",
      description: "Search evidence.",
      inputSchema: { type: "object" },
      execute: async () => [
        {
          id: "evidence-1",
          text: "端午活动改到 2026/6/30。",
          score: 1,
          source: { type: "message", label: "家庭群" },
        },
      ],
    };

    await expect(
      generateCronJobMessage({
        prompt: "总结昨天群聊",
        model: new ModelWithSearch(),
        tools: [tool],
        now: new Date("2026-05-05T09:00:00.000Z"),
      }),
    ).resolves.toBe("昨天群里确认端午活动改到 6 月 30 日。");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- tests/cron/generator.test.ts
```

Expected: FAIL with an import error for `../../src/cron/generator.js`.

- [ ] **Step 3: Implement scheduled message generator**

Create `src/cron/generator.ts`:

```ts
import type { RagSearchTool } from "../rag/search-tools.js";
import type { ChatMessage, ChatModel, EvidenceBlock } from "../rag/types.js";

interface GenerateCronJobMessageInput {
  prompt: string;
  model: ChatModel;
  tools: RagSearchTool[];
  now: Date;
  maxModelTurns?: number;
  maxToolCalls?: number;
}

const SYSTEM_PROMPT =
  "你正在为飞书群生成一条定时消息。可以先调用搜索工具检索本地群聊知识库。最终输出必须是可以直接发到群里的纯文本，不要输出工具调用说明。";

function evidenceToText(evidence: EvidenceBlock[]): string {
  if (evidence.length === 0) {
    return "无检索证据。";
  }
  return evidence.map((item, index) => `${index + 1}. ${item.text}`).join("\n");
}

function toolResultContent(results: EvidenceBlock[]): string {
  return JSON.stringify(results.map((item) => ({ id: item.id, text: item.text, score: item.score, source: item.source })));
}

export async function generateCronJobMessage(input: GenerateCronJobMessageInput): Promise<string> {
  if (!input.model.completeWithTools) {
    throw new Error("当前 LLM 客户端不支持工具调用。");
  }

  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: `当前时间：${input.now.toISOString()}\n任务提示词：${input.prompt}` },
  ];
  const toolsByName = new Map(input.tools.map((tool) => [tool.name, tool]));
  const evidence: EvidenceBlock[] = [];
  const maxModelTurns = input.maxModelTurns ?? 3;
  const maxToolCalls = input.maxToolCalls ?? 6;
  let toolCallsUsed = 0;

  for (let turn = 0; turn < maxModelTurns; turn += 1) {
    const result = await input.model.completeWithTools(messages, input.tools);
    messages.push({ role: "assistant", content: result.content, toolCalls: result.toolCalls });
    if (result.toolCalls.length === 0) {
      break;
    }

    for (const call of result.toolCalls) {
      if (toolCallsUsed >= maxToolCalls) {
        break;
      }
      toolCallsUsed += 1;
      const tool = toolsByName.get(call.name);
      if (!tool) {
        messages.push({ role: "tool", toolCallId: call.id, content: JSON.stringify({ error: `未知工具：${call.name}` }) });
        continue;
      }

      try {
        const results = await tool.execute(call.input);
        evidence.push(...results);
        messages.push({ role: "tool", toolCallId: call.id, content: toolResultContent(results) });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        messages.push({ role: "tool", toolCallId: call.id, content: JSON.stringify({ error: message }) });
      }
    }
  }

  return input.model.complete([
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: `当前时间：${input.now.toISOString()}\n任务提示词：${input.prompt}\n\n证据：\n${evidenceToText(evidence)}`,
    },
  ]);
}
```

- [ ] **Step 4: Run generator tests**

Run:

```bash
npm test -- tests/cron/generator.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/cron/generator.ts tests/cron/generator.test.ts
git commit -m "feat: generate scheduled cron messages"
```

---

### Task 6: Cron job scheduler

**Files:**
- Create: `src/cron/scheduler.ts`
- Create: `tests/cron/scheduler.test.ts`

- [ ] **Step 1: Write failing scheduler tests**

Create `tests/cron/scheduler.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { createCronJobScheduler } from "../../src/cron/scheduler.js";
import type { CronJobRecord, CronJobRepository } from "../../src/cron/jobs.js";

function job(input: Partial<CronJobRecord> = {}): CronJobRecord {
  return {
    id: input.id ?? "job-1",
    chatId: input.chatId ?? "chat-a",
    schedule: input.schedule ?? "0 9 * * *",
    prompt: input.prompt ?? "总结",
    status: input.status ?? "active",
    nextRunAt: input.nextRunAt ?? "2026-05-05T09:00:00.000Z",
    createdAt: input.createdAt ?? "2026-05-05T08:00:00.000Z",
    updatedAt: input.updatedAt ?? "2026-05-05T08:00:00.000Z",
  };
}

describe("createCronJobScheduler", () => {
  it("runs due jobs and marks success", async () => {
    const due = job();
    const repository = {
      listDue: vi.fn(() => [due]),
      markSuccess: vi.fn(),
      markFailure: vi.fn(),
    } as unknown as CronJobRepository;
    const send = vi.fn(async () => undefined);
    const generate = vi.fn(async () => "定时总结");
    const now = () => new Date("2026-05-05T09:00:00.000Z");

    const scheduler = createCronJobScheduler({ repository, generateMessage: generate, sendTextToChat: send, now });
    await scheduler.runDueNow();

    expect(generate).toHaveBeenCalledWith(due, now());
    expect(send).toHaveBeenCalledWith("chat-a", "定时总结");
    expect(repository.markSuccess).toHaveBeenCalledWith("job-1", now());
  });

  it("records failure and continues other jobs", async () => {
    const repository = {
      listDue: vi.fn(() => [job({ id: "job-1" }), job({ id: "job-2" })]),
      markSuccess: vi.fn(),
      markFailure: vi.fn(),
    } as unknown as CronJobRepository;
    const generate = vi.fn(async (record: CronJobRecord) => {
      if (record.id === "job-1") throw new Error("LLM 请求失败");
      return "第二条";
    });
    const send = vi.fn(async () => undefined);
    const now = () => new Date("2026-05-05T09:00:00.000Z");

    const scheduler = createCronJobScheduler({ repository, generateMessage: generate, sendTextToChat: send, now });
    await scheduler.runDueNow();

    expect(repository.markFailure).toHaveBeenCalledWith("job-1", "LLM 请求失败", now());
    expect(repository.markSuccess).toHaveBeenCalledWith("job-2", now());
  });

  it("does not overlap while a run is active", async () => {
    let release = false;
    const repository = {
      listDue: vi.fn(() => [job()]),
      markSuccess: vi.fn(),
      markFailure: vi.fn(),
    } as unknown as CronJobRepository;
    const generate = vi.fn(async () => {
      await new Promise<void>((resolve) => {
        const poll = () => {
          if (release) resolve();
          else queueMicrotask(poll);
        };
        poll();
      });
      return "定时总结";
    });
    const scheduler = createCronJobScheduler({
      repository,
      generateMessage: generate,
      sendTextToChat: async () => undefined,
      now: () => new Date("2026-05-05T09:00:00.000Z"),
    });

    const first = scheduler.runDueNow();
    await Promise.resolve();
    await scheduler.runDueNow();
    expect(generate).toHaveBeenCalledTimes(1);
    release = true;
    await first;
  });

  it("starts and stops a minute interval", () => {
    const timer = 123 as unknown as ReturnType<typeof setInterval>;
    const setIntervalFn = vi.fn(() => timer);
    const clearIntervalFn = vi.fn();
    const scheduler = createCronJobScheduler({
      repository: { listDue: vi.fn(() => []), markSuccess: vi.fn(), markFailure: vi.fn() } as unknown as CronJobRepository,
      generateMessage: async () => "",
      sendTextToChat: async () => undefined,
      setIntervalFn,
      clearIntervalFn,
    });

    scheduler.start();
    scheduler.start();
    scheduler.stop();

    expect(setIntervalFn).toHaveBeenCalledTimes(1);
    expect(setIntervalFn.mock.calls[0][1]).toBe(60_000);
    expect(clearIntervalFn).toHaveBeenCalledWith(timer);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- tests/cron/scheduler.test.ts
```

Expected: FAIL with an import error for `../../src/cron/scheduler.js`.

- [ ] **Step 3: Implement scheduler**

Create `src/cron/scheduler.ts`:

```ts
import type { CronJobRecord, CronJobRepository } from "./jobs.js";

export interface CronJobScheduler {
  start(): void;
  stop(): void;
  runDueNow(): Promise<void>;
}

interface CreateCronJobSchedulerOptions {
  repository: Pick<CronJobRepository, "listDue" | "markSuccess" | "markFailure">;
  generateMessage: (job: CronJobRecord, now: Date) => Promise<string>;
  sendTextToChat: (chatId: string, text: string) => Promise<void>;
  now?: () => Date;
  setIntervalFn?: typeof setInterval;
  clearIntervalFn?: typeof clearInterval;
  logger?: Pick<Console, "error">;
}

export function createCronJobScheduler(options: CreateCronJobSchedulerOptions): CronJobScheduler {
  const now = options.now ?? (() => new Date());
  const setIntervalFn = options.setIntervalFn ?? setInterval;
  const clearIntervalFn = options.clearIntervalFn ?? clearInterval;
  const logger = options.logger ?? console;
  let timer: ReturnType<typeof setInterval> | undefined;
  let running = false;

  const runDueNow = async (): Promise<void> => {
    if (running) {
      return;
    }

    running = true;
    const startedAt = now();
    try {
      const jobs = options.repository.listDue(startedAt);
      for (const job of jobs) {
        try {
          const text = await options.generateMessage(job, startedAt);
          await options.sendTextToChat(job.chatId, text);
          options.repository.markSuccess(job.id, startedAt);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          options.repository.markFailure(job.id, message, startedAt);
          logger.error(`CRONJob 执行失败：${job.id} ${message}`);
        }
      }
    } finally {
      running = false;
    }
  };

  return {
    start() {
      if (timer) {
        return;
      }
      timer = setIntervalFn(() => {
        void runDueNow();
      }, 60_000);
    },
    stop() {
      if (!timer) {
        return;
      }
      clearIntervalFn(timer);
      timer = undefined;
    },
    runDueNow,
  };
}
```

- [ ] **Step 4: Run scheduler tests**

Run:

```bash
npm test -- tests/cron/scheduler.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/cron/scheduler.ts tests/cron/scheduler.test.ts
git commit -m "feat: add cron job scheduler"
```

---

### Task 7: Gateway wiring for scheduled jobs

**Files:**
- Modify: `src/feishu/gateway.ts`
- Modify: `src/cli.ts`
- Modify: `tests/feishu/gateway.test.ts`

- [ ] **Step 1: Write failing Gateway lifecycle test**

Modify `tests/feishu/gateway.test.ts` by adding this test inside `describe("createFeishuGateway", ...)`:

```ts
  it("starts and stops the cron job scheduler with the gateway", async () => {
    const config = createDefaultConfig();
    const secrets = createDefaultSecrets();
    config.feishu.appId = "app-id";
    secrets.feishu.appSecret = "app-secret";
    const cronJobScheduler = {
      start: vi.fn(),
      stop: vi.fn(),
      runDueNow: vi.fn(async () => undefined),
    };
    const wsClient = {
      start: vi.fn(async () => undefined),
      close: vi.fn(),
    };

    const runtime = createFeishuGateway({
      config,
      secrets,
      ingestor: { ingestFeishuEvent: vi.fn(() => ({ accepted: false, reason: "skip" })) },
      cronJobScheduler,
      wsClientFactory: () => wsClient,
    });

    await runtime.start();
    runtime.stop();

    expect(cronJobScheduler.start).toHaveBeenCalledTimes(1);
    expect(cronJobScheduler.stop).toHaveBeenCalledTimes(1);
  });
```

If the file has a local fake ingestor helper, use the local helper instead of the inline object while keeping the same assertions.

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- tests/feishu/gateway.test.ts
```

Expected: FAIL because `cronJobScheduler` is not part of `FeishuGatewayOptions`.

- [ ] **Step 3: Wire scheduler type into Gateway**

Modify `src/feishu/gateway.ts` imports:

```ts
import { CronJobRepository } from "../cron/jobs.js";
import type { CronJobScheduler } from "../cron/scheduler.js";
import { createCronJobScheduler } from "../cron/scheduler.js";
import { generateCronJobMessage } from "../cron/generator.js";
```

Extend `FeishuGatewayOptions`:

```ts
  cronJobProcessor?: { database: SqliteDatabase; model: ChatModel; sender: { sendTextToChat(chatId: string, text: string): Promise<void> } };
  cronJobScheduler?: CronJobScheduler;
```

Before the `return` in `createFeishuGateway`, create the scheduler:

```ts
  const cronJobScheduler = options.cronJobScheduler ?? (
    options.cronJobProcessor
      ? createCronJobScheduler({
          repository: new CronJobRepository(options.cronJobProcessor.database),
          sendTextToChat: (chatId, text) => options.cronJobProcessor!.sender.sendTextToChat(chatId, text),
          generateMessage: async (job, now) => {
            const { tools, close } = await createAgenticRagSearchTools({
              config: options.config,
              secrets: options.secrets,
              database: options.cronJobProcessor!.database,
              messages: new MessageRepository(options.cronJobProcessor!.database),
            });
            try {
              return await generateCronJobMessage({ prompt: job.prompt, model: options.cronJobProcessor!.model, tools, now });
            } finally {
              close();
            }
          },
        })
      : undefined
  );
```

In `start()` after `indexingScheduler?.start();`, add:

```ts
        cronJobScheduler?.start();
```

In the `catch` block after `indexingScheduler?.stop();`, add:

```ts
        cronJobScheduler?.stop();
```

In `stop()` after `indexingScheduler?.stop();`, add:

```ts
      cronJobScheduler?.stop();
```

- [ ] **Step 4: Pass dependencies from CLI foreground Gateway**

Modify `src/cli.ts` in `startGatewayForegroundCommand()` before `createFeishuGateway`:

```ts
  const sender = FeishuMessageSender.fromConfig(config, secrets);
  const chatModel = createChatModel(config, secrets);
```

Then change the `questionHandler` and add `cronJobProcessor`:

```ts
    cronJobProcessor: {
      database,
      model: chatModel,
      sender,
    },
    questionHandler: new FeishuQuestionHandler({
      config,
      secrets,
      database,
      sender,
      model: chatModel,
    }),
```

Keep `episodeProcessor.model` using `chatModel` as well if desired:

```ts
      model: chatModel,
```

- [ ] **Step 5: Run Gateway tests**

Run:

```bash
npm test -- tests/feishu/gateway.test.ts
```

Expected: PASS.

- [ ] **Step 6: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/feishu/gateway.ts src/cli.ts tests/feishu/gateway.test.ts
git commit -m "feat: run cron jobs from gateway"
```

---

### Task 8: Web API and WebUI

**Files:**
- Modify: `src/web/server.ts`
- Modify: `tests/web/server.test.ts`

- [ ] **Step 1: Write failing Web API test**

Modify `tests/web/server.test.ts` imports:

```ts
import { CronJobRepository } from "../../src/cron/jobs.js";
```

In the first test, after the `QaLogRepository(database).create(...)` block and before closing the database, add:

```ts
      new CronJobRepository(database, { now: () => new Date("2026-05-05T08:58:00.000Z") }).create({
        chatId: "family",
        createdByOpenId: "mom",
        schedule: "0 9 * * *",
        prompt: "总结昨天群聊",
      });
```

After the file jobs API assertions, add:

```ts
      const cronJobs = await app.inject({ method: "GET", url: "/api/cron-jobs" });
      expect(cronJobs.statusCode).toBe(200);
      expect(cronJobs.json().items[0]).toMatchObject({
        chatId: "family",
        schedule: "0 9 * * *",
        prompt: "总结昨天群聊",
        status: "active",
      });

      const deleteResponse = await app.inject({ method: "DELETE", url: `/api/cron-jobs/${cronJobs.json().items[0].id}` });
      expect(deleteResponse.statusCode).toBe(200);
      expect(deleteResponse.json()).toMatchObject({ ok: true });
      expect((await app.inject({ method: "GET", url: "/api/cron-jobs" })).json().items[0]).toMatchObject({ status: "deleted" });
```

In the homepage test, add:

```ts
      expect(response.body).toContain("定时任务");
      expect(response.body).toContain('id="cron-jobs" class="empty">正在读取...</div>');
      expect(response.body).toContain("/api/cron-jobs");
```

- [ ] **Step 2: Run web tests to verify failure**

Run:

```bash
npm test -- tests/web/server.test.ts
```

Expected: FAIL because `/api/cron-jobs` is not implemented and the homepage lacks the section.

- [ ] **Step 3: Add repository and API routes**

Modify `src/web/server.ts` imports:

```ts
import { CronJobRepository } from "../cron/jobs.js";
```

In `createWebApp`, after `const qaLogs = new QaLogRepository(database);`, add:

```ts
  const cronJobs = new CronJobRepository(database);
```

In `/api/status` data object, add:

```ts
      cronJobs: cronJobs.list(1_000).length,
```

After `/api/qa-logs`, add:

```ts
  app.get("/api/cron-jobs", async (request) => {
    const limit = parseLimit((request.query as { limit?: string }).limit, 50, 200);
    return {
      items: cronJobs.list(limit),
    };
  });

  app.delete("/api/cron-jobs/:id", async (request, reply) => {
    const id = (request.params as { id: string }).id;
    const job = cronJobs.get(id);
    if (!job) {
      reply.code(404);
      return { ok: false, message: "没有找到定时任务。" };
    }

    const ok = cronJobs.deleteByChat(id, job.chatId);
    return { ok };
  });
```

- [ ] **Step 4: Add WebUI section and rendering**

Modify `src/web/server.ts` HTML:

In the sidebar after the file-jobs section, add:

```html
          <section>
            <h2>定时任务</h2>
            <div id="cron-jobs" class="empty">正在读取...</div>
          </section>
```

In the script variable block after `const fileJobs = document.querySelector("#file-jobs");`, add:

```js
      const cronJobs = document.querySelector("#cron-jobs");
```

Add this function after `renderFileJobs`:

```js
      function renderCronJobs(items) {
        if (items.length === 0) {
          cronJobs.className = "empty";
          cronJobs.textContent = "还没有定时任务。可在飞书群里 @ 机器人创建。";
          return;
        }
        cronJobs.className = "";
        cronJobs.innerHTML = `
          <table>
            <thead><tr><th>任务</th><th>状态</th></tr></thead>
            <tbody>
              ${items.map((item) => `
                <tr>
                  <td>
                    <div>${escapeHtml(item.schedule)}</div>
                    <div class="message" title="${escapeHtml(item.prompt)}">${escapeHtml(item.prompt)}</div>
                    <div class="path" title="${escapeHtml(item.id)}">ID: ${escapeHtml(item.id)}</div>
                    <div class="path" title="${escapeHtml(item.chatId)}">群: ${escapeHtml(item.chatId)}</div>
                    <div class="path">下次: ${escapeHtml(formatDateTime(item.nextRunAt))}</div>
                    <div class="path" title="${escapeHtml(item.lastError || "")}">${escapeHtml(item.lastError || "")}</div>
                    ${item.status === "active" ? `<button type="button" data-delete-cron-job="${escapeHtml(item.id)}">删除</button>` : ""}
                  </td>
                  <td>${escapeHtml(item.status)}</td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        `;
      }
```

Modify `load()` to include cron jobs:

```js
        const [status, recent, episodeList, chatList, fileList, jobList, qaLogList, cronJobList] = await Promise.all([
          fetch("/api/status").then((response) => response.json()),
          fetch("/api/messages/recent?limit=20").then((response) => response.json()),
          fetch("/api/episodes?limit=10").then((response) => response.json()),
          fetch("/api/chats").then((response) => response.json()),
          fetch("/api/files").then((response) => response.json()),
          fetch("/api/file-jobs").then((response) => response.json()),
          fetch("/api/qa-logs?limit=10").then((response) => response.json()),
          fetch("/api/cron-jobs").then((response) => response.json()),
        ]);
```

After `renderQaLogs(qaLogList.items);`, add:

```js
        renderCronJobs(cronJobList.items);
```

Add click handling before `processMessages.addEventListener(...)`:

```js
      document.addEventListener("click", async (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        const id = target.dataset.deleteCronJob;
        if (!id) return;
        target.setAttribute("disabled", "disabled");
        actionStatus.textContent = "正在删除定时任务...";
        try {
          const response = await fetch(`/api/cron-jobs/${encodeURIComponent(id)}`, { method: "DELETE" });
          const result = await response.json();
          actionStatus.textContent = result.ok ? "定时任务已删除。" : result.message || "删除失败。";
          await load();
        } catch (error) {
          actionStatus.textContent = error instanceof Error ? error.message : String(error);
        } finally {
          target.removeAttribute("disabled");
        }
      });
```

- [ ] **Step 5: Run web tests**

Run:

```bash
npm test -- tests/web/server.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/web/server.ts tests/web/server.test.ts
git commit -m "feat: show cron jobs in web ui"
```

---

### Task 9: Exports and full verification

**Files:**
- Modify: `src/index.ts`
- Test: full suite

- [ ] **Step 1: Export cron modules**

Modify `src/index.ts` by adding:

```ts
export * from "./cron/generator.js";
export * from "./cron/jobs.js";
export * from "./cron/schedule.js";
export * from "./cron/scheduler.js";
export * from "./cron/tools.js";
```

Place these with the other domain exports near the top.

- [ ] **Step 2: Run full verification**

Run:

```bash
npm run build && npm test && npm run typecheck
```

Expected: PASS with all Vitest files passing and no TypeScript errors.

- [ ] **Step 3: Check git status**

Run:

```bash
git status --short
```

Expected: only intentional files are changed, or clean if all task commits were made.

- [ ] **Step 4: Commit exports if needed**

If Step 1 created uncommitted changes, run:

```bash
git add src/index.ts
git commit -m "chore: export cron job modules"
```

Expected: commit succeeds.

---

## Self-Review

- Spec coverage: data model in Task 2; AI create/list/delete tools in Tasks 3-4; Gateway scheduling and execution in Tasks 5-7; simplified cron syntax in Task 1; WebUI/API in Task 8; errors and tests across Tasks 2-8.
- Placeholder scan: no `TBD`, no unresolved task, no unspecified error handling instruction.
- Type consistency: `CronJobRecord`, `CronJobRepository`, `CronJobTool`, and `CronJobScheduler` names are introduced before use and reused consistently.
