import { CORPUS, REPETITIONS, TARGET_MS } from "./corpus.mjs";

export function elapsedMS(confirmedAt, displayedAt) {
  const start = Date.parse(confirmedAt);
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(displayedAt) ||
    displayedAt < start
  )
    return null;
  return displayedAt - start;
}

export function successful(row) {
  return (
    row.httpStatus === 201 &&
    row.created === true &&
    row.generation === 1 &&
    row.state === "ready" &&
    row.documentUsable === true &&
    row.mediaComplete === true &&
    Number.isFinite(row.elapsedMS) &&
    row.elapsedMS >= 0
  );
}

export function summarize(rows) {
  const seen = new Set(),
    owners = new Set();
  for (const row of rows) {
    const source = CORPUS.find((item) => item.id === row.article);
    if (
      !source ||
      source.url !== row.url ||
      !Number.isInteger(row.repetition) ||
      row.repetition < 1 ||
      row.repetition > REPETITIONS
    )
      throw new Error("Unexpected corpus or repetition");
    const key = `${row.article}/${row.repetition}`;
    if (seen.has(key)) throw new Error("Duplicate measurement");
    seen.add(key);
    if (row.userId) {
      if (owners.has(row.userId))
        throw new Error("Accounts must be independent");
      owners.add(row.userId);
    }
    const calculated = elapsedMS(row.confirmedAt, row.displayedAt);
    if (row.elapsedMS !== calculated)
      throw new Error("Elapsed time does not match raw timestamps");
  }
  const ready = rows.filter(successful);
  const timings = ready.map((row) => row.elapsedMS).sort((a, b) => a - b);
  const percentile = (p) =>
    timings.length ? timings[Math.ceil(timings.length * p) - 1] : null;
  const fast = ready.filter((row) => row.elapsedMS <= TARGET_MS).length;
  const confirmedNewSaves = rows.filter(
    (row) =>
      row.httpStatus === 201 && row.created === true && row.generation === 1,
  ).length;
  return {
    expected: CORPUS.length * REPETITIONS,
    recorded: rows.length,
    confirmedNewSaves,
    missing: CORPUS.length * REPETITIONS - rows.length,
    ready: ready.length,
    readyWithin15s: fast,
    required: 54,
    targetMet:
      rows.length === 60 &&
      confirmedNewSaves === 60 &&
      owners.size === 60 &&
      fast >= 54,
    // Percentiles are conditional on valid ready results, never on all attempts.
    readyP50MS: percentile(0.5),
    readyP90MS: percentile(0.9),
    articles: CORPUS.map(({ id }) => {
      const group = rows.filter((row) => row.article === id);
      return {
        article: id,
        recorded: group.length,
        ready: group.filter(successful).length,
        readyWithin15s: group.filter(
          (row) => successful(row) && row.elapsedMS <= TARGET_MS,
        ).length,
      };
    }),
  };
}

export function markdown(report) {
  const { summary: s, rows } = report;
  return (
    `# Live archive benchmark\n\nDate: ${report.startedAt}. Sequential saves; fixed six-article corpus; ten independent accounts per article.\n\n` +
    `Ready within 15 seconds: **${s.readyWithin15s}/60**, required **54/60**. Target **${s.targetMet ? "MET" : "NOT MET"}**. Confirmed new saves: ${s.confirmedNewSaves}/60; valid ready: ${s.ready}/60; recorded: ${s.recorded}/60.\n\n` +
    `Timing: server requested_at (transaction timestamp immediately before commit), confirmed by HTTP 201/created=true, to first browser DOM ready observation. API and browser share the launcher host; the PostgreSQL VM clock is assumed synchronized. Queue, network/media, processing, commit and normal UI polling are included. Document/asset validation follows observation and determines eligibility, without adding validation time to the measurement. Quality review is separate and is never inferred from counts.\n\n` +
    `Conditional valid-ready p50/p90: ${s.readyP50MS ?? "n/a"}/${s.readyP90MS ?? "n/a"} ms. Failures and missing samples remain in the denominator 60. Partial media must have explicit omission reasons/warnings.\n\n` +
    `Environment and raw evidence: report.json, runs.jsonl, environment.json. Account credentials/cookies are not recorded. Source HTML and archived documents for manual review are local artifacts, not part of the committed report.\n\n` +
    `| Article | Recorded | Ready | ≤15s |\n| --- | ---: | ---: | ---: |\n` +
    s.articles
      .map(
        (r) =>
          `| ${r.article} | ${r.recorded} | ${r.ready} | ${r.readyWithin15s} |`,
      )
      .join("\n") +
    `\n\n## Every measurement\n\n| Article | Run | HTTP | State | Elapsed ms | Usable | Media resolved | Error |\n| --- | ---: | ---: | --- | ---: | --- | --- | --- |\n` +
    rows
      .map(
        (r) =>
          `| ${r.article} | ${r.repetition} | ${r.httpStatus ?? "—"} | ${r.state} | ${r.elapsedMS ?? "—"} | ${r.documentUsable} | ${r.mediaComplete} | ${(r.error ?? "").replaceAll("|", "/").replaceAll("\n", " ")} |`,
      )
      .join("\n") +
    "\n"
  );
}
