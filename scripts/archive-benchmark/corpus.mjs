// Approved before measurements: docs/research/link-processing/experiments.md.
// Do not add cache-busters or change URLs in response to benchmark results.
export const CORPUS = Object.freeze(
  [
    { id: "go-strings", url: "https://go.dev/blog/strings" },
    { id: "go-pipelines", url: "https://go.dev/blog/pipelines" },
    {
      id: "mdn",
      url: "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Introduction",
    },
    {
      id: "cloudflare",
      url: "https://blog.cloudflare.com/pingora-open-source/",
    },
    { id: "habr-gc", url: "https://habr.com/ru/articles/742402/" },
    {
      id: "habr-avito",
      url: "https://habr.com/ru/companies/avito/articles/753244/",
    },
  ].map(Object.freeze),
);
export const REPETITIONS = 10;
export const TARGET_MS = 15_000;
