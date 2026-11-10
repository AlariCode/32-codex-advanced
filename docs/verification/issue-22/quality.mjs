import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
const { chromium } = await import(
  pathToFileURL(path.resolve("web/node_modules/playwright/index.mjs")).href
);
const dir = process.argv[2];
const previous = process.argv[3];
const sha = (b) => createHash("sha256").update(b).digest("hex");
const norm = (s) => s.replace(/\s+/g, " ").trim();
const flatten = (bs) => bs.flatMap((b) => [b, ...flatten(b.children ?? [])]);
const text = (b) =>
  (b.text ?? "") +
  (b.children ?? [])
    .map(text)
    .join(["list", "table", "table_row", "quote"].includes(b.kind) ? "\n" : "");
const browser = await chromium.launch();
const page = await browser.newPage();
const selectors = {
  "go-strings": "div.Article div.markdown",
  "go-pipelines": "div.Article div.markdown",
  mdn: "main#content",
  cloudflare: ".article-content",
  "habr-gc": ".article-formatted-body",
  "habr-avito": ".article-formatted-body",
};
const results = [],
  details = [],
  media = [];
for (const [article, selector] of Object.entries(selectors)) {
  const html = await fs.readFile(
    path.join(dir, "artifacts", article + "-source.html"),
    "utf8",
  );
  const meta = JSON.parse(
    await fs.readFile(path.join(dir, "artifacts", article + "-source.json")),
  );
  const source = await page.evaluate(
    ({ html, selector, url }) => {
      const doc = new DOMParser().parseFromString(html, "text/html");
      const root = doc.querySelector(selector);
      if (!root) throw Error(selector);
      root
        .querySelectorAll(
          'script,style,nav,aside,form,button,.article-footer,[hidden],[aria-hidden="true"],.copyright,.prev-next,.playground .number,.visually-hidden,[style*="display: none"],[style*="display:none"]',
        )
        .forEach((n) => n.remove());
      const texts = (s) =>
        [...root.querySelectorAll(s)]
          .map((n) => n.textContent)
          .filter((t) => t.trim());
      const images = [...root.querySelectorAll("img")].map((n) => ({
        alt: n.getAttribute("alt"),
        sources: [
          n.getAttribute("src"),
          n.getAttribute("data-src"),
          ...(n.getAttribute("srcset") ?? "")
            .split(",")
            .map((x) => x.trim().split(/\s+/)[0]),
          ...(n.getAttribute("data-srcset") ?? "")
            .split(",")
            .map((x) => x.trim().split(/\s+/)[0]),
        ]
          .filter(Boolean)
          .map((s) => {
            try {
              return new URL(s, url).href;
            } catch {
              return s;
            }
          }),
      }));
      return {
        paragraphs: texts("p"),
        headings: texts("h2,h3,h4,h5,h6"),
        codes: texts("pre"),
        cells: texts("th,td"),
        captions: texts("figcaption"),
        lists: [...root.querySelectorAll("ul,ol")].map((n) =>
          [...n.children].map((li) => li.textContent).join(" "),
        ),
        quotes: texts("blockquote"),
        images,
        fullText: root.textContent,
      };
    },
    { html, selector, url: meta.finalURL ?? meta.url },
  );
  const copies = [];
  for (let i = 1; i <= 10; i++) {
    const archive = JSON.parse(
      await fs.readFile(
        path.join(dir, "artifacts", article + "-" + i + ".json"),
      ),
    );
    const bs = flatten(archive.document.blocks);
    const all = norm(archive.document.blocks.map(text).join("\n"));
    const missing = {};
    for (const k of [
      "paragraphs",
      "headings",
      "cells",
      "captions",
      "lists",
      "quotes",
    ]) {
      let offset = 0;
      missing[k] = [];
      source[k].forEach((v, index) => {
        const at = all.indexOf(norm(v), offset);
        if (at < 0) missing[k].push(index);
        else offset = at + norm(v).length;
      });
    }
    const codes = bs.filter((b) => b.kind === "code").map((b) => b.text);
    let codeOffset = 0;
    missing.codes = [];
    source.codes.forEach((v, index) => {
      const at = codes.indexOf(v, codeOffset);
      if (at < 0) missing.codes.push(index);
      else codeOffset = at + 1;
    });
    const imgs = bs.filter((b) => b.kind === "image");
    copies.push({
      repetition: i,
      missing,
      imagePositions: imgs.length,
      archivedAssets: new Set(imgs.map((b) => b.asset_id).filter(Boolean)).size,
      omissions: imgs.filter((b) => b.omission).map((b) => b.omission),
      warnings: archive.warnings,
    });
    if (i === 1) {
      details.push({
        article,
        source,
        missing,
        archivedText: archive.document.blocks.map(text).join("\n"),
        archivedCodes: codes,
      });
      for (const b of imgs.filter((b) => b.asset_id)) {
        const data = await fs.readFile(path.join(dir, "artifacts", b.asset_id));
        const matches = source.images.flatMap((im, index) =>
          im.sources
            .filter(
              (url) =>
                sha(Buffer.concat([Buffer.from(url + "\x00"), data])) ===
                b.asset_id,
            )
            .map((url) => ({ sourcePosition: index, url })),
        );
        media.push({
          article,
          asset_id: b.asset_id,
          bytes: data.length,
          dataSHA256: sha(data),
          matches,
          alt: b.alt ?? "",
        });
      }
    }
  }
  const kinds = [
    "paragraphs",
    "headings",
    "codes",
    "cells",
    "captions",
    "lists",
    "quotes",
  ];
  let unchanged = null;
  if (previous) {
    unchanged = [];
    for (let i = 1; i <= 10; i++) {
      const before = JSON.parse(
        await fs.readFile(
          path.join(previous, "artifacts", article + "-" + i + ".json"),
        ),
      );
      const after = JSON.parse(
        await fs.readFile(
          path.join(dir, "artifacts", article + "-" + i + ".json"),
        ),
      );
      unchanged.push({
        repetition: i,
        documentEqual:
          JSON.stringify(before.document) === JSON.stringify(after.document),
        warningsEqual:
          JSON.stringify(before.warnings) === JSON.stringify(after.warnings),
      });
    }
  }
  results.push({
    article,
    sourceSelector: selector,
    sourceCounts: Object.fromEntries([
      ...kinds.map((k) => [k, source[k].length]),
      ["images", source.images.length],
    ]),
    copies,
    unchangedFromBaseline: unchanged,
  });
}
await browser.close();
await fs.writeFile(
  path.join(dir, "quality-checks.json"),
  JSON.stringify(results, null, 2),
);
await fs.writeFile(
  path.join(dir, "quality-details.json"),
  JSON.stringify(details, null, 2),
);
await fs.writeFile(
  path.join(dir, "quality-media.json"),
  JSON.stringify(media, null, 2),
);
for (const r of results)
  console.log(
    r.article,
    r.sourceCounts,
    "missing",
    r.copies[0].missing,
    "baselineSame",
    r.unchangedFromBaseline?.every((c) => c.documentEqual && c.warningsEqual),
  );
