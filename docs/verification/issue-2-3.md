# Проверка issue #2 и #3

Объём объединён по указанию пользователя: безопасная загрузка и успешный путь
извлечения/чтения реализуются вместе. Зависимость #1 закрыта; #2 является
внутренней зависимостью общего изменения. Исходные PRD/Decisions и план сохранены.

## TDD

До реализации написаны `processing_integration_test.go`,
`snapshot_migrate_integration_test.go`, `safehttp/client_test.go`,
`extract/article_test.go`. Красный запуск с доступными PostgreSQL/sockets:
маршруты дают 404 вместо 401/контрактов, claim не возвращает execution,
snapshots отсутствует, сетевой клиент/извлечение не реализованы.
После этого эти четыре файла зафиксированы SHA-256 и не менялись при реализации.
Повторная сверка `/tmp/linkbook-tdd-sha256.txt` — все четыре OK.
Дополнительный `dns_integration_test.go` проверяет реальные DNS-пакеты;
Playwright-тесты написаны после реализации, визуального прохода и UX-ревью.

## Критерии и ожидаемый результат

| Issue / критерий                                                     | Проверка                                                                                                                             | Ожидаемый результат                                                                                                                                      |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #2: недоступный/запрещённый URL, автоматическая ошибка               | `integration/archive.spec.ts`, worker errors                                                                                         | Реальные POST → job → worker; 503 и private redirect дают безопасную причину без reload                                                                  |
| #2: private/loopback/metadata, mapped, mixed DNS, rebinding, pinning | `safehttp/client_test.go`, `TestDNSIntegrationMixedAnswersAndRebinding`, egress-script                                               | Настоящие HTTP/TLS sockets и UDP A/AAAA; закрытый sink не получает запросов; dial получает проверенный IP; TLS сохраняет DNS name и проверку сертификата |
| #2: HTML, ресурсы, HTTP-only                                         | `TestDecompressedBodyHeadersRedirectAndBudgetLimits`, `TestArticleParsingResourceLimitsAndNoFalseCompleteTruncation`, реальный архив | gzip >3 MiB, большие headers, redirect loop и timeout отклоняются; depth/tokens/DOM ограничены; HTTP fixture не переводится в HTTPS                      |
| #2: stale/expired записи, короткие транзакции                        | `TestProcessingIntegrationClaimPublishFencesAndRollback`, `TestProcessingIntegrationRejectInvalidSnapshotAndExpiredClaim`            | Изменённые generation/token/state/deadlines/lease и удалённая карточка не публикуются; второй claim пуст; NOWAIT-lock доступен после claim               |
| #2: приватность, 401, terminal                                       | API integration и `processing.spec.ts`, реальный второй браузер                                                                      | Чужие IDs отсутствуют; 401 скрывает UI; terminal не вызывает частых status-запросов                                                                      |
| #2: отдельный интеграционный harness                                 | `npm run test:e2e:integration`; отдельно `npm run test:e2e`                                                                          | Настоящие API/DB/worker/fixture; собственная e2e-схема удаляется; mock-регрессия запускается отдельно                                                    |
| #3: настоящий успешный путь                                          | `integration/archive.spec.ts`, archive origin shutdown                                                                               | POST → PostgreSQL → worker → HTTP → Readeck → snapshot → renderer без подмены звеньев                                                                    |
| #3: заголовок и форматирование без menu/footer                       | `TestArticleUsesReadeckAndOnlyPublishesKnownTextBlocks`, реальная читалка                                                            | Автоматический ready; ожидаемые заголовки, абзацы, 3 пункта списка и цитата; menu/footer/активные узлы отсутствуют                                       |
| #3: независимость от оригинала                                       | fixture `/off`, проверка отказа TCP, reload читалки                                                                                  | Fixture прекращает слушать; текст после reload совпадает с сохранённым                                                                                   |
| #3: атомарный ready/snapshot                                         | Publication/rollback tests, deferred constraints                                                                                     | Ошибка deferred commit откатывает snapshot/ready/job; невалидный документ отклонён до записи; ready без snapshot не коммитится                           |
| #3: доступ, несовместимость, опасные узлы                            | API access tests, renderer tests, два настоящих аккаунта                                                                             | 404 чужой = 404 отсутствующий; 401 без сессии; версия 99 даёт controlled error; разметка остаётся текстом                                                |
| #3: чистая БД, upgrade, повтор и UI                                  | `TestSnapshotsMigrationsIntegrationCleanUpgradeRestart`, mock/real Playwright                                                        | 005 применяется к чистой схеме и после 004; повтор безопасен; frontend проверяется на трёх разрешениях                                                   |

## Визуальная проверка и UX

Страницы `/` и `/links/[id]`: 375×812, 768×1024, 1440×900,
дополнительно ширины 639/641 около breakpoint. Проверены processing, ready,
ошибка загрузки, читалка, переносы URL/заголовка, отсутствие горизонтального
переполнения, keyboard focus, открытие оригинала и возврат в библиотеку.
Скриншоты — `tmp/playwright/screenshots/` и папки интеграционных сценариев.

UX-ревью с ui-ux-pro-max: сохранён стиль существующей библиотеки;
у ready оставлено одно действие чтения; статус завершения использует общую
live region, без конкурирующих объявлений карточек. Контраст текста/фона,
размеры ссылок 44 px, читабельность, фокус и мобильный перенос проверены.

## Ограничения объёма

- #4: восстановление lease/reclaim, transient retries, обслуживание истёкших
  попыток и UX 30/120 секунд не реализованы. Fences/deadline уже обязательны
  при публикации; прерванное или просроченное задание пока может оставаться
  processing до следующего этапа.
- Изображения, полная схема форматирования, классификация отсутствия статьи,
  ручной retry, returnTo/восстановление ошибок чтения и удаление — следующие фазы.
- Размер/структура входа ограничены; это не обещание полноты извлечения любых
  сайтов. CPU/RAM дополнительно ограничены контейнером. Production deployment
  закрывает IPv6 egress; прикладные IPv6-проверки сохраняются.
- Harness разрешает только точный loopback fixture-origin в отдельном бинарнике;
  это не доказательство production-policy. Она проверяется отдельно реальными
  socket/DNS-тестами и firewall-скриптом.

## Фактические результаты

Все строки матрицы покрыты успешными проверками; ожидаемый и фактический
результаты совпали. Команды выполнялись из корня репозитория.

| Команда                                                                   | Результат                                                                                                                                             |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `make check`                                                              | PASS: Go tests, vet, ESLint без предупреждений и TypeScript                                                                                           |
| `make test`                                                               | PASS: отдельная PostgreSQL, публикация/fences/rollback/доступ/миграции, реальные UDP DNS и TCP/TLS                                                    |
| `npm run test:e2e`                                                        | PASS: 141 тест на mobile/tablet/desktop, включая вход/регистрацию и 15 новых UI-проверок                                                              |
| `npm run test:e2e:integration`                                            | PASS: 9 настоящих сценариев на mobile/tablet/desktop                                                                                                  |
| `make build`                                                              | PASS: API, worker и production Next.js, динамический маршрут читалки                                                                                  |
| `make openapi`                                                            | PASS: новые маршруты и общий document DTO, Redoc сгенерирован                                                                                         |
| `sh scripts/check-worker-egress.sh`                                       | PASS: DNS работает; четыре реальных private/loopback/metadata TCP-назначения отклонены firewall; UID 65532 без capabilities не может изменить правила |
| `docker compose -f compose.worker.yaml config --quiet` с test-параметрами | PASS: production-конфигурация валидна                                                                                                                 |

Проверены 153 непустых WebM: 141 mock, 9 основных интеграционных, 3 записи
второго браузера. ffprobe прочитал все файлы с положительной длительностью;
кадр настоящего сценария дополнительно просмотрен. Видео и скриншоты
сохраняются только в `tmp/playwright/`, в Git не входят.
Тестовые схемы `e2e_*` после штатного завершения отсутствуют.

GitHub Actions workflows и repository rulesets отсутствуют; main не защищена
обязательными status checks. Обязательных недоступных проверок нет.
