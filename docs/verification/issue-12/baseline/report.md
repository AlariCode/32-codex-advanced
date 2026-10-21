# Live archive benchmark

Date: 2026-10-21T08:27:53.905Z. Sequential saves; fixed six-article corpus; ten independent accounts per article.

Ready within 15 seconds: **48/60**, required **54/60**. Target **NOT MET**. Confirmed new saves: 60/60; valid ready: 59/60; recorded: 60/60.

Timing: server requested_at (transaction timestamp immediately before commit), confirmed by HTTP 201/created=true, to first browser DOM ready observation. API and browser share the launcher host; the PostgreSQL VM clock is assumed synchronized. Queue, network/media, processing, commit and normal UI polling are included. Document/asset validation follows observation and determines eligibility, without adding validation time to the measurement. Quality review is separate and is never inferred from counts.

Conditional valid-ready p50/p90: 2094.800048828125/25964.10009765625 ms. Failures and missing samples remain in the denominator 60. Partial media must have explicit omission reasons/warnings.

Environment and raw evidence: report.json, runs.jsonl, environment.json. Account credentials/cookies are not recorded. Source HTML and archived documents for manual review are local artifacts, not part of the committed report.

| Article      | Recorded | Ready | ≤15s |
| ------------ | -------: | ----: | ---: |
| go-strings   |       10 |    10 |   10 |
| go-pipelines |       10 |    10 |   10 |
| mdn          |       10 |    10 |   10 |
| cloudflare   |       10 |    10 |   10 |
| habr-gc      |       10 |    10 |    8 |
| habr-avito   |       10 |     9 |    0 |

## Every measurement

| Article      | Run | HTTP | State  |         Elapsed ms | Usable | Media resolved | Error |
| ------------ | --: | ---: | ------ | -----------------: | ------ | -------------- | ----- |
| go-strings   |   1 |  201 | ready  |  1793.599853515625 | true   | true           |       |
| go-strings   |   2 |  201 | ready  |    1925.7001953125 | true   | true           |       |
| go-strings   |   3 |  201 | ready  |  1934.900146484375 | true   | true           |       |
| go-strings   |   4 |  201 | ready  |  1942.099853515625 | true   | true           |       |
| go-strings   |   5 |  201 | ready  |  1925.699951171875 | true   | true           |       |
| go-strings   |   6 |  201 | ready  |  1913.300048828125 | true   | true           |       |
| go-strings   |   7 |  201 | ready  |  1927.699951171875 | true   | true           |       |
| go-strings   |   8 |  201 | ready  |  1918.199951171875 | true   | true           |       |
| go-strings   |   9 |  201 | ready  |  1909.199951171875 | true   | true           |       |
| go-strings   |  10 |  201 | ready  |  1933.199951171875 | true   | true           |       |
| go-pipelines |   1 |  201 | ready  |  1924.800048828125 | true   | true           |       |
| go-pipelines |   2 |  201 | ready  |             1929.5 | true   | true           |       |
| go-pipelines |   3 |  201 | ready  |             1941.5 | true   | true           |       |
| go-pipelines |   4 |  201 | ready  |  2094.800048828125 | true   | true           |       |
| go-pipelines |   5 |  201 | ready  |   1839.89990234375 | true   | true           |       |
| go-pipelines |   6 |  201 | ready  |  1908.300048828125 | true   | true           |       |
| go-pipelines |   7 |  201 | ready  |   1935.39990234375 | true   | true           |       |
| go-pipelines |   8 |  201 | ready  |             1957.5 | true   | true           |       |
| go-pipelines |   9 |  201 | ready  |  1963.300048828125 | true   | true           |       |
| go-pipelines |  10 |  201 | ready  |  1830.400146484375 | true   | true           |       |
| mdn          |   1 |  201 | ready  |             1889.5 | true   | true           |       |
| mdn          |   2 |  201 | ready  |               1956 | true   | true           |       |
| mdn          |   3 |  201 | ready  |  1903.900146484375 | true   | true           |       |
| mdn          |   4 |  201 | ready  |             1788.5 | true   | true           |       |
| mdn          |   5 |  201 | ready  |               1960 | true   | true           |       |
| mdn          |   6 |  201 | ready  |  1949.800048828125 | true   | true           |       |
| mdn          |   7 |  201 | ready  |  1928.800048828125 | true   | true           |       |
| mdn          |   8 |  201 | ready  |  1928.300048828125 | true   | true           |       |
| mdn          |   9 |  201 | ready  |               1913 | true   | true           |       |
| mdn          |  10 |  201 | ready  |  1924.900146484375 | true   | true           |       |
| cloudflare   |   1 |  201 | ready  |   9934.60009765625 | true   | true           |       |
| cloudflare   |   2 |  201 | ready  |  7913.900146484375 | true   | true           |       |
| cloudflare   |   3 |  201 | ready  |               7931 | true   | true           |       |
| cloudflare   |   4 |  201 | ready  |   7929.89990234375 | true   | true           |       |
| cloudflare   |   5 |  201 | ready  |  9627.300048828125 | true   | true           |       |
| cloudflare   |   6 |  201 | ready  |  7930.599853515625 | true   | true           |       |
| cloudflare   |   7 |  201 | ready  |  7927.400146484375 | true   | true           |       |
| cloudflare   |   8 |  201 | ready  |               7902 | true   | true           |       |
| cloudflare   |   9 |  201 | ready  |    7928.2001953125 | true   | true           |       |
| cloudflare   |  10 |  201 | ready  |  7922.800048828125 | true   | true           |       |
| habr-gc      |   1 |  201 | ready  | 31919.300048828125 | true   | true           |       |
| habr-gc      |   2 |  201 | ready  |  9932.900146484375 | true   | true           |       |
| habr-gc      |   3 |  201 | ready  |            11927.5 | true   | true           |       |
| habr-gc      |   4 |  201 | ready  |  11990.89990234375 | true   | true           |       |
| habr-gc      |   5 |  201 | ready  | 11643.199951171875 | true   | true           |       |
| habr-gc      |   6 |  201 | ready  | 11957.300048828125 | true   | true           |       |
| habr-gc      |   7 |  201 | ready  |  11892.10009765625 | true   | true           |       |
| habr-gc      |   8 |  201 | ready  | 17934.099853515625 | true   | true           |       |
| habr-gc      |   9 |  201 | ready  | 11833.300048828125 | true   | true           |       |
| habr-gc      |  10 |  201 | ready  |   9814.89990234375 | true   | true           |       |
| habr-avito   |   1 |  201 | ready  | 25909.699951171875 | true   | true           |       |
| habr-avito   |   2 |  201 | ready  |              27788 | true   | true           |       |
| habr-avito   |   3 |  201 | ready  |            23906.5 | true   | true           |       |
| habr-avito   |   4 |  201 | ready  |  25964.10009765625 | true   | true           |       |
| habr-avito   |   5 |  201 | ready  | 31847.400146484375 | true   | true           |       |
| habr-avito   |   6 |  201 | ready  | 25920.699951171875 | true   | true           |       |
| habr-avito   |   7 |  201 | ready  |            26478.5 | true   | true           |       |
| habr-avito   |   8 |  201 | failed |           120443.5 | false  | false          |       |
| habr-avito   |   9 |  201 | ready  |            31893.5 | true   | true           |       |
| habr-avito   |  10 |  201 | ready  |  21917.60009765625 | true   | true           |       |
