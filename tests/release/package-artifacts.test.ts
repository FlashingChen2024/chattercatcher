import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const projectRoot = path.resolve(import.meta.dirname, "../..");

describe("release package artifacts", () => {
  it("发布前会重新构建 dist", () => {
    const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf8")) as {
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts?.prepack).toBe("npm run build");
  });

  it("构建后的 CLI 版本与 package.json 一致", () => {
    const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf8")) as {
      version: string;
    };

    const output = execFileSync(process.execPath, [path.join(projectRoot, "dist/cli.js"), "--version"], {
      encoding: "utf8",
    }).trim();

    expect(output).toBe(packageJson.version);
  });
});
