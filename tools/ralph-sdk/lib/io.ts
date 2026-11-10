import { spawn } from "node:child_process";
import { z } from "zod";

export const issueSchema = z.object({
  number: z.number().int().positive(),
  title: z.string().min(1),
  body: z.string().nullable(),
  url: z.url(),
});

export function parseIssueNumber(args: string[]): number {
  return z
    .tuple([z.string().regex(/^[1-9]\d*$/)])
    .transform(([value]) =>
      z
        .number()
        .int()
        .positive()
        .max(Number.MAX_SAFE_INTEGER)
        .parse(Number(value)),
    )
    .parse(args);
}

export function parseRunArgs(args: string[], phase = false) {
  const numbers: number[] = [];
  let resume: number | undefined;
  let extraReviewRounds: number | undefined;
  let dryRun = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--resume" || arg === "--extra-review-rounds") {
      const value = parseIssueNumber([args[++i]]);
      if (arg === "--resume" && resume === undefined) resume = value;
      else if (
        arg === "--extra-review-rounds" &&
        extraReviewRounds === undefined
      )
        extraReviewRounds = value;
      else throw new Error(`Повторный параметр ${arg}`);
    } else if (arg === "--dry-run" && phase) dryRun = true;
    else numbers.push(parseIssueNumber([arg]));
  }
  if ((resume === undefined) !== (extraReviewRounds === undefined))
    throw new Error(
      "Укажите вместе --resume <номер> и --extra-review-rounds <число>",
    );
  if (!numbers.length && resume !== undefined && !phase) numbers.push(resume);
  if (!numbers.length || new Set(numbers).size !== numbers.length)
    throw new Error("Нужны уникальные номера задач");
  if (resume !== undefined && !numbers.includes(resume))
    throw new Error("Возобновляемая задача должна входить в список задач");
  return { numbers, resume, extraReviewRounds, dryRun };
}

export function command(program: string, args: string[], cwd: string) {
  return new Promise<{ code: number; output: string }>((accept, reject) => {
    const child = spawn(program, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      output += chunk;
    });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      output += chunk;
    });
    child.once("error", reject);
    child.once("close", (code, signal) => {
      if (signal)
        reject(new Error(`${program}: остановлен сигналом ${signal}`));
      else accept({ code: code ?? 1, output });
    });
  });
}

export async function readCommand(
  program: string,
  args: string[],
  cwd: string,
) {
  const result = await command(program, args, cwd);
  if (result.code !== 0) throw new Error(`${program}: ${result.output.trim()}`);
  return result.output.trim();
}

export type Issue = z.infer<typeof issueSchema>;

export async function loadIssue(number: number, root: string) {
  const issue = issueSchema.parse(
    JSON.parse(
      await readCommand(
        "gh",
        ["issue", "view", String(number), "--json", "number,title,body,url"],
        root,
      ),
    ),
  );
  if (issue.number !== number) throw new Error("GitHub вернул другую задачу");
  return issue;
}
