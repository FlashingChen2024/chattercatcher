import os from "node:os";
import path from "node:path";

export function getChatterCatcherHome(): string {
  return process.env.CHATTERCATCHER_HOME || path.join(os.homedir(), ".chattercatcher");
}

export function resolveHomePath(value: string): string {
  if (value === "~") {
    return os.homedir();
  }

  if (value.startsWith("~/") || value.startsWith("~\\")) {
    return path.join(os.homedir(), value.slice(2));
  }

  return path.resolve(value);
}

export function getConfigPath(): string {
  return path.join(getChatterCatcherHome(), "config.json");
}

export function getSecretsPath(): string {
  return path.join(getChatterCatcherHome(), "secrets.json");
}
