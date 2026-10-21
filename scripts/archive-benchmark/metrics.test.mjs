import assert from "node:assert/strict";
import test from "node:test";
import { CORPUS } from "./corpus.mjs";
import { elapsedMS, markdown, summarize } from "./metrics.mjs";

const start = "2026-10-21T10:00:00.000Z";
const sample = (index, duration = 15_000) => ({
  article: CORPUS[Math.floor(index / 10)].id,
  url: CORPUS[Math.floor(index / 10)].url,
  repetition: (index % 10) + 1,
  userId: `owner-${index}`,
  httpStatus: 201,
  created: true,
  generation: 1,
  state: "ready",
  documentUsable: true,
  mediaComplete: true,
  confirmedAt: start,
  displayedAt: Date.parse(start) + duration,
  elapsedMS: duration,
});

test("server-to-DOM timing includes queue, work and polling; exact 15s boundary", () => {
  assert.equal(elapsedMS(start, Date.parse(start) + 15_000), 15_000);
  assert.equal(elapsedMS("bad", Date.now()), null);
  assert.equal(elapsedMS(start, Date.parse(start) - 1), null);
  const rows = Array.from({ length: 60 }, (_, i) =>
    sample(i, i < 54 ? 15_000 : 15_001),
  );
  assert.equal(summarize(rows).readyWithin15s, 54);
  assert.equal(summarize(rows).targetMet, true);
  rows[53] = sample(53, 15_001);
  assert.equal(summarize(rows).targetMet, false);
});

test("duplicates, failed, unavailable, invalid documents and pending media are not success", () => {
  const overrides = [
    { httpStatus: 200, created: false },
    { state: "failed" },
    { state: "unavailable" },
    { documentUsable: false },
    { mediaComplete: false },
    { generation: 2 },
  ];
  const rows = overrides.map((patch, i) => ({ ...sample(i), ...patch }));
  const s = summarize(rows);
  assert.equal(s.ready, 0);
  assert.equal(s.expected, 60);
  assert.equal(s.missing, 54);
  assert.equal(s.targetMet, false);
});

test("54 fast results need a complete cohort of 60 new saves and independent accounts", () => {
  const rows = Array.from({ length: 60 }, (_, i) => sample(i, 1000));
  for (let i = 54; i < 60; i++) {
    Object.assign(rows[i], {
      httpStatus: null,
      created: false,
      generation: null,
      state: "not_saved",
      confirmedAt: null,
      displayedAt: null,
      elapsedMS: null,
    });
  }
  assert.equal(summarize(rows).readyWithin15s, 54);
  assert.equal(summarize(rows).targetMet, false);
  // An acknowledged ordinary-article failure is a real measurement.
  for (let i = 54; i < 60; i++)
    rows[i] = { ...sample(i, 1000), state: "failed" };
  assert.equal(summarize(rows).targetMet, true);
  delete rows[59].userId;
  assert.equal(summarize(rows).targetMet, false);
});

test("aggregation is independently reproducible and rejects modified corpus/accounts/times", () => {
  const rows = Array.from({ length: 60 }, (_, i) => sample(i, (i + 1) * 1000));
  const s = summarize(rows);
  assert.equal(s.readyWithin15s, 15);
  assert.equal(s.readyP50MS, 30_000);
  assert.equal(s.readyP90MS, 54_000);
  assert.throws(() => summarize([sample(0), sample(0)]), /Duplicate/);
  assert.throws(
    () => summarize([sample(0), { ...sample(1), userId: "owner-0" }]),
    /independent/,
  );
  assert.throws(
    () => summarize([{ ...sample(0), url: CORPUS[0].url + "?fresh=1" }]),
    /corpus/,
  );
  assert.throws(
    () => summarize([{ ...sample(0), elapsedMS: 1 }]),
    /timestamps/,
  );
  const report = markdown({ startedAt: start, summary: s, rows });
  assert.equal(
    report.split("\n").filter((line) => line.startsWith("| go-")).length,
    22,
  );
  assert.match(report, /NOT MET/);
});
