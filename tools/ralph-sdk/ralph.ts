import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ralph } from "./lib/ralph.ts";
import { parseIssueNumber, readCommand } from "./lib/io.ts";
export { blockers, reviewSchema, positiveEnv } from "./lib/ralph.ts";

async function main() {
  if (process.argv.includes("--help")) {
    console.log("Использование: npm run ralph -- <номер задачи> [<номер> ...]");
    return;
  }
  const numbers = process.argv.slice(2).map((arg) => parseIssueNumber([arg]));
  if (!numbers.length)
    throw new Error(
      "Использование: npm run ralph -- <номер задачи> [<номер> ...]",
    );
  const root = await readCommand(
    "git",
    ["rev-parse", "--show-toplevel"],
    process.cwd(),
  );
  for (const number of numbers) {
    try {
      const state = await ralph(number, { workingDirectory: root });
      console.log(
        `#${number} · ${state.commit ? "commit" : "stopped"} · раунды ${state.rounds} · токены ${state.tokens} · ${state.commit ?? "—"}`,
      );
      if (state.reason) console.error(`Причина остановки: ${state.reason}`);
      if (state.status !== "committed") process.exitCode = 1;
    } catch (error) {
      console.error(
        `#${number} · stopped · раунды ? · токены ? · — · ${error instanceof Error ? error.message : error}`,
      );
      process.exitCode = 1;
    }
  }
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
