import { spawn } from "node:child_process";
import { appendFileSync } from "node:fs";

export type CommandOptions = {
  input?: string;
  stdoutFile?: string;
  stderrFile?: string;
  allowFailure?: boolean;
};
export type CommandResult = { code: number; stdout: string; stderr: string };
export type CommandRunner = (
  command: string[],
  options?: CommandOptions,
) => Promise<CommandResult>;

export function formatCommand(command: string[]): string {
  return command.map((arg) => JSON.stringify(arg)).join(" ");
}

export function createRunner(
  cwd: string,
  logFile?: string | ((line: string) => void),
): CommandRunner {
  return async (command, options = {}) => {
    const started = Date.now();
    let stdout = "";
    let stderr = "";
    const code = await new Promise<number>((resolve) => {
      const child = spawn(command[0], command.slice(1), { cwd, stdio: "pipe" });
      child.stdout.on("data", (chunk) => {
        if (options.stdoutFile) appendFileSync(options.stdoutFile, chunk);
        else stdout += chunk.toString();
      });
      child.stderr.on("data", (chunk) => {
        if (options.stderrFile) appendFileSync(options.stderrFile, chunk);
        else stderr += chunk.toString();
      });
      child.on("error", (error) => {
        stderr += error.message;
      });
      child.stdin.on("error", (error: NodeJS.ErrnoException) => {
        if (error.code !== "EPIPE") stderr += error.message;
      });
      child.on("close", (exitCode) => resolve(exitCode ?? 127));
      child.stdin.end(options.input);
    });
    const line = `${formatCommand(command)} exit=${code} duration_ms=${Date.now() - started}\n`;
    if (typeof logFile === "function") logFile(line);
    else if (logFile) appendFileSync(logFile, line);
    else process.stdout.write(line);
    if (code !== 0 && !options.allowFailure) {
      throw new Error(`${line.trim()}\n${stderr || stdout}`);
    }
    return { code, stdout, stderr };
  };
}
