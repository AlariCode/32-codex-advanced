import { codexArgs } from "./agent.ts";
import { reviewArgs } from "./review.ts";
import type { Config } from "./config.ts";
import { formatCommand } from "./exec.ts";
import type { Task } from "./tasks.ts";

export function showDryRun(
  task: Task | undefined,
  config: Config,
  max?: number,
) {
  console.log(
    task ? `Selected #${task.number}: ${task.title}` : "No eligible tasks",
  );
  console.log(
    `Phase branch: ${config.branch}; limit: ${max ?? config.maxIterations}; maxFixAttempts: ${config.maxFixAttempts}`,
  );
  if (task) {
    const args = {
      schema: "<schema>",
      report: "<report-N.json>",
      cache: "<GOCACHE>",
    };
    const commands = [
      ["git", "fetch", "origin"],
      ["git", "switch", config.branch],
      ["git", "switch", "-c", `issue-${task.number}`, config.branch],
      ["go", "env", "GOCACHE"],
      ["codex", ...codexArgs(args)],
      ["git", "status", "--porcelain"],
      ...config.checks,
      ["git", "add", "-A"],
      ...(config.review.enabled
        ? [
            ["git", "diff", "--cached", "--no-color"],
            ["codex", ...reviewArgs("<review.schema.json>", "<review-N.json>")],
          ]
        : []),
      ["git", "commit", "-m", "<commit_message>"],
    ];
    if (config.review.enabled)
      console.log(
        "After green checks: save staged diff to review-N.diff; review changes and unmet criteria use the shared fix budget. Reviewer failure: retry once, then stop.",
      );
    commands.forEach((command) => console.log(formatCommand(command)));
    console.log(
      "On red checks or commit hook failure: resume with ralph-fix.md and the last 80 log lines, then repeat checks and commit:",
    );
    console.log(
      formatCommand([
        "codex",
        ...codexArgs({ ...args, threadId: "<thread_id>" }),
      ]),
    );
    console.log(
      `At most ${config.maxFixAttempts} fixes. Missing thread ID or failed resume: one fresh fallback per fix with the task and diagnostics, logged in run.log. Exhaustion: comment and stop.`,
    );
    [
      ["git", "switch", config.branch],
      ["git", "merge", "--no-ff", "--no-edit", `issue-${task.number}`],
      ["git", "push", "-u", "origin", config.branch],
      ["gh", "issue", "comment", String(task.number), "--body-file", "-"],
      ["gh", "issue", "close", String(task.number)],
    ].forEach((command) => console.log(formatCommand(command)));
    console.log(
      "Existing task branch: switch without resetting commits. Missing phase branch: create from origin/main and push. Blocked: stash and label; failed: comment and stop.",
    );
    console.log(
      "On merge conflicts: run Codex once, stage resolved paths, rerun checks, commit the pending merge and push. Failure preserves work and leaves the issue open.",
    );
  }
  console.log(
    formatCommand([
      "gh",
      "pr",
      "list",
      "--head",
      config.branch,
      "--base",
      "main",
      "--state",
      "open",
      "--json",
      "number",
    ]),
  );
  console.log(
    "When exhausted and no PR exists: gh pr create --head <phase> --base main --title <title> --body-file -",
  );
}
