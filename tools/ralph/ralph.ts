import * as fs from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { createRunner, formatCommand } from "./exec.ts";
import * as tasks from "./tasks.ts";
import * as git from "./git.ts";
import { renderPrompt, runAgent } from "./agent.ts";
import { runChecks, tailCheckLog } from "./checks.ts";

// prettier-ignore
type Config = { label: string; branch: string; maxIterations: number; checks: string[][] };
function positiveInteger(value: unknown, name: string): number {
  const number = Number(value);
  if (
    !/^\d+$/.test(String(value)) ||
    !Number.isSafeInteger(number) ||
    number < 1
  ) {
    throw new Error(`${name} must be a positive integer`);
  }
  return number;
}

// prettier-ignore
function parseOptions() {
  const { values } = parseArgs({ options: {
    phase: { type: 'string' }, 'dry-run': { type: 'boolean', default: false },
    'max-iterations': { type: 'string' },
  }, allowPositionals: false });
  const phase = positiveInteger(values.phase, '--phase');
  const max = values['max-iterations'];
  return { phase, dryRun: values['dry-run'], max: max === undefined ? undefined : positiveInteger(max, '--max-iterations') };
}

// prettier-ignore
function loadConfig(file: string, phase: number): Config {
  const config = JSON.parse(fs.readFileSync(file, 'utf8')) as Config;
  if (!config || typeof config.label !== 'string' || !config.label.trim() ||
    typeof config.branch !== 'string' || !config.branch.trim() ||
    !Array.isArray(config.checks) || !config.checks.length ||
    !config.checks.every((command) => Array.isArray(command) && command.length &&
      command.every((arg) => typeof arg === 'string') && command[0].trim())) {
    throw new Error('Invalid ralph.config.json');
  }
  config.maxIterations = positiveInteger(config.maxIterations, 'maxIterations');
  config.label = config.label.replaceAll('{phase}', String(phase));
  config.branch = config.branch.replaceAll('{phase}', String(phase));
  if (config.branch === 'main') throw new Error('Phase branch cannot be main');
  return config;
}

// prettier-ignore
async function runLoop() {
  const options = parseOptions();
  const startupLog: string[] = [];
  const initial = createRunner(process.cwd(), (line) => startupLog.push(line));
  const root = (await initial(['git', 'rev-parse', '--show-toplevel'])).stdout.trim();
  const config = loadConfig(join(root, 'tools/ralph/ralph.config.json'), options.phase);
  const directory = join(root, '.ralph/runs', new Date().toISOString().replaceAll(':', '-') + `-${process.pid}`);
  const log = join(directory, 'run.log');
  if (!options.dryRun) {
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(log, startupLog.join(''));
  } else process.stdout.write(startupLog.join(''));
  const run = createRunner(root, options.dryRun ? undefined : log);
  await git.assertClean(run);
  const next = async () => tasks.selectNextTask(await tasks.listTasks(run, config.label), (number) => tasks.dependencyState(run, number));
  let task = await next();
  if (options.dryRun) {
    console.log(task ? `Selected #${task.number}: ${task.title}` : 'No eligible tasks');
    console.log(`Phase branch: ${config.branch}; limit: ${options.max ?? config.maxIterations}`);
    if (task) {
      const commands = [
        ['git', 'fetch', 'origin'], ['git', 'switch', config.branch],
        ['git', 'switch', '-c', `issue-${task.number}`, config.branch],
        ['go', 'env', 'GOCACHE'], ['codex', 'exec', '--sandbox', 'workspace-write', '--json',
          '--output-schema', '<schema>', '-o', '<report.json>', '--add-dir', '<GOCACHE>', '-'],
        ['git', 'status', '--porcelain'], ...config.checks,
        ['git', 'add', '-A'], ['git', 'commit', '-m', '<commit_message>'],
        ['git', 'switch', config.branch], ['git', 'merge', '--no-ff', '--no-edit', `issue-${task.number}`],
        ['git', 'push', '-u', 'origin', config.branch],
        ['gh', 'issue', 'comment', String(task.number), '--body-file', '-'],
        ['gh', 'issue', 'close', String(task.number)],
      ];
      commands.forEach((command) => console.log(formatCommand(command)));
      console.log('Missing phase branch: create from origin/main and push. On red checks: one retry; blocked: stash and label; failed: comment and stop. At exhaustion: find/create phase PR.');
    }
    console.log(formatCommand(['gh', 'pr', 'list', '--head', config.branch, '--base', 'main', '--state', 'open', '--json', 'number']));
    console.log('When exhausted and no PR exists: gh pr create --head <phase> --base main --title <title> --body-file -');
    return;
  }
  await git.ensurePhaseBranch(run, config.branch);
  const template = fs.readFileSync(join(root, 'tools/ralph/ralph.md'), 'utf8');
  const closed: number[] = [];
  for (let iteration = 0; iteration < (options.max ?? config.maxIterations); iteration++) {
    if (!task) { await tasks.ensurePhasePR(run, config.branch, closed); return; }
    const current = task;
    const artifacts = join(directory, `issue-${current.number}`);
    fs.mkdirSync(artifacts, { recursive: true });
    const checkLog = join(artifacts, 'check.log');
    fs.writeFileSync(checkLog, '');
    try {
      await git.startTaskBranch(run, current.number, config.branch);
      let diagnostics = '';
      for (let attempt = 0; attempt < 2; attempt++) {
        if (attempt) {
          const archive = join(artifacts, 'attempt-1');
          fs.mkdirSync(archive);
          for (const file of ['prompt.md', 'events.jsonl', 'report.json', 'check.log', 'agent.log']) {
            fs.cpSync(join(artifacts, file), join(archive, file));
          }
        }
        const report = await runAgent(run, artifacts, renderPrompt(template, current, diagnostics));
        if (report.status === 'blocked') {
          const stash = await git.parkBlockedChanges(run, config.branch, current.number);
          fs.appendFileSync(log, `blocked #${current.number} stash=${stash || 'none'}\n`);
          await tasks.markBlocked(run, current.number, report.summary + (stash ? `\n\nSaved changes: git stash apply ${stash}` : ''));
          break;
        }
        if (report.status === 'failed') {
          throw new Error(`Agent failed on #${current.number}: ${report.summary}`);
        }
        const green = await runChecks(run, config.checks, checkLog);
        if (green && await git.commitTask(run, report.commit_message, checkLog)) {
          await git.mergeAndPush(run, current.number, config.branch);
          await tasks.closeTask(run, current.number, report.summary);
          closed.push(current.number);
          break;
        }
        diagnostics = tailCheckLog(checkLog);
        if (attempt === 1) throw new Error(`Second failed check for #${current.number}\n${report.summary}\n${diagnostics}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      fs.appendFileSync(log, `${message}\n`);
      await tasks.commentTask(run, current.number, `Ralph stopped: ${message}`).catch((failure) => {
        fs.appendFileSync(log, `Could not comment: ${String(failure)}\n`);
      });
      throw error;
    }
    task = await next();
  }
  if (!task) await tasks.ensurePhasePR(run, config.branch, closed);
  else console.log('Iteration limit reached; loop stopped.');
}

runLoop().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
