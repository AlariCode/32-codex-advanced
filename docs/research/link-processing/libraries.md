# Проверка библиотек и совместимости

Дата проверки: **2026-10-09**. Проверены официальные репозитории, API GitHub/Codeberg, опубликованные Go-модули и npm registry. Даты ниже — UTC, если не указано иначе. «Последний содержательный коммит» означает найденное последнее изменение функционального кода; документация, подготовка релиза и бот-обновления не считаются доказательством функциональной активности. Это снимок проверки, не гарантия будущего сопровождения.

## Извлечение

### Readeck go-readability v2.1.3 — основной кандидат Q08

- Происхождение: форк `go-shiori/go-readability`, развивавшийся Mislav, затем перенесённый в Readeck. Изменения и происхождение описаны в [FORK.md](https://codeberg.org/readeck/go-readability/src/branch/main/FORK.md). Исходный upstream прямо рекомендует этот преемник и [архивирован 2025-12-30](https://github.com/go-shiori/go-readability).
- Рассматриваемая стабильная версия **v2.1.3**, тег от **2026-09-30 18:53:19 UTC**, commit `66bcc21111f5de540fe6a19943055c673054f918`: [Go proxy metadata](https://proxy.golang.org/codeberg.org/readeck/go-readability/v2/@v/v2.1.3.info), [tag](https://codeberg.org/readeck/go-readability/src/tag/v2.1.3). Codeberg `/releases` показал последним оформленным release v2.1.2 от 2026-06-18; это не последний Go-тег.
- Важное расхождение: default branch `main` в API показывал историю до 2026-06-15. Проверка ветки/тега v2 дала **2026-09-22** — изменение обработки SVG `6aa71cc9`, объединённое **2026-09-30**: [commit](https://codeberg.org/readeck/go-readability/commit/66bcc21111f5de540fe6a19943055c673054f918). Проверять только `main` здесь недостаточно.
- Репозиторий не архивирован. Лицензия MIT; Go **1.23.0+** по [go.mod тега](https://codeberg.org/readeck/go-readability/src/tag/v2.1.3/go.mod). Совместим с Go 1.26 проекта; API v2 отличается от upstream: `Article.Title()`, `RenderHTML`, `RenderText`, `Node`, а не прежние строковые поля. Парсинг полученного HTML — `Parser.Parse`/`FromReader`; загрузку следует делать собственным защищённым клиентом. [API](https://pkg.go.dev/codeberg.org/readeck/go-readability/v2@v2.1.3).
- [Issue #21](https://codeberg.org/readeck/go-readability/issues/21), открыта: обрезание вложенного текста, особенно блоков со ссылками. Сопровождающий Mislav **2026-03-09** подтвердил проблему эвристики и отсутствие безопасного общего исправления; проблема оставлена открытой. Это ограничение качества, не свидетельство отсутствия сопровождения.
- Вывод: поддерживаемый преемник с собственными изменениями и ответом сопровождающего; пригоден для предложенного Go-пути, с обязательным корпусом проверки качества.

### Mozilla Readability 0.6.0 — альтернатива Q08

- Официальный [репозиторий](https://github.com/mozilla/readability), не архивирован, Apache-2.0. Последняя стабильная npm-версия **0.6.0**, опубликована **2025-03-03 21:50:47 UTC**: [registry](https://registry.npmjs.org/@mozilla/readability), [changelog](https://github.com/mozilla/readability/blob/main/CHANGELOG.md).
- Последнее найденное изменение `Readability.js` — **2025-09-29**, `d7949dc4`, улучшение wrapping/DOM: [commit](https://github.com/mozilla/readability/commit/d7949dc47dd9ed9ee1d3b34ffdcf3bce28cde435). Последние изменения репозитория 2026-07-09 включают NOTICE/лицензию и зависимости; их не выдаём за улучшения алгоритма. Не все изменения main входят в 0.6.0.
- `new Readability(document, options).parse()` принимает DOM, возвращает результат или `null`; JavaScript страницы сам не исполняет. Минимальный Node в package.json main — >=14, но DOM-зависимость задаёт более высокий фактический порог. [Документация](https://github.com/mozilla/readability#readability).
- [Issue #1024](https://github.com/mozilla/readability/issues/1024) от 2026-08-08, сбой Reader View на spectrum.ieee.org, открыта; комментариев сопровождающих на момент проверки нет. Также открыты вопросы заголовков с Unicode (#1034) и JSON-LD (#1030). Это предупреждает против обещания универсального извлечения.
- Вывод: стабильный upstream, не признан заброшенным из-за редких релизов, но скорость реакции по проверенной проблеме не подтверждена. Node-сервис усложняет Go-worker; качество на нашем небольшом корпусе не даёт причины добавлять второй runtime.

### jsdom: 27.4.0 в эксперименте; текущая 30.1.2

- [Репозиторий](https://github.com/jsdom/jsdom) не архивирован, MIT. Последняя стабильная **30.1.2**, опубликована npm **2026-10-04 09:15:00 UTC**, GitHub release 09:16:43: [registry](https://registry.npmjs.org/jsdom), [releases](https://github.com/jsdom/jsdom/releases).
- Последний проверенный функциональный commit **2026-10-04**, `7bf9653b`: инвалидация стилей при CSSOM/изменении controls; документация обновлена 2026-10-07. [История](https://github.com/jsdom/jsdom/commits/main/).
- 30.1.2 требует Node `^22.22.2 || ^24.15.0 || >=26.0.0`, установленный **22.19.0** не подходит. Эксперимент использует **27.4.0** (2025-12-26 10:56:39 UTC), Node `^20.19.0 || ^22.12.0 || >=24.0.0`. Это совместимый экспериментальный pin, не рекомендация устаревшей ветки для production. При выборе Node-пути предложено обновить Node и проверить актуальный jsdom.
- [Issue/PR #4367](https://github.com/jsdom/jsdom/pull/4367), удержание закрытых окон: есть ответ MEMBER `domenic`, требуется согласовать с #4324. Поэтому в сервисе нужны закрытие DOM и ограничение памяти; факт обсуждения не означает исправление в выбранной версии.
- По умолчанию выполнение скриптов и внешних подресурсов отключено. Не включать `runScripts: "dangerously"`/`resources: "usable"` для пользовательского HTML. [Официальная документация](https://github.com/jsdom/jsdom#executing-scripts).

### Playwright 1.64.0 — только для варианта с браузером

[Репозиторий](https://github.com/microsoft/playwright) не архивирован, Apache-2.0. Стабильный **v1.64.0**, **2026-10-07 20:40:43 UTC**: [release](https://github.com/microsoft/playwright/releases/tag/v1.64.0). Функциональный commit `77af5578` от **2026-10-09 00:47:16 UTC**, исправление tsconfig: [commit](https://github.com/microsoft/playwright/commit/77af5578f8). Это активный проект; фиксы других подсистем не доказывают качество парсинга статей. Проект сейчас объявляет `@playwright/test ^1.63.0` только для frontend-тестов; production browser-worker отсутствует.

[Issue #43213](https://github.com/microsoft/playwright/issues/43213), Firefox crash с `bypassCSP` и javascript URL: MEMBER-аккаунт воспроизвёл **2026-10-08**, ответ помечен как бот; Chromium/WebKit в описанном воспроизведении не падают. Не обобщать на безопасность запуска чужого JavaScript. Chromium надо изолировать и ставить совместно с зафиксированной версией Playwright; Docker-образ сам по себе не достаточная граница для недоверенных сайтов: [официальные рекомендации](https://playwright.dev/docs/docker). Браузерный путь не прототипировался.

## Очистка и HTML

### bluemonday v1.0.27 — жизнеспособная, но рискованная альтернатива Q09

- [Репозиторий](https://github.com/microcosm-cc/bluemonday) не архивирован; BSD-3-Clause. Последний стабильный Go-тег **v1.0.27**, **2024-07-04 13:09:59 UTC**: [Go proxy](https://proxy.golang.org/github.com/microcosm-cc/bluemonday/@v/v1.0.27.info). GitHub `releases/latest` показывает v1.0.26 от 2023-10-12: это неполная картина тегов.
- Последний функциональный commit **2025-04-04**, `aba082a5`, transparent color: [commit](https://github.com/microcosm-cc/bluemonday/commit/aba082a57c). Он не входит в тег v1.0.27. [go.mod тега](https://github.com/microcosm-cc/bluemonday/blob/v1.0.27/go.mod) не требует смены runtime проекта; в прототипе компилируется Go 1.26.5.
- Открытая [#225](https://github.com/microcosm-cc/bluemonday/issues/225), 2026-06-26, очень долгая очистка, без комментариев; открытый [PR #227](https://github.com/microcosm-cc/bluemonday/pull/227), 2026-09-05, предполагаемый CSS DoS, без комментариев/ревью в проверенных метаданных. Это сообщения авторов, не наш воспроизведённый security advisory.
- Проверен [форк lunny/bluemonday](https://github.com/lunny/bluemonday): parent upstream, последняя push-дата 2021-04-06, актуальное самостоятельное сопровождение не подтверждено. Не подходит как поддерживаемая замена. Поиск также нашёл JS-порт и зеркала; установленного официального преемника не обнаружено. Это не полный аудит всех форков.
- Вывод: не объявляем библиотеку заброшенной по одному редкому коммиту, но текущая реакция на значимые проблемы не подтверждена. Не предлагаем её как уверенно сопровождаемую основу безопасности. Если выбран HTML-путь, нужна строгая политика без CSS, актуальные транзитивные зависимости и отдельная проверка рисков; для MVP предлагается ограниченная структура статьи.

### golang.org/x/net v0.58.0 — существующая зависимость

Уже есть в `backend/api/go.mod` косвенно. Для структурного преобразования станет прямой зависимостью worker/shared-модуля. BSD-3-Clause; [модуль](https://pkg.go.dev/golang.org/x/net@v0.58.0/html), [исходники](https://go.googlesource.com/net/). Тег v0.58.0 от **2026-08-12 17:41:32 UTC**: [metadata](https://proxy.golang.org/golang.org/x/net/@v/v0.58.0.info). Текущий стабильный тег **v0.60.0** от **2026-10-08 17:22:58 UTC** подтверждён [Go proxy](https://proxy.golang.org/golang.org/x/net/@v/v0.60.0.info). В эксперименте сохранён v0.58.0 для соответствия текущему проекту; переход на v0.60.0 отдельно не проверялся. Последний проверенный содержательный commit репозитория **2026-10-08 23:44:16 UTC**, `8456a207cc`, QUIC frame validation: [mirror](https://github.com/golang/net/commit/8456a207cc).

GitHub является зеркалом; вопросы проверены в [Go issue tracker](https://github.com/golang/go/issues). Открытая [#77966](https://github.com/golang/go/issues/77966) касается настройки предела стека HTML-парсера; MEMBER Roland Shoemaker **2026-03-05** подтвердил, что предел относится ко всем функциям парсинга. [#79573](https://github.com/golang/go/issues/79573), DoS при построении HTML-дерева, опубликована **2026-05-21** и закрыта; комментариев API не вернул, а статус закрытия сам по себе не доказывает версию исправления. Отдельный официальный [GO-2026-5027](https://pkg.go.dev/vuln/GO-2026-5027), опубликованный **2026-05-22**, описывает XSS-риск parse/render до **v0.55.0**. Первоначальная транзитивная v0.41.0 попадает в этот диапазон, текущая v0.58.0 проекта — нет. Это причина повторить прототип с версиями проекта и не понижать x/net при интеграции Readeck. Полный vulnerability scan графа зависимостей не выполнен. `html.Parse` — парсер, не sanitizer. Безопасность предлагаемой структуры зависит от ограниченного преобразователя и renderer, а не от названия пакета.

## Очередь и PostgreSQL

### River v0.49.0 — кандидат Q11

- [Репозиторий](https://github.com/riverqueue/river) не архивирован, MPL-2.0 для open-source core; Pro-функции отдельны. Последний стабильный **Go-релиз v0.49.0** от **2026-10-05 15:50:29 UTC**: [release](https://github.com/riverqueue/river/releases/tag/v0.49.0). `releases/latest` вернул Ruby v0.13.0 — его нельзя использовать как версию Go-модуля.
- Последнее найденное изменение `client.go`: **2026-10-04 19:53:09 UTC**, `6cdaf386`, устранение лишних subtransactions: [commit](https://github.com/riverqueue/river/commit/6cdaf386c3f672e267ff19a5eb3b105a081171bc). Общий репозиторий активен и позднее, но содержит другие языки.
- [go.mod v0.49.0](https://github.com/riverqueue/river/blob/v0.49.0/go.mod): Go 1.26.0, preferred toolchain go1.26.6, pgx v5.11.0 как в проекте. Локально установлен Go 1.26.5: директива toolchain может вызвать загрузку 1.26.6; заранее зафиксировать версию CI и worker. [Поддержка PostgreSQL](https://riverqueue.com/docs): проверяются три последних major, PostgreSQL 18 входит в текущий диапазон.
- [riverdatabasesql](https://riverqueue.com/docs/database-drivers) поддерживает `*sql.DB` и `*sql.Tx`, поэтому API не нужно переводить целиком на pgxpool. Рекомендуемый для worker riverpgxv5 даёт LISTEN; sql-only работает polling. Миграции River требуют собственного управляемого шага, их нельзя просто забыть рядом с миграциями приложения.
- [#1433](https://github.com/riverqueue/river/issues/1433), registry после alias collision, открыта, комментариев нет. [#1485](https://github.com/riverqueue/river/issues/1485), уведомление cancellation для неработающей задачи, открыта, комментариев нет. Не строить correctness удаления на доставке события очереди. [Cancellation](https://riverqueue.com/docs/cancelling-jobs) и [reliable workers](https://riverqueue.com/docs/writing-reliable-workers) описывают контекст отмены и повторяемость; worker обязан быть идемпотентным.
- Вывод: актуально сопровождаемый core без Redis. Версия ещё 0.x, обновления требуют чтения migration/release notes. MPL-2.0 требует соблюдения лицензии для изменённых файлов самой библиотеки; это не замена юридической оценке модели распространения продукта.

### pgx v5.11.0 — существующая зависимость Q11/Q12

[Репозиторий](https://github.com/jackc/pgx), не архивирован, MIT. Последний release **v5.11.0**, **2026-09-07 23:46:37 UTC**: [release](https://github.com/jackc/pgx/releases/tag/v5.11.0). Содержательный commit **2026-10-05 11:41:20 UTC**, `3a84369e`, double-close при OnPgError: [история](https://github.com/jackc/pgx/commits/master/). [#2673](https://github.com/jackc/pgx/issues/2673), cancellation может затронуть следующий запрос, открыта 2026-10-08, комментариев нет. Это новая неподтверждённая сопровождающими проблема, а не доказанная поломка Linkbook; важно проверять отмену и повторное использование пула.

Варианты на собственном SQL и стандартной библиотеке Go не добавляют сторонние библиотеки. Для них критерий сопровождения переносится на собственный код и используемые [PostgreSQL 18](https://www.postgresql.org/docs/18/index.html), Go 1.26.5. Полный vulnerability scan графа зависимостей, аудит всех issues и проверка production-нагрузки не выполнены.
