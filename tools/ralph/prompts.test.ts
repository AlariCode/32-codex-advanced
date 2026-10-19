import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderFixPrompt } from "./prompts.ts";

test("fix template substitutes task and diagnostics without interpreting log contents", () => {
  const template = readFileSync(
    new URL("./ralph-fix.md", import.meta.url),
    "utf8",
  );
  const log = "hook failed\n$& {{number}} {{log}} `literal`";
  const prompt = renderFixPrompt(template, 42, log);
  assert.ok(prompt.includes("задачи #42"));
  assert.ok(prompt.includes(log));
  assert.equal(
    prompt,
    template.replace("{{number}}", "42").replace("{{log}}", () => log),
  );
});
