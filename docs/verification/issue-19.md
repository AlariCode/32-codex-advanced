# #19 — Удаление и конкурентная обработка

## Реализация

Worker проверяет отмену после HTML и media, прежде чем продолжать обработку.
Публикация наследует context исполнения: исходный deadline и отмена heartbeat
действуют также при ожидании SQL-блокировок и COMMIT. SQL-fences generation,
execution_token, lease и durable deadline остаются обязательными; production
не получает тестовых барьеров и транзакции не охватывают HTTP-загрузки.

Отмена удаления best effort: heartbeat проверяет существование актуального
задания каждые 10 секунд. Остановленный процесс и некооперативный HTTP-клиент
могут закончить работу позже, но не получают права восстановить удалённый ID.

## Воспроизводимые проверки

Все Go-сценарии используют отдельную схему тестовой `linkbook_test`:

- `TestDeleteIntegrationPublishSerialization`: обе последовательности
  DELETE/Publish, явные SQL-барьеры и ожидание `pg_blocking_pids`, невидимость
  незакоммиченных document/media, каскадное удаление и архив другого владельца.
- `TestDeleteIntegrationConcurrentRetryAddAndClaim`: одновременные retry,
  delete, add и два claim; повторное сохранение получает новый ID и одно
  активное задание, старое исполнение отвергается.
- `TestDeleteIntegrationConcurrentPublicationsKeepCurrentGeneration`: восемь
  одновременных публикаций старой и новой generation; ровно один победитель,
  один snapshot/media и отсутствие активного задания после успеха.
- `TestDeleteIntegrationArchiveCommitRollback`: ошибка deferred COMMIT на
  media откатывает snapshot, assets, состояние карточки и завершение задания;
  повторная публикация той же актуальной попытки успешна.
- `TestRecoveryIntegrationDeletionCancelsHTMLAndMedia`: удаление во время
  обоих этапов отменяет context через настоящий heartbeat; внешняя операция
  возвращает ответ после отмены, архив не появляется.
- `TestRecoveryIntegrationDeadlineCancelsBlockedPublication`: ожидание
  SQL-блокировки публикации заканчивается по deadline исполнения. Только
  в этом быстром тесте durable deadline сокращён; продуктовые 120 секунд
  проверяются отдельным процессным сценарием без изменения часов БД.

`web/tests/e2e/integration/concurrency.spec.ts` входит в существующую команду
`npm run test:e2e:integration`, проект `recovery` (1440×900):

1. HTML/media fixture останавливается на первом запросе с уникальным ключом.
   Первый worker получает SIGSTOP; UI удаляет карточку и сохраняет URL заново.
   Второй worker публикует новый ID, первый получает старый ответ и SIGCONT.
   Дополнительный барьер подтверждает завершение старого исполнения перед
   проверкой отсутствия старого ID и всех его ресурсов.
2. Deferred SQL-trigger останавливает настоящий COMMIT после записи всего
   архива. До COMMIT другая сессия не видит ни document, ни media. SIGKILL
   worker и снятие барьера оставляют либо полный архив, либо полный rollback;
   два worker восстанавливают только незавершённое задание с прежним deadline.
   При потере клиента во время COMMIT его исход неизвестен: тест намеренно
   допускает оба атомарных исхода. Принудительный rollback проверяется Go-тестом.
3. SIGKILL после подтверждённого COMMIT, запуск двух worker и удаление готового
   архива не приводят к повторной обработке или остаткам media.
4. Retry в другой вкладке конкурирует с DELETE: допустимы 200/404 для retry,
   удалённая карточка и задания отсутствуют после обоих ответов.
5. Полная остановка API/worker с claimed и queued заданиями длится до исходных
   120 секунд. После восстановления API показывает timeout с прежним deadline,
   worker не запускает просроченные задания и не создаёт архив.

Harness управляет `/worker`, `/worker2`, `/api` через `on/off/pause/resume`,
HTTP-барьерами `/barrier/release?key=...`, SQL-барьером
`/publication/hold?id=...` и `/publication/release`; `/link/stats?id=...`
возвращает атомарный снимок состояния и числа executions/snapshots/assets.
Всё управление доступно только локальному integration harness; его DB-команды
требуют `linkbook_test` и `e2e_*`. Видео включены также для успешных сценариев
и второй вкладки, каталог — `tmp/playwright/videos/integration/`.

## Проверка в ограниченном окружении

- `GOCACHE="$PWD/tmp/go-build" make build` — успешно: API, worker, Next.js.
- `go vet` без тега и с `-tags=integration` — успешно с локальным GOCACHE.
- Компиляция всех Go integration-тестов (`go test -tags=integration ... -run '^$'`)
  — успешно; это не выполнение сценариев с БД.
- ESLint, TypeScript, проверка синтаксиса harness — успешно.
- Playwright `--list` — новые шесть сценариев зарегистрированы в `recovery`.
- Полный `go test` — API, extract, migrations и linkprocessing прошли; сетевые
  тесты worker/safehttp остановлены запретом sandbox на `listen` локальных портов.
- `make test-db-up` — отказ доступа к Docker socket. Выполнение DB integration
  и E2E, а также запись новых видео остаются неподтверждёнными. Запуск E2E
  дошёл до подключения к PostgreSQL и получил `connect: operation not permitted`. Приёмка требует внешнего окружения
  с Docker и разрешёнными локальными портами.
- `make check` не запускался по указанию задачи. Ralph, commit, push и GitHub
  mutations не выполнялись. UI-код не менялся.
