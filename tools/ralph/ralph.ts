import { runPhaseTasks } from "./phase-loop.ts";
import * as fs from "node:fs";
import { join } from "node:path";
import { createRunner } from "./exec.ts";
import * as tasks from "./tasks.ts";
import * as git from "./git.ts";
import { loadConfig, parseOptions } from "./config.ts";
import { showDryRun } from "./dry-run.ts";
import { preflight } from "./preflight.ts";
import { collectUsage, renderSummary } from "./summary.ts";
import type { RunSummary } from "./summary.ts";

async function runLoop() {
  const started = Date.now();
  const options = parseOptions();
  const startupLog: string[] = [];
  const initial = createRunner(process.cwd(), (line) => startupLog.push(line));
  const root = (
    await initial(["git", "rev-parse", "--show-toplevel"])
  ).stdout.trim();
  const directory = join(
    root,
    ".ralph/runs",
    new Date(started).toISOString().replaceAll(":", "-") + `-${process.pid}`,
  );
  const log = join(directory, "run.log");
  const summaryPath = join(directory, "summary.md");
  if (!options.dryRun) {
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(log, startupLog.join(""));
  } else process.stdout.write(startupLog.join(""));
  const run = createRunner(root, options.dryRun ? undefined : log);
  const state: RunSummary = {
    phase: String(options.phase),
    started,
    ended: started,
    usage: { input: 0, cached: 0, output: 0 },
    closed: [],
    blocked: [],
    failed: [],
    returns: { check: 0, review: 0 },
    reason: "ошибка раннера",
  };
  let config: ReturnType<typeof loadConfig> | undefined;
  let phaseReady = false;
  try {
    config = loadConfig(
      join(root, "tools/ralph/ralph.config.json"),
      options.phase,
    );
    state.phase = `${options.phase} (${config.branch})`;
    await git.assertClean(run);
    const next = async () =>
      tasks.selectNextTask(
        await tasks.listTasks(run, config!.label),
        (number) => tasks.dependencyState(run, number),
      );
    if (options.dryRun) {
      showDryRun(await next(), config, options.max, options.skipPreflight);
      return;
    }
    await git.ensurePhaseBranch(run, config.branch);
    phaseReady = true;
    if (
      !options.skipPreflight &&
      !(await preflight(run, config.checks, directory))
    ) {
      state.reason = "preflight";
      state.detail = "окружение или ветка фазы уже красные";
      process.exitCode = 1;
      return;
    }
    await runPhaseTasks(run, config, state, {
      root,
      directory,
      log,
      max: options.max,
    });
  } catch (error) {
    state.reason = "ошибка раннера";
    state.detail = error instanceof Error ? error.message : String(error);
    if (options.dryRun) throw error;
    fs.appendFileSync(log, `${state.detail}\n`);
    process.exitCode = 1;
  } finally {
    if (!options.dryRun) {
      state.ended = Date.now();
      state.usage = collectUsage(directory);
      fs.writeFileSync(summaryPath, renderSummary(state));
      try {
        if (config && phaseReady)
          await tasks.ensurePhasePR(run, config.branch, renderSummary(state));
      } catch (error) {
        state.reason = "ошибка раннера";
        state.detail = `${state.detail ? state.detail + "; " : ""}Публикация отчёта: ${String(error)}`;
        fs.appendFileSync(log, `${state.detail}\n`);
        fs.writeFileSync(summaryPath, renderSummary(state));
        process.exitCode = 1;
      } finally {
        console.log(renderSummary(state));
        console.log(summaryPath);
      }
    }
  }
}
runLoop().catch((error) => {
  console.error(String(error));
  process.exitCode = 1;
});
