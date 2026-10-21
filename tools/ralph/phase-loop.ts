import * as fs from "node:fs";
import { join } from "node:path";
import type { CommandRunner } from "./exec.ts";
import type { Config } from "./config.ts";
import type { RunSummary } from "./summary.ts";
import { collectUsage } from "./summary.ts";
import * as tasks from "./tasks.ts";
import * as git from "./git.ts";
import { runTaskAttempts } from "./iteration.ts";
import { mergeTask } from "./merge-task.ts";
import { closingSummary } from "./review-step.ts";
import { budgetStop, failureStreak, TaskFailure } from "./run-state.ts";
import { parkTask } from "./task-outcome.ts";

export async function runPhaseTasks(
  run: CommandRunner,
  config: Config,
  state: RunSummary,
  paths: { root: string; directory: string; log: string; max?: number },
) {
  const next = async () =>
    tasks.selectNextTask(await tasks.listTasks(run, config.label), (number) =>
      tasks.dependencyState(run, number),
    );
  const template = fs.readFileSync(
    join(paths.root, "tools/ralph/ralph.md"),
    "utf8",
  );
  const fixTemplate = fs.readFileSync(
    join(paths.root, "tools/ralph/ralph-fix.md"),
    "utf8",
  );
  const reviewTemplate = config.review.enabled
    ? fs.readFileSync(join(paths.root, "tools/ralph/ralph-review.md"), "utf8")
    : undefined;
  let consecutive = 0;
  const limit = paths.max ?? config.maxIterations;
  for (let iteration = 0; ; iteration++) {
    state.usage = collectUsage(paths.directory);
    const budget = budgetStop(config, state.started, state.usage);
    if (budget) {
      state.reason = budget;
      break;
    }
    const current = await next();
    if (!current) {
      state.reason = "задачи кончились";
      break;
    }
    if (iteration >= limit) {
      state.reason = "лимит итераций";
      break;
    }
    const afterSelection = budgetStop(config, state.started, state.usage);
    if (afterSelection) {
      state.reason = afterSelection;
      break;
    }
    const artifacts = join(paths.directory, `issue-${current.number}`);
    fs.mkdirSync(artifacts, { recursive: true });
    await git.startTaskBranch(run, current.number, config.branch);
    let status: "done" | "blocked" | "failed";
    try {
      const { report } = await runTaskAttempts({
        run,
        directory: artifacts,
        log: paths.log,
        task: current,
        template,
        fixTemplate,
        checks: config.checks,
        maxFixAttempts: config.maxFixAttempts,
        review: config.review,
        reviewTemplate,
        onReturn: (kind) => state.returns[kind]++,
      });
      status = report.status;
      if (status !== "done") {
        await parkTask(
          run,
          config.branch,
          current.number,
          status,
          report.summary,
          paths.log,
          state,
        );
      } else {
        await mergeTask(
          run,
          current.number,
          config.branch,
          artifacts,
          paths.log,
          config.checks,
        );
        await tasks.closeTask(
          run,
          current.number,
          closingSummary(report.summary, config.review.enabled),
        );
        state.closed.push(current.number);
      }
    } catch (error) {
      if (!(error instanceof TaskFailure)) throw error;
      status = "failed";
      await parkTask(
        run,
        config.branch,
        current.number,
        status,
        error.message,
        paths.log,
        state,
      );
    }
    consecutive = failureStreak(consecutive, status);
    if (consecutive >= config.maxConsecutiveFailures) {
      state.reason = "предохранитель";
      state.detail = `${consecutive} неудач подряд`;
      break;
    }
  }
}
