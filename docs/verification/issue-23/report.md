# Live archive benchmark

Date: 2026-11-10T10:34:29.664Z. Sequential saves; fixed six-article corpus; ten independent accounts per article.

Ready within 15 seconds: **59/60**, required **54/60**. Target **MET**. Confirmed new saves: 60/60; valid ready: 60/60; recorded: 60/60.

Timing: server requested_at (transaction timestamp immediately before commit), confirmed by HTTP 201/created=true, to first browser DOM ready observation. API and browser share the launcher host; the PostgreSQL VM clock is assumed synchronized. Queue, network/media, processing, commit and normal UI polling are included. Document/asset validation follows observation and determines eligibility, without adding validation time to the measurement. Quality review is separate and is never inferred from counts.

Conditional valid-ready p50/p90: 1947.5/9946.199951171875 ms. Failures and missing samples remain in the denominator 60. Partial media must have explicit omission reasons/warnings.

Environment and raw evidence: report.json, runs.jsonl, environment.json. Account credentials/cookies are not recorded. Source HTML and archived documents for manual review are local artifacts, not part of the committed report.

| Article      | Recorded | Ready | ≤15s |
| ------------ | -------: | ----: | ---: |
| go-strings   |       10 |    10 |   10 |
| go-pipelines |       10 |    10 |   10 |
| mdn          |       10 |    10 |   10 |
| cloudflare   |       10 |    10 |   10 |
| habr-gc      |       10 |    10 |   10 |
| habr-avito   |       10 |    10 |    9 |

## Every measurement

| Article      | Run | HTTP | State |         Elapsed ms | Usable | Media resolved | Error |
| ------------ | --: | ---: | ----- | -----------------: | ------ | -------------- | ----- |
| go-strings   |   1 |  201 | ready |  1906.199951171875 | true   | true           |       |
| go-strings   |   2 |  201 | ready |   1943.89990234375 | true   | true           |       |
| go-strings   |   3 |  201 | ready |  1946.300048828125 | true   | true           |       |
| go-strings   |   4 |  201 | ready |   1948.10009765625 | true   | true           |       |
| go-strings   |   5 |  201 | ready |  1941.199951171875 | true   | true           |       |
| go-strings   |   6 |  201 | ready |   1946.39990234375 | true   | true           |       |
| go-strings   |   7 |  201 | ready |  1945.800048828125 | true   | true           |       |
| go-strings   |   8 |  201 | ready |             1947.5 | true   | true           |       |
| go-strings   |   9 |  201 | ready |  1960.300048828125 | true   | true           |       |
| go-strings   |  10 |  201 | ready |  1939.699951171875 | true   | true           |       |
| go-pipelines |   1 |  201 | ready |             1943.5 | true   | true           |       |
| go-pipelines |   2 |  201 | ready |   1938.10009765625 | true   | true           |       |
| go-pipelines |   3 |  201 | ready |   1945.10009765625 | true   | true           |       |
| go-pipelines |   4 |  201 | ready |  1940.300048828125 | true   | true           |       |
| go-pipelines |   5 |  201 | ready |   1943.39990234375 | true   | true           |       |
| go-pipelines |   6 |  201 | ready |  1941.699951171875 | true   | true           |       |
| go-pipelines |   7 |  201 | ready |  1948.199951171875 | true   | true           |       |
| go-pipelines |   8 |  201 | ready |  1945.800048828125 | true   | true           |       |
| go-pipelines |   9 |  201 | ready |   1941.60009765625 | true   | true           |       |
| go-pipelines |  10 |  201 | ready |  1946.199951171875 | true   | true           |       |
| mdn          |   1 |  201 | ready |  1940.300048828125 | true   | true           |       |
| mdn          |   2 |  201 | ready |               1947 | true   | true           |       |
| mdn          |   3 |  201 | ready |  1947.199951171875 | true   | true           |       |
| mdn          |   4 |  201 | ready |    1948.7001953125 | true   | true           |       |
| mdn          |   5 |  201 | ready |   1943.60009765625 | true   | true           |       |
| mdn          |   6 |  201 | ready |  1944.300048828125 | true   | true           |       |
| mdn          |   7 |  201 | ready |   1941.89990234375 | true   | true           |       |
| mdn          |   8 |  201 | ready |    1946.2998046875 | true   | true           |       |
| mdn          |   9 |  201 | ready |   1941.60009765625 | true   | true           |       |
| mdn          |  10 |  201 | ready |  1943.199951171875 | true   | true           |       |
| cloudflare   |   1 |  201 | ready |   1959.60009765625 | true   | true           |       |
| cloudflare   |   2 |  201 | ready |  1940.599853515625 | true   | true           |       |
| cloudflare   |   3 |  201 | ready |    3940.7998046875 | true   | true           |       |
| cloudflare   |   4 |  201 | ready |  1940.300048828125 | true   | true           |       |
| cloudflare   |   5 |  201 | ready |  1947.699951171875 | true   | true           |       |
| cloudflare   |   6 |  201 | ready |               1941 | true   | true           |       |
| cloudflare   |   7 |  201 | ready |               1948 | true   | true           |       |
| cloudflare   |   8 |  201 | ready |  1949.900146484375 | true   | true           |       |
| cloudflare   |   9 |  201 | ready |   1945.60009765625 | true   | true           |       |
| cloudflare   |  10 |  201 | ready |  1949.599853515625 | true   | true           |       |
| habr-gc      |   1 |  201 | ready |   5944.39990234375 | true   | true           |       |
| habr-gc      |   2 |  201 | ready |  5945.300048828125 | true   | true           |       |
| habr-gc      |   3 |  201 | ready |  3937.699951171875 | true   | true           |       |
| habr-gc      |   4 |  201 | ready |   3939.60009765625 | true   | true           |       |
| habr-gc      |   5 |  201 | ready |  5944.099853515625 | true   | true           |       |
| habr-gc      |   6 |  201 | ready |               5938 | true   | true           |       |
| habr-gc      |   7 |  201 | ready |  5939.599853515625 | true   | true           |       |
| habr-gc      |   8 |  201 | ready |    3942.2998046875 | true   | true           |       |
| habr-gc      |   9 |  201 | ready |  5939.199951171875 | true   | true           |       |
| habr-gc      |  10 |  201 | ready |    5943.7001953125 | true   | true           |       |
| habr-avito   |   1 |  201 | ready |  9946.199951171875 | true   | true           |       |
| habr-avito   |   2 |  201 | ready |            11938.5 | true   | true           |       |
| habr-avito   |   3 |  201 | ready | 11947.800048828125 | true   | true           |       |
| habr-avito   |   4 |  201 | ready | 13945.699951171875 | true   | true           |       |
| habr-avito   |   5 |  201 | ready |  13933.89990234375 | true   | true           |       |
| habr-avito   |   6 |  201 | ready |             7936.5 | true   | true           |       |
| habr-avito   |   7 |  201 | ready |  9938.599853515625 | true   | true           |       |
| habr-avito   |   8 |  201 | ready |              33936 | true   | true           |       |
| habr-avito   |   9 |  201 | ready |   9943.10009765625 | true   | true           |       |
| habr-avito   |  10 |  201 | ready | 11937.900146484375 | true   | true           |       |
