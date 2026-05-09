interface ParsedCronSchedule {
  minute: ParsedField;
  hour: ParsedField;
  dayOfMonth: ParsedField;
  month: ParsedField;
  dayOfWeek: ParsedField;
}

type FieldMatcher = (value: number) => boolean;

interface ParsedField {
  wildcard: boolean;
  matches: FieldMatcher;
}

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

  const maxMinutes = 5 * 366 * 24 * 60;
  for (let i = 0; i < maxMinutes; i += 1) {
    if (matchesParsedSchedule(parsed, candidate)) {
      return new Date(candidate);
    }
    candidate.setMinutes(candidate.getMinutes() + 1);
  }

  return null;
}

function matchesParsedSchedule(schedule: ParsedCronSchedule, date: Date): boolean {
  const dayOfMonthMatches = schedule.dayOfMonth.matches(date.getDate());
  const dayOfWeekMatches = schedule.dayOfWeek.matches(date.getDay());
  const dayMatches = schedule.dayOfMonth.wildcard || schedule.dayOfWeek.wildcard
    ? dayOfMonthMatches && dayOfWeekMatches
    : dayOfMonthMatches || dayOfWeekMatches;

  return (
    schedule.minute.matches(date.getMinutes()) &&
    schedule.hour.matches(date.getHours()) &&
    dayMatches &&
    schedule.month.matches(date.getMonth() + 1)
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

function parseMinuteField(field: string): ParsedField | null {
  if (field === "*") {
    return { wildcard: true, matches: () => true };
  }

  const stepMatch = /^\*\/(\d+)$/.exec(field);
  if (stepMatch) {
    const step = Number(stepMatch[1]);
    if (!Number.isInteger(step) || step <= 0 || step > 59) {
      return null;
    }

    return { wildcard: false, matches: (value) => value % step === 0 };
  }

  if (field.includes(",")) {
    const values = field.split(",").map((part) => parseExactNumber(part, 0, 59));
    if (values.some((value) => value === null)) {
      return null;
    }

    const allowed = new Set(values as number[]);
    return { wildcard: false, matches: (value) => allowed.has(value) };
  }

  const exact = parseExactNumber(field, 0, 59);
  if (exact === null) {
    return null;
  }

  return { wildcard: false, matches: (value) => value === exact };
}

function parseExactOrWildcardField(field: string, min: number, max: number): ParsedField | null {
  if (field === "*") {
    return { wildcard: true, matches: () => true };
  }

  const exact = parseExactNumber(field, min, max);
  if (exact === null) {
    return null;
  }

  return { wildcard: false, matches: (value) => value === exact };
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
