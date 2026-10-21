import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderReviewPrompt, renderFixPrompt } from "./prompts.ts";

const template = (file: string) =>
  readFileSync(new URL(file, import.meta.url), "utf8");

test("review prompt includes the full task, diff path and previous findings", () => {
  const task = {
    number: 42,
    title: "Title {{diff}}",
    body: "Full criteria\n$& {{previous}}",
    labels: [],
  };
  const previous = {
    summary: "Prior review",
    criteria: [],
    findings: [
      {
        priority: 1 as const,
        title: "Fix",
        body: "Problem",
        file: "file.ts",
        line: 8,
      },
    ],
  };
  const prompt = renderReviewPrompt(
    template("./ralph-review.md"),
    task,
    "/tmp/review-2.diff",
    previous,
  );
  assert.ok(prompt.includes("#42: " + task.title));
  assert.ok(prompt.includes(task.body));
  assert.ok(prompt.includes("/tmp/review-2.diff"));
  assert.ok(prompt.includes(JSON.stringify(previous, null, 2)));
  assert.match(
    renderReviewPrompt(template("./ralph-review.md"), task, "diff"),
    /прошлого раунда ревью:\n\nНет/,
  );
});

test("review fix section replaces check instructions without altering feedback", () => {
  const feedback = "Missing behavior\nP1 Source (file.ts:8): {{number}} $&";
  const prompt = renderFixPrompt(template("./ralph-fix.md"), 42, "", feedback);
  assert.match(prompt, /Код-ревью задачи #42/);
  assert.ok(prompt.includes(feedback));
  assert.doesNotMatch(prompt, /Последние 80 строк|{{#|{{\//);
  assert.match(prompt, /Не ослабляй тесты/);
  assert.match(prompt, /docs\/ralph\/progress.md/);
});
