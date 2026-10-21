import { readFile } from "node:fs/promises";
import { summarize } from "./metrics.mjs";

if (process.argv.length !== 3)
  throw new Error("Usage: npm run benchmark:recalculate -- PATH/runs.jsonl");
const rows = (await readFile(process.argv[2], "utf8"))
  .trim()
  .split("\n")
  .filter(Boolean)
  .map((line) => JSON.parse(line));
console.log(JSON.stringify(summarize(rows), null, 2));
