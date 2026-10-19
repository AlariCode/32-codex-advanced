import type { Task } from "./tasks.ts";

export function renderPrompt(
  template: string,
  task: Task,
  diagnostics = "",
): string {
  const values: Record<string, string> = {
    number: String(task.number),
    title: task.title,
    body: task.body,
  };
  const prompt = template.replace(
    /{{(number|title|body)}}/g,
    (_, key) => values[key],
  );
  return diagnostics
    ? `${prompt}\n\nПоследняя внешняя проверка (80 строк):\n${diagnostics}\n`
    : prompt;
}

export function renderMergePrompt(
  number: number,
  phase: string,
  files: string[],
): string {
  return `Разреши конфликты начатого слияния issue-${number} в ${phase}.
Рабочая копия уже находится на ветке ${phase}, MERGE_HEAD указывает на ветку задачи.
Конфликтные пути (JSON): ${JSON.stringify(files)}.

Изучи git status, git diff и версии base/ours/theirs. Сохрани смысл изменений
обеих веток; записи журналов объединяй без удаления прежних записей.
Исправь конфликтные файлы, включая конфликты удаления/переименования и бинарных
файлов, если они есть. Не выбирай целиком ours/theirs без анализа.
Меняй только необходимые для разрешения конфликта файлы. Не ослабляй тесты.
Не делай commit, push, reset, checkout/switch веток, merge --abort или новый merge.
Раннер сам добавит конфликтные пути в индекс, выполнит внешние проверки,
завершит merge-коммит и push. Не запускай Ralph рекурсивно и не пиши в GitHub.
Повторные визуальные проверки, Playwright и видео не требуются.
При невозможности корректно объединить изменения верни blocked/failed и объясни причину.
Верни JSON по заданной схеме: status=done только после разрешения всех конфликтов,
summary с описанием решения, commit_message="" (сообщение merge уже подготовлено).
`;
}

export function renderFixPrompt(
  template: string,
  number: number,
  log: string,
): string {
  return template.replace(/{{(number|log)}}/g, (_, key) =>
    key === "number" ? String(number) : log,
  );
}
