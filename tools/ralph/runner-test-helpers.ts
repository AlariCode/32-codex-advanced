import type { TestContext } from "node:test";
import {
  mkdtempSync,
  mkdirSync,
  cpSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  rmSync,
  realpathSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

export function runnerFixture(
  t: TestContext,
  statuses: string[],
  extra: object = {},
) {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), "ralph-runner-")));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const root = join(directory, "repo");
  const bin = join(directory, "bin");
  mkdirSync(join(root, "tools"), { recursive: true });
  mkdirSync(bin);
  cpSync(new URL(".", import.meta.url), join(root, "tools/ralph"), {
    recursive: true,
  });
  const config = {
    label: "phase-{phase}",
    branch: "ralph/phase-{phase}",
    maxIterations: 10,
    maxFixAttempts: 1,
    maxConsecutiveFailures: 2,
    checks: [
      [process.execPath, "-e", "process.exit(Number(process.env.RED || 0))"],
    ],
    ...extra,
  };
  writeFileSync(
    join(root, "tools/ralph/ralph.config.json"),
    JSON.stringify(config),
  );
  const statePath = join(directory, "state.json");
  writeFileSync(
    statePath,
    JSON.stringify({
      statuses,
      comments: [],
      labels: {},
      closed: [],
      calls: 0,
    }),
  );
  const script = `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const statePath = process.env.RALPH_TEST_STATE;
const s = JSON.parse(fs.readFileSync(statePath, 'utf8'));
const args = process.argv.slice(2);
const command = path.basename(process.argv[1]);
const output = (value) => process.stdout.write(JSON.stringify(value));
let input = '';
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
 if (command === 'go') process.stdout.write('/tmp');
 if (command === 'codex') {
  const i = ++s.calls;
  const reviewing = args.includes('--ephemeral');
  const branch = require('node:child_process').execFileSync('git', ['branch', '--show-current']).toString().trim();
  const number = Number(branch.replace('issue-', ''));
  const status = s.statuses[number - 1] || 'done';
  if (reviewing && process.env.REVIEW_FAIL) process.exitCode = 1;
  fs.writeFileSync('work-' + i, 'change-' + i);
  fs.writeFileSync(args[args.indexOf('-o') + 1], JSON.stringify({ status, summary: 'result-' + i, commit_message: 'Task ' + i }));
  output({ type: 'turn.completed', usage: { input_tokens: 8, cached_input_tokens: 5, output_tokens: 2 } });
 }
 if (command === 'gh') {
  if (process.env.GH_FAIL === args.slice(0, 2).join(' ')) { process.exitCode = 1; return; }
  const number = Number(args[2]);
  if (args[0] === 'label' && args[1] === 'list') output([{ name: 'blocked' }, { name: 'ralph-failed' }]);
  if (args[0] === 'issue' && args[1] === 'list') output(s.statuses.map((_, i) => ({ number: i+1, title: 'Task', body: '', labels: (s.labels[i+1] || []).map(name => ({ name })) })).filter(t => !s.closed.includes(t.number)));
  if (args[0] === 'issue' && args[1] === 'edit') s.labels[number] = [args.at(-1)];
  if (args[0] === 'issue' && args[1] === 'close') s.closed.push(number);
  if (args[1] === 'comment') s.comments.push({ kind: args[0], number, body: input });
  if (args[0] === 'pr' && args[1] === 'list') output(process.env.EXISTING_PR ? [{ number: 99 }] : []);
  if (args[0] === 'pr' && args[1] === 'create') s.prBody = input;
 }
 fs.writeFileSync(statePath, JSON.stringify(s));
});
`;
  for (const name of ["gh", "codex", "go"])
    writeFileSync(join(bin, name), script, { mode: 0o755 });
  const git = (...args: string[]) => {
    const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
    if (result.status) throw new Error(result.stderr);
    return result.stdout.trim();
  };
  git("init", "--initial-branch=main");
  git("config", "user.name", "Ralph Test");
  git("config", "user.email", "ralph@example.test");
  git("config", "commit.gpgsign", "false");
  writeFileSync(join(root, ".gitignore"), ".ralph/\n");
  git("add", ".");
  git("commit", "-m", "Initial");
  git("init", "--bare", join(directory, "remote.git"));
  git("remote", "add", "origin", join(directory, "remote.git"));
  git("push", "-u", "origin", "main");
  return {
    root,
    git,
    launch(env: Record<string, string> = {}, flags: string[] = []) {
      const result = spawnSync(
        process.execPath,
        ["tools/ralph/ralph.ts", "--phase", "2", ...flags],
        {
          cwd: root,
          encoding: "utf8",
          timeout: 20000,
          env: {
            ...process.env,
            PATH: bin + ":" + process.env.PATH,
            RALPH_TEST_STATE: statePath,
            ...env,
          },
        },
      );
      const runDir = join(root, ".ralph/runs");
      const path = join(runDir, readdirSync(runDir)[0], "summary.md");
      return {
        ...result,
        path,
        summary: readFileSync(path, "utf8"),
        state: JSON.parse(readFileSync(statePath, "utf8")),
      };
    },
  };
}
