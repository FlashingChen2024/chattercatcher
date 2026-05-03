export interface IndexingScheduler {
  start(): void;
  stop(): void;
  runDueNow(): Promise<void>;
}

interface CreateIndexingSchedulerOptions {
  schedule: string;
  work: () => Promise<void>;
  now?: () => Date;
  setIntervalFn?: typeof setInterval;
  clearIntervalFn?: typeof clearInterval;
  logger?: Pick<Console, "error" | "warn">;
}

interface ParsedCronSchedule {
  minute: MinuteMatcher;
  hour: FieldMatcher;
  dayOfMonth: FieldMatcher;
  month: FieldMatcher;
  dayOfWeek: FieldMatcher;
}

type FieldMatcher = (value: number) => boolean;
type MinuteMatcher = FieldMatcher;

export function matchesCronMinuteSchedule(schedule: string, date: Date): boolean {
  const parsed = parseCronSchedule(schedule);
  if (!parsed) {
    return false;
  }

  return (
    parsed.minute(date.getMinutes()) &&
    parsed.hour(date.getHours()) &&
    parsed.dayOfMonth(date.getDate()) &&
    parsed.month(date.getMonth() + 1) &&
    parsed.dayOfWeek(date.getDay())
  );
}

export function createIndexingScheduler(options: CreateIndexingSchedulerOptions): IndexingScheduler {
  const now = options.now ?? (() => new Date());
  const setIntervalFn = options.setIntervalFn ?? setInterval;
  const clearIntervalFn = options.clearIntervalFn ?? clearInterval;
  const logger = options.logger ?? console;
  const parsed = parseCronSchedule(options.schedule);

  let timer: ReturnType<typeof setInterval> | undefined;
  let running = false;

  const runDueNow = async (): Promise<void> => {
    if (!parsed || running || !matchesParsedSchedule(parsed, now())) {
      return;
    }

    running = true;
    try {
      await options.work();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`定时消息索引失败：${message}`);
    } finally {
      running = false;
    }
  };

  return {
    start() {
      if (!parsed || timer) {
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

function parseMinuteField(field: string): MinuteMatcher | null {
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
