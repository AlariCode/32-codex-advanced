import type { TestContext } from "node:test";
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CommandRunner } from "./exec.ts";
import type { AgentReport } from "./report.ts";
import { runTaskAttempts } from "./iteration.ts";

type Step = {
  threadId?: string;
  status?: AgentReport["status"];
  code?: number;
  malformed?: boolean;
};
type Scenario = {
  agents?: Step[];
  checks?: boolean[];
  commits?: boolean[];
  outputs?: string[];
};

export function fixture(t: TestContext, scenario: Scenario = {}) {
  const root = mkdtempSync(join(tmpdir(), "ralph-iteration-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const directory = join(root, "issue-8");
  mkdirSync(directory);
  const log = join(root, "run.log");
  writeFileSync(log, "");
  const calls: { command: string[]; prompt?: string }[] = [];
  let checks = 0;
  let commits = 0;
  let agents = 0;
  const run: CommandRunner = async (command, options = {}) => {
    calls.push({ command, prompt: options.input });
    let code = 0;
    let stdout = "";
    let stderr = "";
    if (command[0] === "go") stdout = "/tmp/ralph-cache\n";
    else if (command[0] === "codex") {
      const step = scenario.agents?.[agents++] ?? { threadId: "thread-1" };
      code = step.code ?? 0;
      stdout =
        JSON.stringify(
          step.threadId
            ? { type: "thread.started", thread_id: step.threadId }
            : { type: "turn.completed" },
        ) + "\n";
      stderr = code ? "no rollout found" : "";
      writeFileSync(
        command[command.indexOf("-o") + 1],
        step.malformed
          ? "broken"
          : JSON.stringify({
              status: step.status ?? "done",
              summary: `agent-${agents}`,
              commit_message: "Task commit",
            }),
      );
    } else if (command[0] === "check") {
      stdout = scenario.outputs?.[checks] ?? `check-${checks + 1}\n`;
      code = scenario.checks?.[checks++] === false ? 1 : 0;
    } else if (command[0] === "git" && command[1] === "status")
      stdout = " M source.ts\n";
    else if (command[0] === "git" && command[1] === "commit") {
      code = scenario.commits?.[commits++] === false ? 1 : 0;
      stderr = code ? "lefthook failed\n" : "";
    } else if (!(command[0] === "git" && command[1] === "add"))
      throw new Error(`Unexpected command: ${command}`);
    if (options.stdoutFile) {
      appendFileSync(options.stdoutFile, stdout);
      stdout = "";
    }
    if (options.stderrFile) {
      appendFileSync(options.stderrFile, stderr);
      stderr = "";
    }
    if (code && !options.allowFailure)
      throw new Error(`Command failed: ${command}`);
    return { code, stdout, stderr };
  };
  const template = "Task #{{number}} {{title}}\n{{body}}\nOriginal constraints";
  const fixTemplate = readFileSync(
    new URL("./ralph-fix.md", import.meta.url),
    "utf8",
  );
  return {
    directory,
    log,
    calls,
    read: (name: string) => readFileSync(join(directory, name), "utf8"),
    runLog: () => readFileSync(log, "utf8"),
    launch: (maxFixAttempts = 3) =>
      runTaskAttempts({
        run,
        directory,
        log,
        task: {
          number: 8,
          title: "Formatting",
          body: "Acceptance criteria",
          labels: [],
        },
        template,
        fixTemplate,
        checks: [["check"]],
        maxFixAttempts,
      }),
    codex: () => calls.filter(({ command }) => command[0] === "codex"),
    count: (name: string) =>
      calls.filter(({ command }) => command[0] === name || command[1] === name)
        .length,
  };
}
