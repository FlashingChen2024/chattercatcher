import { describe, expect, it, vi } from "vitest";
import { createIndexingScheduler, matchesCronMinuteSchedule } from "../../src/gateway/indexing-scheduler.js";

describe("matchesCronMinuteSchedule", () => {
  it("matches */10 at minute 0 and 10 but not 11", () => {
    expect(matchesCronMinuteSchedule("*/10 * * * *", new Date("2026-05-03T00:00:00.000Z"))).toBe(true);
    expect(matchesCronMinuteSchedule("*/10 * * * *", new Date("2026-05-03T00:10:00.000Z"))).toBe(true);
    expect(matchesCronMinuteSchedule("*/10 * * * *", new Date("2026-05-03T00:11:00.000Z"))).toBe(false);
  });
});

describe("createIndexingScheduler", () => {
  it("disables invalid schedules safely without calling work", async () => {
    const work = vi.fn(async () => undefined);
    const setIntervalFn = vi.fn(() => 123 as ReturnType<typeof setInterval>);

    const scheduler = createIndexingScheduler({
      schedule: "bad cron",
      work,
      now: () => new Date("2026-05-03T00:00:00.000Z"),
      setIntervalFn,
    });

    scheduler.start();
    await scheduler.runDueNow();
    scheduler.stop();

    expect(setIntervalFn).not.toHaveBeenCalled();
    expect(work).not.toHaveBeenCalled();
  });

  it("does not overlap async ticks while previous run is active", async () => {
    let releaseFirstRun = false;
    let secondInvocation = false;
    const work = vi.fn(async () => {
      if (!releaseFirstRun) {
        await new Promise<void>((resolve) => {
          const poll = () => {
            if (releaseFirstRun) {
              resolve();
              return;
            }
            queueMicrotask(poll);
          };
          poll();
        });
        return;
      }

      secondInvocation = true;
    });

    const scheduler = createIndexingScheduler({
      schedule: "* * * * *",
      work,
      now: () => new Date("2026-05-03T00:00:00.000Z"),
    });

    const firstRun = scheduler.runDueNow();
    await Promise.resolve();
    await scheduler.runDueNow();

    expect(work).toHaveBeenCalledTimes(1);
    expect(secondInvocation).toBe(false);

    releaseFirstRun = true;
    await firstRun;
    await scheduler.runDueNow();

    expect(work).toHaveBeenCalledTimes(2);
    expect(secondInvocation).toBe(true);
  });
});
