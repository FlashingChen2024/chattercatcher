import { describe, expect, it, vi } from "vitest";
import { updateChatterCatcher, type UpdateCommandRunner } from "../../src/update/npm-updater.js";

function createRunner(outputs: string[]): UpdateCommandRunner {
  const runner = vi.fn<UpdateCommandRunner>();
  for (const output of outputs) {
    runner.mockResolvedValueOnce({ stdout: output, stderr: "" });
  }
  return runner;
}

describe("npm updater", () => {
  it("returns up-to-date when current version matches npm latest", async () => {
    const runner = createRunner(['"0.1.7"\n']);

    const result = await updateChatterCatcher({ currentVersion: "0.1.7", runner });

    expect(result).toEqual({
      status: "up-to-date",
      currentVersion: "0.1.7",
      latestVersion: "0.1.7",
      command: "npm install -g chattercatcher@latest",
    });
    expect(runner).toHaveBeenCalledTimes(1);
    expect(runner).toHaveBeenCalledWith("npm", ["view", "chattercatcher", "version", "--json"]);
  });

  it("returns up-to-date without installing when current version is newer than npm latest", async () => {
    const runner = createRunner(['"0.1.7"\n']);

    const result = await updateChatterCatcher({ currentVersion: "0.1.8", runner });

    expect(result).toEqual({
      status: "up-to-date",
      currentVersion: "0.1.8",
      latestVersion: "0.1.7",
      command: "npm install -g chattercatcher@latest",
    });
    expect(runner).toHaveBeenCalledTimes(1);
  });

  it("returns dry-run result without installing when latest is newer", async () => {
    const runner = createRunner(['"0.1.8"\n']);

    const result = await updateChatterCatcher({ currentVersion: "0.1.7", dryRun: true, runner });

    expect(result).toEqual({
      status: "dry-run",
      currentVersion: "0.1.7",
      latestVersion: "0.1.8",
      command: "npm install -g chattercatcher@latest",
    });
    expect(runner).toHaveBeenCalledTimes(1);
  });

  it("installs latest package when latest is newer", async () => {
    const runner = createRunner(['"0.1.8"\n', "updated\n"]);

    const result = await updateChatterCatcher({ currentVersion: "0.1.7", runner });

    expect(result).toEqual({
      status: "updated",
      currentVersion: "0.1.7",
      latestVersion: "0.1.8",
      command: "npm install -g chattercatcher@latest",
    });
    expect(runner).toHaveBeenCalledTimes(2);
    expect(runner).toHaveBeenNthCalledWith(2, "npm", ["install", "-g", "chattercatcher@latest"]);
  });

  it("returns query-failed when npm returns invalid JSON", async () => {
    const runner = createRunner(["not-json\n"]);

    const result = await updateChatterCatcher({ currentVersion: "0.1.7", runner });

    expect(result).toEqual({
      status: "query-failed",
      currentVersion: "0.1.7",
      command: "npm install -g chattercatcher@latest",
      error: "npm registry returned an invalid version",
    });
  });

  it("returns query-failed when npm latest lookup fails", async () => {
    const runner = vi.fn<UpdateCommandRunner>().mockRejectedValueOnce(new Error("network down"));

    const result = await updateChatterCatcher({ currentVersion: "0.1.7", runner });

    expect(result).toEqual({
      status: "query-failed",
      currentVersion: "0.1.7",
      command: "npm install -g chattercatcher@latest",
      error: "network down",
    });
    expect(runner).toHaveBeenCalledTimes(1);
  });

  it("returns install-failed when global npm install fails", async () => {
    const runner = vi.fn<UpdateCommandRunner>();
    runner.mockResolvedValueOnce({ stdout: '"0.1.8"\n', stderr: "" });
    runner.mockRejectedValueOnce(new Error("permission denied"));

    const result = await updateChatterCatcher({ currentVersion: "0.1.7", runner });

    expect(result).toEqual({
      status: "install-failed",
      currentVersion: "0.1.7",
      latestVersion: "0.1.8",
      command: "npm install -g chattercatcher@latest",
      error: "permission denied",
    });
    expect(runner).toHaveBeenCalledTimes(2);
  });
});
