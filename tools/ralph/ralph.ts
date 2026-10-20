import * as fs from "node:fs";
import { join } from "node:path";
import { createRunner } from "./exec.ts";
import * as tasks from "./tasks.ts";
import * as git from "./git.ts";
import { loadConfig, parseOptions } from "./config.ts";
import { showDryRun } from "./dry-run.ts";
import { runTaskAttempts } from "./iteration.ts";
import { mergeTask } from "./merge-task.ts";
import { closingSummary } from "./review-step.ts";

async function runLoop() {
  const options = parseOptions();
  const startupLog: string[] = [];
  const initial = createRunner(process.cwd(), (line) => startupLog.push(line));
  const root = (
    await initial(["git", "rev-parse", "--show-toplevel"])
  ).stdout.trim();
  const config = loadConfig(
    join(root, "tools/ralph/ralph.config.json"),
    options.phase,
  );
  const directory = join(
    root,
    ".ralph/runs",
    new Date().toISOString().replaceAll(":", "-") + `-${process.pid}`,
  );
  const log = join(directory, "run.log");
  if (!options.dryRun) {
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(log, startupLog.join(""));
  } else process.stdout.write(startupLog.join(""));
  const run = createRunner(root, options.dryRun ? undefined : log);
  await git.assertClean(run);
  const next = async () =>
    tasks.selectNextTask(await tasks.listTasks(run, config.label), (number) =>
      tasks.dependencyState(run, number),
    );
  let task = await next();
  if (options.dryRun) {
    showDryRun(task, config, options.max);
    return;
  }
  await git.ensurePhaseBranch(run, config.branch);
  const template = fs.readFileSync(join(root, "tools/ralph/ralph.md"), "utf8");
  const fixTemplate = fs.readFileSync(
    join(root, "tools/ralph/ralph-fix.md"),
    "utf8",
  );
  const reviewTemplate = config.review.enabled
    ? fs.readFileSync(join(root, "tools/ralph/ralph-review.md"), "utf8")
    : undefined;
  const closed: number[] = [];
  for (
    let iteration = 0;
    iteration < (options.max ?? config.maxIterations);
    iteration++
  ) {
    if (!task) {
      await tasks.ensurePhasePR(run, config.branch, closed);
      return;
    }
    const current = task;
    const artifacts = join(directory, `issue-${current.number}`);
    fs.mkdirSync(artifacts, { recursive: true });
    try {
      await git.startTaskBranch(run, current.number, config.branch);
      const { report, nonBlocking } = await runTaskAttempts({
        run,
        directory: artifacts,
        log,
        task: current,
        template,
        fixTemplate,
        checks: config.checks,
        maxFixAttempts: config.maxFixAttempts,
        review: config.review,
        reviewTemplate,
      });
      if (report.status === "blocked") {
        const stash = await git.parkBlockedChanges(
          run,
          config.branch,
          current.number,
        );
        fs.appendFileSync(
          log,
          `blocked #${current.number} stash=${stash || "none"}\n`,
        );
        await tasks.markBlocked(
          run,
          current.number,
          report.summary +
            (stash ? `\n\nSaved changes: git stash apply ${stash}` : ""),
        );
      } else if (report.status === "failed") {
        throw new Error(
          `Agent failed on #${current.number}: ${report.summary}`,
        );
      } else {
        await mergeTask(
          run,
          current.number,
          config.branch,
          artifacts,
          log,
          config.checks,
        );
        await tasks.closeTask(
          run,
          current.number,
          closingSummary(report.summary, nonBlocking),
        );
        closed.push(current.number);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      fs.appendFileSync(log, `${message}\n`);
      await tasks
        .commentTask(run, current.number, `Ralph stopped: ${message}`)
        .catch((failure) => {
          fs.appendFileSync(log, `Could not comment: ${String(failure)}\n`);
        });
      throw error;
    }
    task = await next();
  }
  if (!task) await tasks.ensurePhasePR(run, config.branch, closed);
  else console.log("Iteration limit reached; loop stopped.");
}

runLoop().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
