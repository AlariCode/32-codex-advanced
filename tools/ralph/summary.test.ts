import { test } from "node:test";
import assert from "node:assert/strict";
import { parseUsage, renderSummary } from "./summary.ts";
import type { RunSummary, StopReason } from "./summary.ts";

export function summary(): RunSummary {
  return {
    phase: "2",
    started: 0,
    ended: 60000,
    usage: { input: 12, cached: 5, output: 3 },
    closed: [],
    blocked: [],
    failed: [],
    returns: { check: 2, review: 1 },
    reason: "задачи кончились",
  };
}

test("usage sums completed turns and skips broken lines and invalid values", () => {
  const event = (usage: object) =>
    JSON.stringify({ type: "turn.completed", usage });
  assert.deepEqual(
    parseUsage(
      [
        event({ input_tokens: 10, cached_input_tokens: 4, output_tokens: 2 }),
        "{broken",
        "null",
        "{}",
        event({ input_tokens: 20, cached_input_tokens: 7, output_tokens: 3 }),
        event({
          input_tokens: -1,
          cached_input_tokens: "4",
          output_tokens: 1.5,
        }),
        JSON.stringify({ type: "turn.started", usage: { input_tokens: 100 } }),
      ].join("\n"),
    ),
    { input: 30, cached: 11, output: 5 },
  );
  assert.deepEqual(parseUsage(""), { input: 0, cached: 0, output: 0 });
});

for (const reason of [
  "задачи кончились",
  "лимит итераций",
  "maxMinutes",
  "maxTokens",
  "предохранитель",
  "preflight",
  "ошибка раннера",
] as StopReason[]) {
  test(`summary renders ${reason} and empty lists`, () => {
    const text = renderSummary({ ...summary(), reason });
    assert.match(text, new RegExp(`Причина остановки: ${reason}`));
    assert.equal(text.match(/Нет\./g)?.length, 3);
    assert.match(text, /вход 12, кэш 5, выход 3; сумма 15/);
    assert.match(text, /от проверок 2, от ревью 1/);
  });
}
test("summary lists outcomes with one-line reasons", () => {
  const text = renderSummary({
    ...summary(),
    closed: [1],
    blocked: [{ number: 2, reason: "нужен\nчеловек" }],
    failed: [{ number: 3, reason: "нет\nпрогресса" }],
    detail: "подробности\nошибки",
  });
  assert.match(text, /- #1/);
  assert.match(text, /- #2: нужен человек/);
  assert.match(text, /- #3: нет прогресса/);
  assert.match(text, /подробности ошибки/);
});
