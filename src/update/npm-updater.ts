import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const packageName = "chattercatcher";
const installArgs = ["install", "-g", `${packageName}@latest`];
const latestVersionArgs = ["view", packageName, "version", "--json"];

export interface UpdateCommandOutput {
  stdout: string;
  stderr: string;
}

export type UpdateCommandRunner = (command: string, args: string[]) => Promise<UpdateCommandOutput>;

export type UpdateResult =
  | { status: "up-to-date"; currentVersion: string; latestVersion: string; command: string }
  | { status: "dry-run"; currentVersion: string; latestVersion: string; command: string }
  | { status: "updated"; currentVersion: string; latestVersion: string; command: string }
  | { status: "query-failed"; currentVersion: string; command: string; error: string }
  | { status: "install-failed"; currentVersion: string; latestVersion: string; command: string; error: string };

export interface UpdateOptions {
  currentVersion: string;
  dryRun?: boolean;
  runner?: UpdateCommandRunner;
}

function formatCommand(command: string, args: string[]): string {
  return [command, ...args].join(" ");
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function parseLatestVersion(stdout: string): string {
  const trimmed = stdout.trim();
  if (!trimmed) {
    throw new Error("npm registry returned an empty version");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed) as unknown;
  } catch {
    throw new Error("npm registry returned an invalid version");
  }

  if (typeof parsed !== "string" || !parsed) {
    throw new Error("npm registry returned an invalid version");
  }

  return parsed;
}

function compareVersions(left: string, right: string): number {
  const leftParts = left.split(".").map((part) => Number(part));
  const rightParts = right.split(".").map((part) => Number(part));
  const length = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < length; index += 1) {
    const leftPart = leftParts[index] ?? 0;
    const rightPart = rightParts[index] ?? 0;
    if (leftPart > rightPart) {
      return 1;
    }
    if (leftPart < rightPart) {
      return -1;
    }
  }

  return 0;
}

export async function defaultUpdateCommandRunner(command: string, args: string[]): Promise<UpdateCommandOutput> {
  const { stdout, stderr } = await execFileAsync(command, args);
  return { stdout, stderr };
}

export async function updateChatterCatcher(options: UpdateOptions): Promise<UpdateResult> {
  const runner = options.runner ?? defaultUpdateCommandRunner;
  const command = formatCommand("npm", installArgs);

  let latestVersion: string;
  try {
    const output = await runner("npm", latestVersionArgs);
    latestVersion = parseLatestVersion(output.stdout);
  } catch (error) {
    return {
      status: "query-failed",
      currentVersion: options.currentVersion,
      command,
      error: getErrorMessage(error),
    };
  }

  if (compareVersions(latestVersion, options.currentVersion) <= 0) {
    return {
      status: "up-to-date",
      currentVersion: options.currentVersion,
      latestVersion,
      command,
    };
  }

  if (options.dryRun) {
    return {
      status: "dry-run",
      currentVersion: options.currentVersion,
      latestVersion,
      command,
    };
  }

  try {
    await runner("npm", installArgs);
  } catch (error) {
    return {
      status: "install-failed",
      currentVersion: options.currentVersion,
      latestVersion,
      command,
      error: getErrorMessage(error),
    };
  }

  return {
    status: "updated",
    currentVersion: options.currentVersion,
    latestVersion,
    command,
  };
}
