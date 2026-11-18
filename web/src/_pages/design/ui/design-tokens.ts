export const colorGroups = [
  [
    "Поверхности",
    [
      ["Внешний фон", "bg-canvas"],
      ["Фон страницы", "bg-page"],
      ["Поверхность", "bg-surface"],
      ["Мягкая подложка", "bg-subtle"],
      ["Выделение текста", "selection-bg"],
    ],
  ],
  [
    "Текст и границы",
    [
      ["Основной текст", "text-primary"],
      ["Вторичный текст", "text-secondary"],
      ["Подсказки", "text-muted"],
      ["Ссылка", "text-link"],
      ["Текст на кнопке", "text-on-action"],
      ["Текст выделения", "selection-text"],
      ["Разделитель", "border-subtle"],
      ["Граница поля", "border-control"],
      ["Фокус", "focus-ring"],
    ],
  ],
  [
    "Действия",
    [
      ["Основное", "action-primary"],
      ["Основное · наведение", "action-primary-hover"],
      ["Основное · нажатие", "action-primary-active"],
      ["Вторичное", "action-secondary"],
      ["Вторичное · наведение", "action-secondary-hover"],
      ["Вторичное · нажатие", "action-secondary-active"],
      ["Деструктивное", "action-danger"],
      ["Деструктивное · наведение", "action-danger-hover"],
      ["Деструктивное · нажатие", "action-danger-active"],
      ["Недоступный фон", "action-disabled"],
      ["Недоступный текст", "text-disabled"],
    ],
  ],
  [
    "Статусы",
    [
      ["Успех", "status-success"],
      ["Фон успеха", "status-success-bg"],
      ["Предупреждение", "status-warning"],
      ["Фон предупреждения", "status-warning-bg"],
      ["Ошибка", "status-danger"],
      ["Фон ошибки", "status-danger-bg"],
    ],
  ],
  [
    "Подсветка кода",
    [
      ["Ключевые слова", "code-keyword"],
      ["Строки и литералы", "code-literal"],
      ["Числа и атрибуты", "code-value"],
      ["Комментарии", "code-comment"],
      ["Имена и теги", "code-name"],
    ],
  ],
] as const;

export const typeScale = [
  { name: "Заголовок статьи", token: "--text-title-feature", style: "title" },
  { name: "Заголовок страницы", token: "--text-title-page", style: "title" },
  { name: "Заголовок раздела", token: "--text-title-section", style: "label" },
  { name: "Заголовок карточки", token: "--text-title-card", style: "label" },
  { name: "Текст статьи", token: "--text-reading", style: "reading" },
  { name: "Основной текст", token: "--text-body", style: "body" },
  { name: "Метка поля", token: "--text-label", style: "label" },
  { name: "Короткая подпись", token: "--text-caption", style: "caption" },
] as const;
