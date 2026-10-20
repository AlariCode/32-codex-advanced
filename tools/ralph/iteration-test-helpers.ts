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
import { createFakeCodex } from "./iteration-agent-mock.ts";
import type { Step, ReviewerStep } from "./iteration-agent-mock.ts";
import type { ReviewConfig } from "./review-report.ts";
import { runTaskAttempts } from "./iteration.ts";

type Scenario = {
  agents?: Step[];
  checks?: boolean[];
  commits?: boolean[];
  outputs?: string[];
  review?: ReviewConfig;
  reviewers?: ReviewerStep[];
  unchanged?: boolean;
  commentFailure?: boolean;
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
  const codex = createFakeCodex(scenario.agents, scenario.reviewers);
  const run: CommandRunner = async (command, options = {}) => {
    calls.push({ command, prompt: options.input });
    let code = 0;
    let stdout = "";
    let stderr = "";
    if (command[0] === "go") stdout = "/tmp/ralph-cache\n";
    else if (command[0] === "codex") {
      ({ code, stdout, stderr } = codex(command));
    } else if (command[0] === "gh") {
      if (scenario.commentFailure)
        throw new Error("GitHub comment unavailable");
      stdout = "";
    } else if (command[0] === "git" && command[1] === "ls-files") {
      stdout = "";
    } else if (command[0] === "check") {
      stdout = scenario.outputs?.[checks] ?? `check-${checks + 1}\n`;
      code = scenario.checks?.[checks] === false ? 1 : 0;
      checks++;
    } else if (command[0] === "git" && command[1] === "status")
      stdout = " M source.ts\n";
    else if (command[0] === "git" && command[1] === "diff")
      stdout = `diff --git a/source.ts b/source.ts\n+changed behavior ${scenario.unchanged ? 0 : checks}\n`;
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
        review: scenario.review,
        reviewTemplate: readFileSync(
          new URL("./ralph-review.md", import.meta.url),
          "utf8",
        ),
      }),
    codex: () =>
      calls.filter(
        ({ command }) =>
          command[0] === "codex" && !command.includes("read-only"),
      ),
    reviewers: () =>
      calls.filter(
        ({ command }) =>
          command[0] === "codex" && command.includes("read-only"),
      ),
    count: (name: string) =>
      calls.filter(({ command }) => command[0] === name || command[1] === name)
        .length,
  };
}
