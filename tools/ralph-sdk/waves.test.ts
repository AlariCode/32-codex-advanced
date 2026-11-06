import assert from "node:assert/strict";
import test from "node:test";
import { buildWaves, dependencies } from "./lib/waves.ts";
const issue = (number: number, deps: number[] = []) => ({
  number,
  dependencies: deps,
});

test("без зависимостей", () => {
  assert.deepEqual(buildWaves([issue(21), issue(22)]).waves, [[21, 22]]);
});
test("цепочка", () => {
  assert.deepEqual(
    buildWaves([issue(23, [22]), issue(22, [21]), issue(21)]).waves,
    [[21], [22], [23]],
  );
});
test("две задачи и одна зависимая", () => {
  assert.deepEqual(
    buildWaves([issue(21), issue(22), issue(23, [21, 22])]).waves,
    [[21, 22], [23]],
  );
});
test("цикл перечисляет участников, но не зависимые задачи", () => {
  assert.throws(
    () => buildWaves([issue(1, [2]), issue(2, [3]), issue(3, [2])]),
    /#2 → #3 → #2/,
  );
  assert.throws(() => buildWaves([issue(1, [1])]), /#1 → #1/);
});
test("внешняя зависимость блокирует также потомков; закрытая разрешает запуск", () => {
  const issues = [issue(21, [10]), issue(22, [21]), issue(23)];
  const plan = buildWaves(issues);
  assert.deepEqual(plan.waves, [[23]]);
  assert.deepEqual([...plan.blocked.keys()], [21, 22]);
  assert.deepEqual(buildWaves(issues, new Set([10])).waves, [[21, 23], [22]]);
});
test("парсинг только строки зависимостей", () => {
  assert.deepEqual(
    dependencies("Текст #9\nЗависит от: #21, #22, #21\nПример #5"),
    [21, 22],
  );
  assert.deepEqual(dependencies(null), []);
});

test("зависимости из нескольких строк без двоеточия, как в GitHub #23", () => {
  assert.deepEqual(
    dependencies(
      "## Зависимости\n\nЗависит от #19 — Удаление\n\nЗависит от #21 — Backup\n\nЗависит от #22 — Скорость",
    ),
    [19, 21, 22],
  );
  assert.deepEqual(
    dependencies("Зависит от: #21, #22\nЗависит от #21 — повтор"),
    [21, 22],
  );
});
