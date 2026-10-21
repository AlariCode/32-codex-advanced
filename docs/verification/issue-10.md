# #10 — relative/lazy/srcset и частичная статья

## Карта критериев

| Критерий                                      | Проверка и ожидаемый результат                                                                                                                                                                                                                                                                                                      |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Одна версия на позицию, порядок, alt, подписи | TestRelativeLazySrcsetFixture, TestCandidateBaseAndFinalURL, TestSrcsetCommasBelongToURLsAndDataNeverBecomesRelativeCandidate, TestArticleMixedImageParagraphPreservesEveryPosition: четыре исходные позиции дают четыре image, ожидаемые URL и подписи; URL кандидатов отсутствуют в JSON                                          |
| Безопасность final/base/redirect              | TestCandidatesAndBaseNeverBypassPinnedPolicy, TestUnsafeBaseAndRedirectFallbackUseSameNetworkPolicy: private/metadata/mapped IP не получают соединений; blocked redirect не мешает следующему доступному варианту                                                                                                                   |
| Ограниченный поиск                            | TestCandidateFallbackBudgetsAndDeadline, TestImageRemainingDownloadBudget, существующие B-тесты: максимум 8 кандидатов на позицию, 100 попыток на статью, не более 50 позиций; 5/20 MiB; ошибки и невалидные bytes тоже расходуют бюджет; после отмены запросов нет                                                                 |
| HTML после gzip до 3 MiB                      | TestDecompressedBodyHeadersRedirectAndBudgetLimits: максимум 3 MiB префикса + один контрольный byte чтения, флаг Truncated; TestPartialHTMLClassification: пригодная статья с html_truncated; пустая — article_unavailable; технический сбой — network_error                                                                        |
| Потери текста и реальные предупреждения       | TestWarningsOnlyDescribeSelectedMainContent, TestDroppedMainTextWarnsWithoutRestoringExcludedContent, TestDroppedMainTableWarnsWithoutUnrelatedImageWarning, TestParserResourceFailureStaysFailed: удаление aside не предупреждает; выявленная потеря внутри article предупреждает; ресурсный сбой parser остаётся processing_error |
| Публикация unavailable                        | SQL TestPartialPublicationClassifications: unavailable/completed без snapshot; существующие fences/атомарность B сохраняются                                                                                                                                                                                                        |
| Автономный архив                              | TestRealCandidateArchiveSurvivesSourceShutdown: настоящий HTTP, redirect, сохранённые PNG/JPEG/GIF, четыре позиции, три уникальных asset; после shutdown bytes валидны, URL источника в JSON нет                                                                                                                                    |
| Читалка и сквозной архив                      | Новые случаи в web/tests/e2e/integration/images.spec.ts: candidates/unsafe-base после shutdown/reload, bytes совпадают с корпусом, подписи и позиции сохранены, внешних запросов/forbiddenHits нет; partial-html/text-loss показывают конкретную причину; oversized empty — unavailable                                             |

Сценарии UI: предупреждения html_truncated, text_incomplete,
text_only_archive показываются отдельными текстовыми note; images_omitted
сохраняет прежнее сообщение и локальные placeholders с причиной. Никаких
внешних fallback и автоматических запросов оригинала. Сценарии используют
существующие проекты 375/768/1440 и video:on, но здесь НЕ запускались.

## Выбор и границы

- Используется адрес конечного HTTP-ответа. Первый base[href] разрешается
  относительно него; принимается только HTTP(S) без credentials.
  Синтаксически непригодный первый base игнорируется, следующий не подменяет
  первый. Base не даёт сетевого доверия: каждый итоговый URL и redirect
  независимо проходит прежнюю DNS/SSRF/pinned-dial политику, включая
  cross-origin base. Небезопасный host base не получает запроса.
- Приоритет img: data-srcset → data-src → data-original → data-lazy-src →
  srcset → src. В srcset варианты идут по убыванию w/x; одинаковый URL
  пробуется один раз на позиции. Разбираются первые 64 записи на атрибут;
  итоговых кандидатов не больше 8. Это детерминированный выбор архива,
  без имитации viewport/media queries браузера.
- Альтернативы не увеличивают число отображаемых изображений. Загрузка
  последовательная, без ретраев каждого media-кандидата, с общим durable
  deadline и прежним timeout 25 секунд на запрос. Предел 100 попыток
  ограничивает также быстрые отказы. Причина исчерпания поиска/доступности
  использует существующий image_fetch_failed placeholder.
- Бюджет 20 MiB консервативно учитывает распакованные bytes всех кандидатов,
  включая неуспешные/битые и повторы. Production fetch ограничен остатком
  бюджета; для обнаружения превышения читает максимум limit+1. Этот
  контрольный byte не архивируется. Ответ, оборвавшийся с ошибкой, не
  превращается в успешный частичный HTML.
- HTML сверх лимита больше не означает автоматический failed: только
  пригодный префикс становится ready с предупреждением. Пустой извлечённый
  текст становится unavailable. Полная классификация login/paywall/главной,
  retry и обход ограничений остаются за пределами #10.
- Неполнота определяется по оставшимся неподдерживаемым элементам выбранной
  статьи и потере значимых абзацев (от 80 bytes) и защищённых фрагментов внутри явного article/main.
  Потерянные изображения явного article/main также вызывают предупреждение;
  удаление навигации/aside/footer не считается потерей статьи. Это наблюдаемые
  признаки, а не обещание универсального обнаружения неполноты.
- Публичная JSON-схема не менялась: Candidates, Source и Truncated служат
  только worker. Новых миграций и генерируемых контрактов не требуется.

## Выполненные проверки

Первый make check подтвердил RED из-за отсутствующих Candidates, Truncated и
pageResult. Основные серверные assertions зафиксированы до реализации.
Единственное исправление ошибки нового теста: поиск утечки поля candidates
уточнён до JSON-ключа "candidates":, поскольку исходный поиск слова
ошибочно совпадал с заголовком самой fixture. Критерий отсутствия URL не менялся.
Дополнительные регрессии добавлены по обнаруженным рискам. RED отдельно подтвердил потерю основной таблицы и ошибку разделения srcset по запятым внутри URL/data URL; обе исправлены без изменения assertions.

make check прошёл: Go unit tests/vet, frontend ESLint и TypeScript. Для
httptest потребовался повтор с разрешением локальных портов после sandbox
bind error. Итоговый запуск зафиксирован также в docs/ralph/progress.md.

По указанию пользователя предыдущие визуальные проверки приняты. Новые
браузерные проверки, UX-проход, Playwright и видео в этой итерации не запускались.
make test, make build и make openapi не запускались по ограничениям запуска;
SQL/e2e и остальные внешние проверки выполняет скрипт. Написанные SQL/e2e
сценарии не считаются выполненными. Ralph/.ralph не изменялись.

### Регрессия после ревью: inline-код

TestInlineCodeTextComparisonWarnsOnlyForActualLoss проверяет вложенные
span/strong-подобные теги и HTML entities внутри code, а также пробелы и br.
Полностью сохранённый абзац не получает text_incomplete; тот же абзац при
реальной потере соседнего основного абзаца сохраняет предупреждение.
Во всех случаях архивный inline-код сравнивается с ожидаемой строкой точно,
включая пробелы и переводы строк. Сбор исходного текста для сравнения
использует codeText как structured, не вставляя пробелы между внутренними
тегами code. Нормализация применяется только к доказательствам неполноты.
