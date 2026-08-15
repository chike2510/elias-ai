import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { ToolResult, WorkspaceFile } from "@/lib/types";

const execFileAsync = promisify(execFile);
const MAX_OUTPUT = 80_000;
const MAX_RUNTIME_MS = 120_000;

const COMMANDS: Record<string, string[]> = {
  build: ["run", "build"],
  typecheck: ["run", "typecheck"],
  lint: ["run", "lint"],
  test: ["test"],
};

function safePath(value: string) {
  const normalized = value.replaceAll("\\", "/").replace(/^\.\//, "");
  if (!normalized || normalized.startsWith("/") || normalized.split("/").some((part) => part === ".." || part === "")) return null;
  return normalized;
}

export function executionEnabled() {
  return process.env.ELIAS_EXECUTION_ENABLED === "true";
}

export async function runWorkspaceValidation(
  files: WorkspaceFile[],
  check: keyof typeof COMMANDS,
): Promise<ToolResult> {
  const startedAt = Date.now();
  if (!executionEnabled()) {
    return {
      type: "run_validation",
      result: { check, available: false, reason: "Execution is disabled. Set ELIAS_EXECUTION_ENABLED=true on a trusted isolated worker." },
      startedAt,
      completedAt: Date.now(),
    };
  }

  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "elias-task-"));
  try {
    for (const file of files) {
      const relative = safePath(file.path);
      if (!relative || file.content.length > 1_000_000) continue;
      const target = path.join(tempRoot, relative);
      const parent = path.dirname(target);
      await import("node:fs/promises").then(({ mkdir }) => mkdir(parent, { recursive: true }));
      await writeFile(target, file.content, "utf8");
    }

    const [command, ...args] = COMMANDS[check];
    try {
      const result = await execFileAsync(command, args, {
        cwd: tempRoot,
        shell: false,
        timeout: MAX_RUNTIME_MS,
        maxBuffer: 1_000_000,
        env: {
          ...process.env,
          CI: "1",
          HOME: tempRoot,
          npm_config_update_notifier: "false",
          npm_config_audit: "false",
          npm_config_fund: "false",
        },
      });
      return {
        type: "run_validation",
        result: { check, available: true, passed: true, stdout: result.stdout.slice(-MAX_OUTPUT), stderr: result.stderr.slice(-MAX_OUTPUT) },
        startedAt,
        completedAt: Date.now(),
      };
    } catch (error) {
      const value = error as { stdout?: string; stderr?: string; code?: string | number; signal?: string };
      return {
        type: "run_validation",
        result: { check, available: true, passed: false, code: value.code, signal: value.signal, stdout: String(value.stdout || "").slice(-MAX_OUTPUT), stderr: String(value.stderr || "").slice(-MAX_OUTPUT) },
        error: `${check} failed`,
        startedAt,
        completedAt: Date.now(),
      };
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}
