import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
const { chromium } = await import(
  pathToFileURL(path.resolve("web/node_modules/playwright/index.mjs")).href
);
// Run from repository root after quality.mjs. This supplements manual review.
const resultDir = process.argv[2];
if (!resultDir)
  throw Error(
    "Usage: node docs/verification/issue-23/inline-quality.mjs RESULT_DIR",
  );
const dir = path.resolve(resultDir, "artifacts");
const selectors = {
  "go-strings": "div.Article div.markdown",
  "go-pipelines": "div.Article div.markdown",
  mdn: "main#content",
  cloudflare: ".article-content",
  "habr-gc": ".article-formatted-body",
  "habr-avito": ".article-formatted-body",
};
const browser = await chromium.launch();
const page = await browser.newPage();
const results = [];
const raw = [];
const norm = (s) => s.replace(/\s+/g, " ").trim();
const text = (b) => (b.text ?? "") + (b.children ?? []).map(text).join("");
const flatten = (bs) => bs.flatMap((b) => [b, ...flatten(b.children ?? [])]);
for (const [article, selector] of Object.entries(selectors)) {
  const html = await fs.readFile(`${dir}/${article}-source.html`, "utf8");
  const meta = JSON.parse(await fs.readFile(`${dir}/${article}-source.json`));
  const source = await page.evaluate(
    ({ html, selector, url }) => {
      const root = new DOMParser()
        .parseFromString(html, "text/html")
        .querySelector(selector);
      root
        .querySelectorAll(
          'script,style,nav,aside,form,button,.article-footer,[hidden],[aria-hidden="true"],.copyright,.prev-next,.playground .number,.visually-hidden,[style*="display: none"],[style*="display:none"]',
        )
        .forEach((n) => n.remove());
      return Object.fromEntries(
        Object.entries({
          strong: "strong,b",
          em: "em,i",
          inline_code: "code:not(pre code)",
          link: "a[href]",
        }).map(([kind, sel]) => [
          kind,
          [...root.querySelectorAll(sel)]
            .filter((n) => n.textContent.trim())
            .map((n) => ({
              text: n.textContent,
              href:
                kind === "link"
                  ? new URL(n.getAttribute("href"), url).href
                  : undefined,
            })),
        ]),
      );
    },
    { html, selector, url: meta.finalURL ?? meta.url },
  );
  const doc = JSON.parse(await fs.readFile(`${dir}/${article}-1.json`));
  const blocks = flatten(doc.document.blocks);
  const kinds = {};
  for (const kind of ["strong", "em", "inline_code", "link"]) {
    const saved = blocks
      .filter((b) => b.kind === kind)
      .map((b) => ({ text: norm(text(b)), href: b.href }));
    const missing = [];
    let offset = 0;
    source[kind].forEach((item, index) => {
      const label = norm(item.text);
      const at = saved.findIndex(
        (b, i) =>
          i >= offset &&
          b.text === label &&
          (kind !== "link" || b.href === item.href),
      );
      if (at < 0) missing.push(index);
      else offset = at + 1;
    });
    kinds[kind] = {
      source: source[kind].length,
      archived: saved.length,
      missingSourceIndexes: missing,
    };
    raw.push({ article, kind, missing: missing.map((i) => source[kind][i]) });
  }
  results.push({
    article,
    kinds,
    scope:
      "First copy, all 10 documents for this source independently verified identical; same source-main-body filter as issue-22/quality.mjs.",
  });
}
await browser.close();
await fs.writeFile(
  path.resolve(resultDir, "inline-quality.json"),
  JSON.stringify(results, null, 2) + "\n",
);
await fs.writeFile(
  path.resolve(resultDir, "inline-quality-details.json"),
  JSON.stringify(raw, null, 2),
);
console.log(results);
