import type { CommandRunner } from "./exec.ts";
import { phaseHasCommits } from "./git.ts";

export type Task = {
  number: number;
  title: string;
  body: string;
  labels: { name: string }[];
};

export function parseDependencies(body: string): number[] {
  const lines = body.split(/\r?\n/);
  const start = lines.findIndex((line) =>
    /^##\s+Зависимости\s*#*\s*$/i.test(line),
  );
  if (start < 0) return [];
  const section: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^#{1,2}\s/.test(line)) break;
    section.push(line);
  }
  const text = section.join("\n");
  if (/^\s*(?:[-*]\s*)?нет[.!]?\s*$/i.test(text)) return [];
  return [
    ...new Set(
      [...text.matchAll(/#(\d+)\b/g)].map((match) => Number(match[1])),
    ),
  ];
}

export async function listTasks(
  run: CommandRunner,
  label: string,
): Promise<Task[]> {
  // prettier-ignore
  const result = await run(['gh', 'issue', 'list', '--label', label, '--state', 'open',
    '--limit', '10000', '--json', 'number,title,body,labels']);
  const tasks: Task[] = JSON.parse(result.stdout);
  if (tasks.length === 10000)
    throw new Error("Issue limit reached; refusing incomplete selection");
  return tasks;
}

export async function selectNextTask(
  tasks: Task[],
  stateOf: (number: number) => Promise<string>,
): Promise<Task | undefined> {
  const states = new Map<number, string>();
  for (const task of [...tasks].sort((a, b) => a.number - b.number)) {
    if (task.labels.some((label) => label.name === "blocked")) continue;
    let ready = true;
    for (const number of parseDependencies(task.body)) {
      if (!states.has(number)) states.set(number, await stateOf(number));
      if (states.get(number) !== "CLOSED") ready = false;
    }
    if (ready) return task;
  }
}

export async function dependencyState(
  run: CommandRunner,
  number: number,
): Promise<string> {
  const result = await run([
    "gh",
    "issue",
    "view",
    String(number),
    "--json",
    "state",
  ]);
  const { state } = JSON.parse(result.stdout);
  if (state !== "OPEN" && state !== "CLOSED")
    throw new Error(`Unknown state for #${number}`);
  return state;
}

export async function commentTask(
  run: CommandRunner,
  number: number,
  body: string,
) {
  await run(["gh", "issue", "comment", String(number), "--body-file", "-"], {
    input: body,
  });
}

export async function markBlocked(
  run: CommandRunner,
  number: number,
  summary: string,
) {
  const result = await run([
    "gh",
    "label",
    "list",
    "--search",
    "blocked",
    "--limit",
    "10000",
    "--json",
    "name",
  ]);
  // gh label list can exit successfully with no output when no labels match.
  const labels: { name: string }[] = JSON.parse(result.stdout.trim() || "[]");
  if (!labels.some((label) => label.name.toLowerCase() === "blocked")) {
    await run([
      "gh",
      "label",
      "create",
      "blocked",
      "--color",
      "D93F0B",
      "--description",
      "Task cannot proceed until a blocker is resolved",
    ]);
  }
  await run(["gh", "issue", "edit", String(number), "--add-label", "blocked"]);
  await commentTask(run, number, summary);
}

export async function closeTask(
  run: CommandRunner,
  number: number,
  summary: string,
) {
  await commentTask(run, number, summary);
  await run(["gh", "issue", "close", String(number)]);
}

export async function ensurePhasePR(
  run: CommandRunner,
  branch: string,
  closed: number[],
) {
  const result = await run([
    "gh",
    "pr",
    "list",
    "--head",
    branch,
    "--base",
    "main",
    "--state",
    "open",
    "--json",
    "number",
  ]);
  if (JSON.parse(result.stdout).length) return;
  if (!(await phaseHasCommits(run, branch))) return;
  const body = `Closed tasks in this run:\n\n${closed.map((number) => `- #${number}`).join("\n") || "None."}`;
  await run(
    [
      "gh",
      "pr",
      "create",
      "--head",
      branch,
      "--base",
      "main",
      "--title",
      `Ralph: ${branch}`,
      "--body-file",
      "-",
    ],
    { input: body },
  );
}
