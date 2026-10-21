# Личная библиотека и текстовый архив

Все маршруты требуют существующую HttpOnly cookie `linkbook_session` из входа или регистрации.
Владелец определяется сервером по хешу токена и неизёкшей сессии. Все ответы,
включая ошибки авторизации, получают `Cache-Control: no-store`.

| Маршрут               | Контракт                                                                                                                                                                          |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/users/me`   | Публичные `id`, `email`, `created_at`; без сессии — 401                                                                                                                           |
| `POST /api/links`     | JSON `{ "url": "http://example.com/article" }`; 201 и `{link, created: true, server_time}` после commit; нормализованный дубликат — 200, `created: false` и существующая карточка |
| `GET /api/links`      | `{links: [], next_cursor: "", server_time}`; `limit` 1–100 (по умолчанию 20); следующий запрос передаёт непрозрачный `cursor`                                                     |
| `GET /api/links/{id}` | Метаданные своей карточки; чужой/отсутствующий UUID — одинаковый 404                                                                                                              |

Карточка содержит `id`, `submitted_url`, nullable `title`/`reason`, `warnings`,
`state`, `generation`, `created_at`, `requested_at`, `deadline_at`, `can_read`.
Новая карточка начинается с `processing`; worker публикует `ready` вместе со
snapshot или `failed` с безопасным кодом причины. Внутренние fetch URL, ключ дедупликации и execution token
в ответ не входят.

## Origin и proxy

API по-прежнему слушает только `127.0.0.1`. Next.js использует явные rewrites
с серверным `API_ORIGIN` для приватных маршрутов. POST требует Origin,
точно совпадающий с серверным `PUBLIC_ORIGIN` (по умолчанию
`http://localhost:3000`), и loopback-подключение. Для другого публичного адреса,
включая `http://127.0.0.1:3000`, задайте соответствующий `PUBLIC_ORIGIN` API.
При HTTPS-развёртывании задайте полный HTTPS origin без завершающего `/`.
Пользовательские Host/X-Forwarded-Host/X-Forwarded-Proto не определяют
разрешённый origin. Cookie сохраняет HttpOnly, Secure и SameSite=Lax.

## Сохранение и очередь

`submitted_url` — исходный адрес без внешних пробелов; `fetch_url` сохраняет
исходную схему и query, исключая fragment. `dedup_key` рассчитывается существующей
`NormalizeURL` без изменений её правил. URL с userinfo, пробелами/обратными слешами,
невалидным UTF-8 или длиной более 64 KiB отклоняются; тело POST ограничено 128 KiB.
Нормализатор не служит защитой загрузки: worker отдельно проверяет URL, DNS,
все redirect и привязывает соединение к проверенному публичному IP.

Транзакция блокирует группу `(user_id, SHA-256 ключа)` advisory lock PostgreSQL,
сравнивает полный ключ и создаёт запись в свободном `dedup_slot` под UNIQUE
ограничением `(user_id, dedup_digest, dedup_slot)`. Это позволяет индексировать
длинные ключи и сохранять разные URL при совпадении digest. Конкурентный дубликат
возвращает ту же карточку без изменения `created_at` и дополнительного задания.

Карточка и `processing_jobs` создаются одной транзакцией. Ошибка enqueue
откатывает обе записи. После enqueue, непосредственно перед commit, единый
серверный timestamp задаёт начало попытки и deadline +120 секунд, включая
дальнейшее ожидание в очереди. Время ожидания блокировки/enqueue бюджет не
расходует; PostgreSQL не предоставляет будущий точный timestamp commit,
поэтому между установкой timestamp и commit остаётся короткий SQL-хвост.
Начальное задание — `queued`, generation 1, без lease/execution token.
Worker захватывает queued короткой транзакцией с SKIP LOCKED и lease до
45 секунд, затем выполняет сеть вне транзакции. Публикация проверяет состояние,
существование, generation, execution token, оба durable deadline и lease;
snapshot, ready и завершение job фиксируются вместе.

Список фильтруется по владельцу и упорядочен `(created_at DESC, id DESC)`.
Keyset cursor хранит оба значения; вставки новых записей между страницами
не сдвигают уже выбранную границу. Нет OFFSET и передачи документа/media.

## Проверки критериев issue #1

| Критерий                                                 | Проверка и ожидаемый результат                                                                                                                                                                            |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Пустой список, мгновенная карточка, исправление и повтор | `web/tests/e2e/library.spec.ts`: карточка до задержанного ответа, локальная/API-валидация, сетевые/серверные ошибки, повтор                                                                               |
| Reload и durable-задание без worker                      | `TestLibraryIntegrationSaveReloadAndDeduplicate`: новый handler читает БД; начальная задача queued; дополнительно реальный браузерный проход                                                              |
| Последовательные/конкурентные дубликаты и владельцы      | `TestLibraryIntegrationSaveReloadAndDeduplicate`, `TestLibraryIntegrationConcurrentDuplicate`: 12 одновременных POST дают 1 карточку и 1 job; другой владелец получает отдельную запись                   |
| Откат enqueue и бюджет после медленного enqueue          | `TestLibraryIntegrationEnqueueRollbackAndCommitBudget`: SQL-trigger с ошибкой даёт 0/0 записей; задержка enqueue не отнимается от 120 секунд                                                              |
| Стабильная пагинация                                     | `TestLibraryIntegrationPagination`: timestamp ties, UUID tie-breaker, вставка между страницами, отсутствие пропусков/повторов и чужих записей                                                             |
| Длинные URL и digest-коллизия                            | `TestLibraryIntegrationLongKeysAndDigestCollision`: 12 KiB ключи; искусственное совпадение digest не подменяет полный ключ, повтор не создаёт job                                                         |
| Сессии, чужие ID, Origin и скрытие UI                    | `TestLibraryIntegrationAccessAndValidation` и Playwright: нет/неверная/истёкшая сессия, одинаковый 404, запрет cross-origin и spoofed forwarded headers, очистка UI при 401 и игнорирование позднего POST |
| Чистая установка, upgrade, restart                       | `TestLibraryMigrationsIntegrationCleanUpgradeRestart`: сохранение прежних users/user_sessions; старые миграции неизменны                                                                                  |
| Общий модуль                                             | `go.work`, `make check`, `make test`, `npm run lint` включают `backend/linkprocessing`; API вызывает его в интеграционных тестах                                                                          |

Обязательные команды из корня: `make check`, `make test`, `npm run test:e2e`,
`make build`, `make openapi`. UI-тесты моделируют ответы для управляемых UX-сбоев;
атомарность, конкуренция и миграции проверяются на настоящей PostgreSQL.
Видео всех UI-прогонов — `tmp/playwright/videos/`, временные артефакты исключены из Git.

## Статусы и документ

- `GET /api/links/statuses?ids=<uuid>,<uuid>` — до 100 IDs; возвращает только
  свои карточки с generation, серверными датами и `server_time`. Чужие и
  отсутствующие IDs одинаково отсутствуют в `links`. Без `ids` возвращается
  keyset-страница processing (`limit` 1–100, `cursor`), независимо от страницы
  библиотеки. Пропавший известный ID заставляет UI сверить список.
- `GET /api/links/{id}/document` — `{document, title, submitted_url, warnings,
generation}`. `document.schema_version` равен 1; блоки: paragraph, heading
  (уровни 2–6), list (массив текстовых items, ordered), quote и code. У code
  сохраняются переносы и отступы; необязательное language задаёт язык подсветки.
  Неизвестный язык или большой блок остаются безопасным текстом. Текст — строка,
  никогда HTML/props/style; inline ссылки сохраняют текст без внешних ресурсов.
- Чужой и отсутствующий документ дают одинаковый 404; нет сессии — 401.
  Неготовый документ — 409 `article_not_ready`, unavailable —
  `article_unavailable`, несовместимая/невалидная схема — `unsupported_document`.
- Ошибки worker: `destination_blocked`, `network_error`, `http_error`,
  `html_too_large`, `unsupported_content`, `redirect_limit`, `processing_error`.
  Диагностика не содержит сетевых адресов, query или stack traces.
- HTML свыше 3 MiB после gzip отклоняется целиком. Усечённый документ не
  публикуется. Известные пропуски media/таблиц обозначаются предупреждением
  `text_only_archive`; исходный HTML не хранится и не выдаётся.

Все маршруты session/owner-scoped и no-store. Полный контракт доступен в OpenAPI;
[матрица проверок #2/#3](../../docs/verification/issue-2-3.md).

## Ожидание и восстановление (#4)

Бюджет попытки — 120 секунд от серверного сохранения, включая очередь и
внутренние повторы. API при старте и каждую секунду обслуживает истёкшие
попытки независимо от worker; все пути чтения и duplicate POST также обслуживают
истечение. Результат — `failed`, `reason: "timeout"`, без читалки. После полного
отказа обслуживание возобновляется при запуске API/первом чтении.

Worker продлевает 45-секундную lease каждые 10 секунд, только с текущими
state/generation/token и живыми lease/deadlines. При потере lease работа
отменяется; даже запоздалый результат проверяется SQL fences. Reclaim истёкшей
lease получает новый token, сохраняя generation и исходный deadline.

HTTP-загрузка делает до пяти попыток при временных сетевых сбоях, 429 и 5xx.
Backoff — 250/500/1000/2000 мс; Retry-After (секунды или HTTP-date) задаёт
минимальное ожидание. Каждая попытка с её redirects ограничена 25 секундами, общий context —
исходным deadline. Постоянные HTTP/TLS/security-ошибки не повторяются.

UI через 30 секунд меняет только сообщение. Основа времени — `server_time`
и монотонное время вкладки, а не часы браузера; reload получает серверный возраст.
Локальный таймер не объявляет timeout без ответа API. При полной недоступности
API/worker нет обещания обновления браузера ровно на 120-й секунде. Закрытие
страницы и истечение сессии не отменяют сохранённую задачу; 401 скрывает UI.

[Проверки восстановления](../../docs/verification/issue-4.md).

### Ручной повтор статьи

`POST /api/links/{id}/retry` принимает JSON `{ "generation": 1 }` и возвращает
`{link, server_time}`. Требуются действующая сессия владельца, правильный Origin
и loopback proxy. Повтор failed/unavailable атомарно увеличивает generation,
создаёт job, возвращает processing с новым 120-секундным бюджетом от серверной
фиксации; ID/created_at не меняются. Старые executions отзываются.
При повторной доставке запроса с generation меньше текущей возвращается текущая
карточка без новой job, включая уже завершённую попытку. Совпадающая generation
в processing/ready или generation из будущего даёт 409 retry_conflict.
Без корректной положительной generation — 400, чужая/несуществующая карточка — 404. Ошибка enqueue/commit откатывает всю попытку. Ответы приватные no-store.
