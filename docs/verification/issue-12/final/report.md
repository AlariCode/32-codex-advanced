# Live archive benchmark

Date: 2026-10-21T08:41:07.912Z. Sequential saves; fixed six-article corpus; ten independent accounts per article.

Ready within 15 seconds: **49/60**, required **54/60**. Target **NOT MET**. Confirmed new saves: 60/60; valid ready: 60/60; recorded: 60/60.

Timing: server requested_at (transaction timestamp immediately before commit), confirmed by HTTP 201/created=true, to first browser DOM ready observation. API and browser share the launcher host; the PostgreSQL VM clock is assumed synchronized. Queue, network/media, processing, commit and normal UI polling are included. Document/asset validation follows observation and determines eligibility, without adding validation time to the measurement. Quality review is separate and is never inferred from counts.

Conditional valid-ready p50/p90: 4000.099853515625/25924.39990234375 ms. Failures and missing samples remain in the denominator 60. Partial media must have explicit omission reasons/warnings.

Environment and raw evidence: report.json, runs.jsonl, environment.json. Account credentials/cookies are not recorded. Source HTML and archived documents for manual review are local artifacts, not part of the committed report.

| Article      | Recorded | Ready | ≤15s |
| ------------ | -------: | ----: | ---: |
| go-strings   |       10 |    10 |   10 |
| go-pipelines |       10 |    10 |   10 |
| mdn          |       10 |    10 |   10 |
| cloudflare   |       10 |    10 |   10 |
| habr-gc      |       10 |    10 |    9 |
| habr-avito   |       10 |    10 |    0 |

## Every measurement

| Article      | Run | HTTP | State |         Elapsed ms | Usable | Media resolved | Error |
| ------------ | --: | ---: | ----- | -----------------: | ------ | -------------- | ----- |
| go-strings   |   1 |  201 | ready |  4000.099853515625 | true   | true           |       |
| go-strings   |   2 |  201 | ready |   2270.89990234375 | true   | true           |       |
| go-strings   |   3 |  201 | ready |    1544.2998046875 | true   | true           |       |
| go-strings   |   4 |  201 | ready |  1797.199951171875 | true   | true           |       |
| go-strings   |   5 |  201 | ready |  1984.400146484375 | true   | true           |       |
| go-strings   |   6 |  201 | ready |  1912.800048828125 | true   | true           |       |
| go-strings   |   7 |  201 | ready |   2067.89990234375 | true   | true           |       |
| go-strings   |   8 |  201 | ready |   1928.89990234375 | true   | true           |       |
| go-strings   |   9 |  201 | ready |  1907.400146484375 | true   | true           |       |
| go-strings   |  10 |  201 | ready |  1922.400146484375 | true   | true           |       |
| go-pipelines |   1 |  201 | ready |  2024.699951171875 | true   | true           |       |
| go-pipelines |   2 |  201 | ready |   1869.60009765625 | true   | true           |       |
| go-pipelines |   3 |  201 | ready |  1963.099853515625 | true   | true           |       |
| go-pipelines |   4 |  201 | ready |  1926.199951171875 | true   | true           |       |
| go-pipelines |   5 |  201 | ready |  1908.900146484375 | true   | true           |       |
| go-pipelines |   6 |  201 | ready |  1921.199951171875 | true   | true           |       |
| go-pipelines |   7 |  201 | ready |   1899.10009765625 | true   | true           |       |
| go-pipelines |   8 |  201 | ready |  1920.800048828125 | true   | true           |       |
| go-pipelines |   9 |  201 | ready |               1930 | true   | true           |       |
| go-pipelines |  10 |  201 | ready |  1929.699951171875 | true   | true           |       |
| mdn          |   1 |  201 | ready |               1926 | true   | true           |       |
| mdn          |   2 |  201 | ready |  1919.300048828125 | true   | true           |       |
| mdn          |   3 |  201 | ready |             1880.5 | true   | true           |       |
| mdn          |   4 |  201 | ready |  1930.900146484375 | true   | true           |       |
| mdn          |   5 |  201 | ready |  1884.699951171875 | true   | true           |       |
| mdn          |   6 |  201 | ready |   1943.10009765625 | true   | true           |       |
| mdn          |   7 |  201 | ready |  1854.300048828125 | true   | true           |       |
| mdn          |   8 |  201 | ready |   1799.60009765625 | true   | true           |       |
| mdn          |   9 |  201 | ready |  1958.699951171875 | true   | true           |       |
| mdn          |  10 |  201 | ready |    3881.2001953125 | true   | true           |       |
| cloudflare   |   1 |  201 | ready |  9269.300048828125 | true   | true           |       |
| cloudflare   |   2 |  201 | ready |  9684.199951171875 | true   | true           |       |
| cloudflare   |   3 |  201 | ready |  9600.400146484375 | true   | true           |       |
| cloudflare   |   4 |  201 | ready |  7743.300048828125 | true   | true           |       |
| cloudflare   |   5 |  201 | ready |  7903.199951171875 | true   | true           |       |
| cloudflare   |   6 |  201 | ready |   7932.60009765625 | true   | true           |       |
| cloudflare   |   7 |  201 | ready |             8116.5 | true   | true           |       |
| cloudflare   |   8 |  201 | ready |               7896 | true   | true           |       |
| cloudflare   |   9 |  201 | ready |    7904.7998046875 | true   | true           |       |
| cloudflare   |  10 |  201 | ready |             7935.5 | true   | true           |       |
| habr-gc      |   1 |  201 | ready | 13929.900146484375 | true   | true           |       |
| habr-gc      |   2 |  201 | ready |  9921.300048828125 | true   | true           |       |
| habr-gc      |   3 |  201 | ready |  9918.300048828125 | true   | true           |       |
| habr-gc      |   4 |  201 | ready |   9841.39990234375 | true   | true           |       |
| habr-gc      |   5 |  201 | ready | 11881.699951171875 | true   | true           |       |
| habr-gc      |   6 |  201 | ready | 11913.099853515625 | true   | true           |       |
| habr-gc      |   7 |  201 | ready |               9920 | true   | true           |       |
| habr-gc      |   8 |  201 | ready | 11879.400146484375 | true   | true           |       |
| habr-gc      |   9 |  201 | ready |            17931.5 | true   | true           |       |
| habr-gc      |  10 |  201 | ready |              11855 | true   | true           |       |
| habr-avito   |   1 |  201 | ready |  31912.10009765625 | true   | true           |       |
| habr-avito   |   2 |  201 | ready |  27887.89990234375 | true   | true           |       |
| habr-avito   |   3 |  201 | ready |  25924.39990234375 | true   | true           |       |
| habr-avito   |   4 |  201 | ready |  23941.39990234375 | true   | true           |       |
| habr-avito   |   5 |  201 | ready |  25919.10009765625 | true   | true           |       |
| habr-avito   |   6 |  201 | ready | 29893.699951171875 | true   | true           |       |
| habr-avito   |   7 |  201 | ready | 29911.300048828125 | true   | true           |       |
| habr-avito   |   8 |  201 | ready |   21918.2998046875 | true   | true           |       |
| habr-avito   |   9 |  201 | ready |   27946.7998046875 | true   | true           |       |
| habr-avito   |  10 |  201 | ready |  31890.10009765625 | true   | true           |       |
