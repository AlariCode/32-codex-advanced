# #23 — Итоговая приёмка сохранения, чтения и удаления ссылок

Дата: 2026-11-10. Проверяемая версия: `ba334002c2b84577b1c9e930939c4bd6a7bc2a4a`.
На старте рабочее дерево чистое. Продуктовый код, корпус, лимиты и критерии не менялись.
Исправлен только транспорт приватных запросов restore-теста: браузерный same-origin
fetch вместо APIRequestContext, который не отправляет Secure-cookie на HTTP loopback.
Это тот же подход, что уже используется остальными live-тестами. Проверки статусов,
владельца, полного документа и исходных байтов сохранены; cookie не ослаблена.
Актуализирована [процедура D](../operations/archive-backup-restore.md).
Основания: [таблица и сценарии фаз 1–4](../plans/link-processing.md),
[PRD](../prd/link-processing.md), [принятые Q01–Q07](../research/link-processing/product-decisions.md).
Decisions имеют приоритет над историческими открытыми вопросами PRD.

## Итог

**Фича не принята полностью.** Скорость достигнута в актуальной полной серии: **59/60 ≤15 секунд**,
независимый пересчёт совпадает. Отдельная проверка качества выявила остатки навигации
и служебного содержимого в очищенных документах (K01). Потери MDN/Cloudflare остаются
открытыми замечаниями качества (K03). **Backup/restore: 0/1**, восстановленный документ
содержит код, но renderer показывает пустой блок (K02). Настоящий E2E: **104/104**,
mock: **318/318**. Сборка, OpenAPI и статические проверки прошли.
`make check` намеренно не запускался по прямому указанию пользователя: результат внешнего
раннера остаётся отдельным обязательным условием завершения. Ralph, commit, push, PR
и изменения GitHub не выполнялись.

## Доказательства и границы

Все проверки с БД используют отдельную `linkbook_test` из `compose.test.yaml`,
benchmark и E2E дополнительно создают уникальные схемы. Backup восстанавливает копию
в одноразовую БД `archive_restore_*` того же тестового контейнера согласно процедуре D.
Рабочая БД не используется.

- [Проверки и журналы](issue-23/checks.json): точные команды, время, exit, SHA-256 журнала.
- [Provenance](issue-23/provenance.json): SHA-256 текущего backend, frontend и benchmark.
- Полные журналы, документы, исходные HTML, screenshots, dump и видео остаются в `tmp/`.
  Их отсутствие в Git намеренно; метаданные и результаты сохранены рядом с отчётом.
- Наличие теста в репозитории само по себе не считается прохождением. В таблице ниже
  Go означает актуальный полный `make test` без кеша; mock и live — актуальные полные
  Playwright-прогоны, а не исторические отчёты #19/#21/#22.

## Матрица требований

Каждая строка таблицы критериев плана отражена ниже; дополнительные требования PRD,
Decisions и сценарии фазы 4 приведены в тех же строках или в расширенной матрице.
Номера PRD ниже означают порядок его 16 пунктов списка критериев готовности.

| ID  | Обязательный критерий / источник                                                          | Актуальная проверка и проверяемое утверждение                                                                                                                                                                              | Результат                                                                           |
| --- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| P01 | Личная библиотека, новые сверху, первая ссылка; PRD 1                                     | Go `TestLibraryIntegrationSaveReloadAndDeduplicate`, `Pagination`, `AccessAndValidation`; mock `library`: пустое состояние, reload, пагинация, длинные URL; live регистрация и owner access                                | Пройдено текущими Go/mock/live проверками                                           |
| P02 | Предварительная карточка до ACK, валидация и повтор отправки; PRD 2–3                     | mock `library`: delayed POST, invalid URL, сетевой/HTTP сбой; предварительная карточка явно «Ещё не сохранено», исправляется в ней                                                                                         | Пройдено текущими Go/mock/live проверками                                           |
| P03 | Реальная обработка, заголовок, автоматическое чтение; PRD 4–5                             | live `archive`, `images`, `registration`: API → SQL job → worker → polling → reader; полный live benchmark проверяет приватный документ и media после DOM ready                                                            | Пройдено текущими Go/mock/live проверками                                           |
| P04 | Работа после закрытия страницы и restart worker; PRD 12                                   | live `recovery`: закрытие страницы, Retry-After, SIGKILL/reclaim; Go `TestRecoveryIntegrationKilledWorker`, `Heartbeat`                                                                                                    | Пройдено текущими Go/mock/live проверками                                           |
| P05 | Дедупликация владельца без нового job; PRD 15, Q05                                        | Go `ConcurrentDuplicate`, `LongKeysAndDigestCollision`, `SaveReloadAndDeduplicate`; live `phase3`: потеря POST после commit → reload → один ID/job/generation; mock исправленный дубликат получает фокус                   | Пройдено текущими Go/mock/live проверками                                           |
| P06 | Сообщение на 30 s, ошибка на 120 s, поздняя публикация запрещена; PRD 8, 10, Q04          | live `recovery` с реальным временем, `concurrency`: полная остановка API/worker; mock `waiting` с clock skew/offline; Go fences/expired reads/renewal                                                                      | Пройдено текущими Go/mock/live проверками                                           |
| P07 | Форматирование, ссылки, media, навигация и автономность; PRD 6–7, 16                      | live `archive`/`images`: форматированный fixture, закрытый socket оригинала, приватные media; отдельная сверка полного RU/EN-корпуса описана ниже                                                                          | **НЕ ПРИНЯТО: K01/K02/K03**; автономность fixture подтверждена live                 |
| P08 | HTML 3 MiB после декомпрессии; image 5 MiB, 20 MiB/50; PRD 11, лимиты Decisions           | Go safehttp/extract/assets: gzip/HTML, codecs, budgets, placeholders, `TestMaximumImageArchivePublication`, partial classifications; live `images`/`retry`: предупреждения и пропуски                                      | Пройдено текущими Go/mock/live проверками                                           |
| P09 | unavailable: без фиктивной читалки, пояснение, оригинал, retry, delete; PRD 14, Q01       | Go `TestNonArticleHTTPAndNetworkClassification`; live `retry` для home/PDF/video/login/paywall/JS-only; mock `retry`/`delete`                                                                                              | Пройдено текущими Go/mock/live проверками                                           |
| P10 | failed: причина, оригинал, новая попытка в той же карточке; PRD 13, Q03                   | live `archive`/`retry`: network error и blocked redirect отдельно от unavailable, новая generation; Go `TestRetryIntegrationSameCardBecomesReady`, `AtomicConcurrentAndFenced`; mock потеря retry ACK                      | Пройдено текущими Go/mock/live проверками                                           |
| P11 | Черновики аккаунта, вход/returnTo, изоляция; Q05–Q06                                      | mock `phase3`, `session-refresh`, `library`; live `phase3`: unsent/unknown, смена владельца, Back, поздние ответы, expired polling/document/media, отсутствующая статья; внешний/protocol-relative returnTo запрещён       | Пройдено текущими Go/mock/live проверками                                           |
| P12 | Ошибки списка/reader, явный GET retry, сохранение контента; Q07                           | mock `phase3`: первая/фоновая ошибка, пагинация, запрет storage; live `phase3`: прерванная сеть сохраняет документ, страницы и ввод; 401 скрывает приватное UI                                                             | Пройдено текущими Go/mock/live проверками                                           |
| P13 | Подтверждение удаления любого состояния, без undo; ошибка сохраняет карточку; Q06, PRD 16 | mock `delete`: processing/ready/unavailable/failed, отмена, pending, ошибки и потерянный ACK; live `delete`: cascade и закрытие reader другой вкладки, private URL недоступен                                              | Пройдено текущими Go/mock/live проверками                                           |
| P14 | Скорость ≥54/60 ≤15 s; PRD 9, Q02                                                         | Полная неизменённая серия и независимый `benchmark:recalculate`; учитываются все 60 попыток, пригодность документа и завершённое media                                                                                     | **ПРОЙДЕНО: 59/60**, пересчёт совпал                                                |
| P15 | Гонки и отсутствие воскрешения; фаза 4, сценарии 1–7                                      | Go `deletion_race`, worker `deletion_integration`; live `concurrency`: delete во время HTML/media/COMMIT, два worker, SIGSTOP/SIGKILL, retry/delete в двух вкладках, поздний execution, новый ID после удаления            | Пройдено текущими Go/mock/live проверками                                           |
| P16 | Backup/restore готового архива без оригинала; фаза 4/8, D                                 | Точная команда D `npm run test:archive:restore`: настоящий pg_dump/pg_restore, удаление исходной схемы, оригинал выключен, worker восстановления не запускается; новый вход, весь документ и SHA-256 PNG/JPEG/GIF, 401/404 | **НЕ ПРОЙДЕНО: K02**, 0/1; последующие assertions не достигнуты                     |
| P17 | Визуальная приёмка, UX, видео; все фазы                                                   | Библиотека, reader, login/register на 375×812, 768×1024, 1440×900; визуальный просмотр screenshots, UX-review, затем полные mock/live; видео успешных сценариев `video:on`                                                 | Пройдено: 27 снимков, UX; 321 mock + 111 live видео валидны; restore-видео — провал |
| P18 | Общая проверка, Go integration/общий модуль, mock/live, production/OpenAPI                | `make test`, go vet, метрики, lint/typecheck, оба Playwright, `make build`, `make openapi`; `backend/linkprocessing` явно включён в Makefile и команды                                                                     | Компоненты пройдены; **make check — НЕ ВЫПОЛНЕНО**, внешний раннер                  |

## Дополнительные обязательные границы архитектуры

| Требование                                                                                          | Проверка                                                                                                                                 | Результат                                                     |
| --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Atomic link+job, rollback, budget от commit, owner из сессии                                        | Go `EnqueueRollbackAndCommitBudget`, `RegistrationIntegrationCreatesSessionAtomically`, library access                                   | Пройдено текущим Go/live/mock прогоном                        |
| Lease/deadline/generation/token fences, атомарные document+assets и rollback COMMIT                 | Go `ClaimPublishFencesAndRollback`, `ConcurrentReclaimAndStalePublication`, `RenewalFences`, четыре `deletion_race`; live concurrency    | Пройдено текущим Go/live/mock прогоном                        |
| Безопасная загрузка HTML/media: DNS/redirect/private IP, TLS, cookies/proxy, ограниченные retries   | Go safehttp unit+integration, worker candidate tests; live blocked redirect не касается sink; deployment egress проверяется отдельно     | Пройдено; egress дополнительно подтверждён отдельной командой |
| Безопасная schema/renderer, XSS, приватные assets, одинаковые 404                                   | Go document/assets/access; mock formatting/image/processing; live archive/images; восстановленная изоляция — непроверена после провала D | Пройдено текущим Go/live/mock прогоном                        |
| Submitted/fetch/dedup/final URL не смешиваются; redirect/canonical не объединяют владельцев         | Go NormalizeURL и library integration; independent-account benchmark                                                                     | Пройдено текущим Go/live/mock прогоном                        |
| Миграции: чистая установка, upgrade, повторный/конкурентный запуск, checksums/rollback              | Go database `*MigrationsIntegration*`; восстановленный API проверяет исходную историю миграций                                           | Пройдено текущим Go/live/mock прогоном                        |
| Polling 2 s, активные записи вне страницы, hidden/focus/online/history; старые ответы отбрасываются | mock processing/waiting/phase3/session-refresh; live recovery/phase3                                                                     | Пройдено текущими Go/mock/live проверками                     |
| Диагностика queue/deadline/reclaim/stages/bytes без секретов                                        | Go `TestObservation*`, live benchmark services.log; SQL bytes сверяются с publication                                                    | Пройдено текущим Go/live/mock прогоном                        |

## Скорость

Выполнены последовательно:

```sh
npm run benchmark:archive -- --output tmp/archive-benchmark-phase4-final
npm run benchmark:recalculate -- tmp/archive-benchmark-phase4-final/runs.jsonl
```

[Все 60 строк](issue-23/runs.jsonl), [отчёт измерителя](issue-23/report.md),
[сводка](issue-23/summary.json), [независимый пересчёт](issue-23/recalculated.json),
[окружение](issue-23/environment.json), [этапы](issue-23/stages.json).
Пересчёт JSON полностью равен сводке, включая времена и результаты каждой статьи.
60 независимых аккаунтов, 60 HTTP 201 / created=true, generation=1, 60 пригодных ready,
нет missing/unavailable/failed. Числитель **59**, знаменатель **60**, цель ≥54 достигнута.
P50 **1,9475 s**, P90 **9,9462 s** — условные по всем 60 пригодным ready.

| Источник           | Попытки | Пригодные ready | ≤15 s |
| ------------------ | ------- | --------------- | ----- |
| go-strings         | 10      | 10              | 10    |
| go-pipelines       | 10      | 10              | 10    |
| MDN Introduction   | 10      | 10              | 10    |
| Cloudflare Pingora | 10      | 10              | 10    |
| Habr GC            | 10      | 10              | 10    |
| Habr Avito         | 10      | 10              | 9     |

Habr Avito #8: **33,936 s**, сохранён в знаменателе. Его media-этап занял
31,733 s; это не время парсера и не скрытая исключённая попытка. Текущий порог
скорости не является блокером и не переносится на «потом». Одной серии недостаточно,
чтобы обещать те же времена при другой сети/нагрузке.

Методика [#12](issue-12-method.md) не менялась: последовательные сохранения
неизменённых URL, начало — серверный requested_at непосредственно перед commit,
конец — первая видимая DOM-ready-карточка, включая очередь, HTML/media, publication
и polling. Проверка приватного документа и всех assets выполняется после фиксации
времени и определяет пригодность. Q03 допускает явно предупреждённые частичные
результаты; отсутствие постороннего контента оценивается отдельно, ниже.

Окружение: Apple M6 / 12 CPU / 24 GiB, macOS arm64, Node 22.23.1, Go 1.26.0,
Chromium 153.0.8010.12, Next 16.3.8, Readeck 2.1.3, PostgreSQL 18.6 в Docker.
Production Next, polling 2000 ms, один worker / одна последовательная отправка,
worker GOMAXPROCS=1, GOMEMLIMIT=384MiB, API GOMAXPROCS=2. Host-процессы без CPU quota,
worker benchmark без контейнерного firewall, но с production safehttp. Интернет
без throttling/proxy, CDN cache не контролируется. Во время измерений не запускались
Go/E2E/build других проверок. Корпус SHA-256 и driver SHA-256 записаны в environment;
они совпадают с #22. Единственный dirty-файл на момент старта — автоматически
сгенерированный Next `next-env.d.ts`; после проверок возвращается исходное содержимое.

## Отдельная проверка качества RU/EN-корпуса

Качество проверено **после** замеров по всем шести источникам, отдельно от времени.
[Машинная сверка 60 копий](issue-23/quality-checks.json),
[strong/emphasis/inline-code и ссылки](issue-23/inline-quality.json),
[соответствие 39 assets источникам и SHA-256](issue-23/quality-media.json),
[проверка production renderer](issue-23/quality-renderer.json),
[ручное заключение и K01](issue-23/quality-review.json).

Весь основной текст шести source snapshots прочитан; порядок абзацев, смысловые
заголовки, списки, цитаты, таблицы, код, изображения и подписи сопоставлены с архивом.
Нормализованное сравнение всех десяти копий каждого источника помогает сверке,
но не заменяет чтение и визуальный просмотр. В пределах каждого источника все десять
документов и наборы warnings идентичны. Дополнительно проверены порядок strong/emphasis,
inline-code, подписи и нормализованные href всех основных ссылок: потерь не обнаружено;
лишние узлы при этом оцениваются отдельно как K01. Проверены top/middle/bottom реального renderer,
раскрыты оба details Habr GC, принудительно загружены lazy images. Все 39 сохранённых
изображений просмотрены, декодируются, сопоставлены с source URL/asset_id; live benchmark
ранее проверил HTTP 200/MIME/байты приватных URL. Replay использует экспортированные
байты и API mock, поэтому не служит самостоятельным доказательством авторизации.

| Источник     | Основной текст и форматирование                                                                                    | Media / конкретное расхождение                                                                                                                     | Итог качества                                                                                     |
| ------------ | ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| go-strings   | 53 абзаца, 8 заголовков, 21 точный code block, 1 список; порядок сохранён                                          | Изображений, таблиц, цитат и подписей нет (N/A); playground UI исключён                                                                            | Пригодно; text_incomplete показан консервативно                                                   |
| go-pipelines | 50 абзацев, 10 заголовков, 26 code blocks, 4 списка; включая cancellation/MD5/bounded parallelism                  | Изображения/таблицы/цитаты/подписи N/A; авторский Further reading является содержимым                                                              | Пригодно; text_incomplete показан                                                                 |
| MDN          | Из 28 абзацев отсутствует вводное резюме; остальные 27, 11 заголовков, 2 code blocks, 8 ячеек, 6 списков сохранены | 1/1 изображение сохранено; после основного текста остаётся навигационный список Previous/Next                                                      | Частичный текст разрешён Q03 с text_incomplete; навигация — **K01**                               |
| Cloudflare   | 29 абзацев, 6 заголовков, 6 точных code blocks, 1 список; смысл сохранён                                           | 2 содержательных WebP отсутствуют (image_invalid), ещё 2 hidden SVG placeholders unsupported; у каждой позиции есть omission, images_omitted виден | Предупреждённый частичный результат допустим по Q03; подсветка некоторых Rust-блоков ошибочно CSS |
| Habr GC      | 85 абзацев, 12 заголовков, 13 точных code blocks, 2 списка, 11 подписей; оба details читаются                      | Все 13/13 основных изображений сохранены; перед текстом difficulty/read-time/views/type                                                            | Содержимое пригодно, служебные метаданные — **K01**                                               |
| Habr Avito   | 84 абзаца, 6 заголовков, 3 точных code blocks, 5 списков, 1 цитата; этапы алгоритмов читаются                      | Все 25/25 изображений сохранены; read-time/views и ссылка на предыдущую публикацию в конце                                                         | Содержимое пригодно, постороннее содержимое — **K01**                                             |

Для остальных отсутствующих в конкретном источнике типов блоков — N/A, их наличие
не выдумывается. Нет меню/рекламы/форм в проверенных Go/Cloudflare документах.
У обеих Habr сохраняется images_omitted при всех архивированных основных изображениях:
это консервативное предупреждение, а не доказательство потери основной иллюстрации.
Дублирующий исходный заголовок в document тоже отражён в заключении.

**K01, воспроизведение:** `tmp/archive-benchmark-phase4-final/artifacts/mdn-{1..10}.json`
содержат `document.blocks[50]`, последний list с Previous/Next; Habr Avito `{1..10}` — `document.blocks[111]`
со ссылкой на предыдущую статью. Habr GC blocks[1..4] и Avito blocks[1..2] —
служебные метаданные. Это видно в актуальном renderer, в частности
`tmp/issue-23/visual/habr-avito-tail.png` и `tmp/issue-23/visual/corpus-0.jpg`.
Навигация и related posts исключены из основного материала [методикой](issue-12-method.md).
Q03 разрешает предупреждённые потери, но не отменяет требование очистки от постороннего
содержимого. Поэтому строка P07 не объявляется зелёной. Исправление extraction и
повторная сверка этих источников в этой задаче не выполнены; это явное препятствие
завершению, а не неопределённая будущая фаза.

Команды отдельной сверки (после benchmark, production Web на 3300):

```sh
node docs/verification/issue-22/quality.mjs tmp/archive-benchmark-phase4-final
node docs/verification/issue-23/inline-quality.mjs tmp/archive-benchmark-phase4-final
node docs/verification/issue-22/renderer.mjs tmp/archive-benchmark-phase4-final http://127.0.0.1:3300
```

Source snapshots сделаны отдельным запросом после десяти попыток, а не копированием
точного ответа worker. Их status/final URL/SHA-256 сохранены в `*-source.json`.
Изменяемость страниц ограничивает выводы: этот прогон подтверждает проверенные
материалы, а не универсальную полноту извлечения любых сайтов.

## Визуальная проверка и UX

Просмотрены библиотека (ready/empty/draft error/delete confirmation), читалка финального
Habr Avito с 25 изображениями, вход/регистрация и их ошибки на **375×812,
768×1024, 1440×900**. Все 27 полных снимков находятся в `tmp/issue-23/visual/`;
[manifest и заключение](issue-23/visual-review.json) содержат имена, размеры и SHA-256.
Переносы, отступы, отсутствие перекрытий и горизонтального overflow проверены.
На mobile подтверждение удаления может потребовать вертикальной прокрутки;
кнопки доступны, не перекрыты. Брейкпоинты не менялись.

После визуального просмотра выполнено UX-ревью по
[ui-ux-pro-max](../../.agents/skills/ui-ux-pro-max/SKILL.md): конкретные рекомендации
`destructive action confirmation` и `error summary validation` найдены в UX-каталоге.
Проверены объяснение необратимости/отмена, keyboard focus, inline errors/role=alert,
связь ошибки с полем, pending/status, пустая библиотека, понятные retry и returnTo.
Блокеров в раскладке и взаимодействиях не найдено; K01 относится к качеству extraction.
Затем запущены полные Playwright-наборы. Регрессионные layout-тесты входа/регистрации
также проверяют соседние ширины 760/761 и малые/landscape размеры.

## Backup/restore и регрессия

Все команды уже завершились последовательно в существующем `checks.py web`;
после продолжения второго E2E-процесса не создавалось. Полный лог и статусы —
[checks.json](issue-23/checks.json). Неуспешный restore не скрыт последующими exit 0.

| Проверка                                                                                              | Фактический результат                                      | Доказательство                                                                                                                                                          |
| ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `make test`                                                                                           | PASS, все четыре Go-модуля, integration без кеша           | checks.json; worker 95,696 s; migrations компилируется, миграционные сценарии находятся в API integration                                                               |
| `go vet ./backend/api/... ./backend/worker/... ./backend/migrations/... ./backend/linkprocessing/...` | PASS                                                       | checks.json                                                                                                                                                             |
| `node --test scripts/archive-benchmark/metrics.test.mjs`                                              | PASS, 4 теста                                              | checks.json                                                                                                                                                             |
| `sh scripts/check-worker-egress.sh`                                                                   | PASS: реальные REJECT packets, UID 65532, нет capabilities | checks.json; временный контейнер/сеть очищены                                                                                                                           |
| `npm run test:e2e`                                                                                    | **318 passed**, 0 skipped/flaky/unexpected, 3,0 min        | [результаты](issue-23/test-e2e-results.json), [321 видео](issue-23/test-e2e-videos.json)                                                                                |
| `npm run test:e2e:integration`                                                                        | **104 passed**, 0 skipped/flaky/unexpected, 15,1 min       | [результаты](issue-23/test-e2e-integration-results.json), [111 видео](issue-23/test-e2e-integration-videos.json)                                                        |
| `npm run test:archive:restore`                                                                        | **FAIL: 1 failed**, 13,758 s с подготовкой; тест 8,9 s     | [результат](issue-23/test-archive-restore-results.json), [видео](issue-23/test-archive-restore-videos.json), [частичные доказательства](issue-23/restore-evidence.json) |
| `make build`                                                                                          | PASS, Go API/worker и production Next                      | checks.json                                                                                                                                                             |
| `make openapi`                                                                                        | PASS, swag и Redoc; tracked OpenAPI без изменений          | checks.json                                                                                                                                                             |
| `npm run lint --prefix web`, `npm run typecheck --prefix web`                                         | PASS после изменения restore-теста                         | checks.json                                                                                                                                                             |
| `make check`                                                                                          | **НЕ ЗАПУСКАЛСЯ** по указанию пользователя                 | Ожидается внешний раннер; не выдаётся за пройденный gate                                                                                                                |

Дополнительные `--reporter=list,json` меняют только формат вывода Playwright; точные
argv сохранены в checks.json. Наборы и продуктовые таймеры не сокращались.
Видео всех успешно выполненных UI-сценариев существуют в `tmp/playwright/videos/ui/`
и `tmp/playwright/videos/integration/`; manifest содержит SHA-256, размер и `ffprobe`
(codec/duration/разрешение). Все 432 файла валидны, включая дополнительные вкладки.
Один валидный файл restore в `tmp/playwright/videos/backup-restore/` показывает провал,
а не успешную приёмку. Временные видео, dump и traces не добавлены в Git.

**Что доказал D:** настоящий pg_dump/pg_restore выполнен; исходная схема удалена,
оригинальный HTTP socket выключен, восстановленный API запущен без worker.
Новый вход владельца и равенство полного API-документа прошли. Четыре document-ответа
в trace имеют один SHA-256 `077141a1042d07334998738ba694090a6c43e0287824ead847d7b8d806f77283`.
Сам документ содержит `{kind: "code", text: "backup_code = 42"}`.
Текст renderer до/после и strong/emphasis/quote/list на 375×812 совпали, но проверка
`article pre code` получила пустую строку вместо кода и остановила тест.

**K02:** локальный probe с теми же девятью языками lowlight возвращает truthy root
с `children: []` и `relevance: 0` для этого текста; `CodeBlock` выбирает пустые tokens
вместо исходного текста. Это дефект отображения уже сохранённого кода, а не обнаруженная
потеря байтов pg_restore. Продуктовое исправление не входит в продолжение приёмки
по указанию пользователя. Для завершения нужны исправление fallback renderer и
повтор **полного** D без удаления assertion.

После провала **не выполнены** проверки restored media SHA-256/подписей после code assertion,
восстановленного reader на 768×1024 и 1440×900, чужого владельца 404 и анонимного 401.
Их нельзя наследовать из успешного обычного live E2E. Итоговый `checksums.json`
намеренно создаётся только в конце успешного D, поэтому в этом прогоне отсутствует.
Вместо него `restore-evidence.json` хранит частичные document/media hashes из trace,
SHA-256 dump, артефакты и достигнутые/недостигнутые assertions с явным FAILED.
Dump имеет 0600, каталог 0700. После завершения harness исходной схемы и восстановленной
временной БД нет; это подтверждено отдельным read-only запросом.

Сверка SHA-256 со стартовым manifest подтверждает отсутствие изменений продуктового
backend/frontend/benchmark. Единственное изменение кода — транспорт приватных запросов
restore-теста, его итоговый hash сохранён в provenance. Генерируемый `next-env.d.ts`
возвращён к исходному содержимому; пользовательские файлы не откатывались.

## Критерии задачи #23

| Критерий                                                                        | Статус                                                                                   |
| ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Каждый обязательный пункт имеет актуальную проверку, результат и доказательство | Выполнено: матрица P01–P18 и расширенная матрица; провалы/непроверенное явно перечислены |
| Визуально library/reader/login/register, три разрешения, UX, видео              | Выполнено для UI/live; restore-видео не считается успешным                               |
| Общая проверка, Go integration, mock/live, production, OpenAPI, общий модуль    | Частично: перечисленные компоненты прошли; make check ожидает внешнего раннера           |
| Финальный benchmark и отдельное подтверждение качества                          | Скорость **59/60 PASS**, пересчёт совпал; качество **не принято полностью**, K01/K03     |
| Backup/restore читает архив без оригинала, D на итоговой версии                 | **НЕ ПРОЙДЕНО**, K02; недостигнутые assertions остаются непроверенными                   |
| Все блокеры исправлены либо явно препятствуют завершению                        | Выполнено как честный отчёт; фича не объявлена завершённой                               |

## Блокеры завершения

1. **K01 — качество очистки:** MDN Previous/Next, related link Habr Avito и метаданные Habr
   остаются в архиве. Нужны исправление extraction и повторная проверка полного корпуса
   и затронутой регрессии на итоговом коде. Текущий отчёт не подтверждает выполнение P07 полностью.
2. **K02 — восстановленный reader:** пустой блок кода при наличии текста в API-документе.
   Полный D провален; остальные assertions D после этого места непроверены.
   Нужны исправление renderer и повтор D на итоговой версии.
3. **K03 — потери корпуса:** вводный абзац MDN и два содержательных изображения Cloudflare
   не сохранены во всех десяти копиях. Предупреждения присутствуют, контракт частичного
   результата Q03 соблюдён, но эти реальные quality-замечания остаются открытыми;
   полная сохранность материалов не подтверждена. Их нельзя скрывать за 60 ready.
4. **Общая проверка:** `make check` запрещён пользователем и оставлен внешнему раннеру.
   До его результата обязательный общий gate не выполнен; индивидуальные проверки
   не выдаются за запуск этой команды.

Прежний блокер скорости в этой версии и окружении снят измерением 59/60 и совпавшим
пересчётом. Потери MDN/Cloudflare разрешают только явно предупреждённую частичную публикацию
по Q03 и остаются открытыми замечаниями качества. K01/K02 препятствуют завершению фичи.
