export interface WaveIssue {
  number: number;
  dependencies: number[];
}

export function dependencies(body: string | null): number[] {
  const lines = [
    ...(body ?? "").matchAll(/^[\t ]*Зависит от[\t ]*:?[\t ]+(.*)$/gim),
  ];
  return [
    ...new Set(
      lines.flatMap((line) =>
        [...line[1].matchAll(/#(\d+)/g)].map((match) => Number(match[1])),
      ),
    ),
  ];
}

// Pure planning: GitHub state and the merge journal are supplied by the caller.
export function buildWaves(
  issues: WaveIssue[],
  completed: ReadonlySet<number> = new Set(),
) {
  const byNumber = new Map(issues.map((issue) => [issue.number, issue]));
  if (byNumber.size !== issues.length)
    throw new Error("Повторные номера задач");
  const visited = new Set<number>();
  const path: number[] = [];
  function visit(number: number) {
    const cycle = path.indexOf(number);
    if (cycle !== -1)
      throw new Error(
        `Цикл зависимостей: ${[...path.slice(cycle), number].map((n) => `#${n}`).join(" → ")}`,
      );
    if (visited.has(number)) return;
    path.push(number);
    for (const dep of byNumber.get(number)!.dependencies)
      if (byNumber.has(dep)) visit(dep);
    path.pop();
    visited.add(number);
  }
  issues.forEach((issue) => visit(issue.number));
  const done = new Set(completed);
  const pending = issues.filter((issue) => !done.has(issue.number));
  const waves: number[][] = [];
  while (pending.length) {
    const wave = pending.filter((issue) =>
      issue.dependencies.every((dep) => done.has(dep)),
    );
    if (!wave.length) break;
    waves.push(wave.map((issue) => issue.number));
    for (const issue of wave) {
      done.add(issue.number);
      pending.splice(pending.indexOf(issue), 1);
    }
  }
  const blocked = new Map(
    pending.map((issue) => [
      issue.number,
      `Не выполнены зависимости: ${issue.dependencies
        .filter((dep) => !done.has(dep))
        .map((dep) => `#${dep}`)
        .join(", ")}`,
    ]),
  );
  return { waves, blocked };
}
