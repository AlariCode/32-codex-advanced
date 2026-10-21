import { readFile } from "node:fs/promises";
const fixtures = Object.fromEntries(
  await Promise.all(
    ["homepage", "video", "login", "paywall", "js-only"].map(async (name) => [
      name,
      await readFile(
        new URL(`../web/tests/fixtures/${name}.html`, import.meta.url),
      ),
    ]),
  ),
);
const article = await readFile(
  new URL("../web/tests/fixtures/article.html", import.meta.url),
);
const corrected = new Set();
export function articleFixture(request, response) {
  const url = new URL(request.url, "http://fixture");
  if (!url.pathname.startsWith("/article-case/")) return false;
  const [, , name, id] = url.pathname.split("/");
  const key = `${name}/${id}`;
  if (request.method === "POST" && url.searchParams.has("correct")) {
    corrected.add(key);
    response.end("corrected");
    return true;
  }
  if (corrected.has(key)) {
    response.writeHead(200, { "Content-Type": "text/html" });
    response.end(article);
    return true;
  }
  if (name === "network") {
    request.socket.destroy();
    return true;
  }
  if (name === "pdf") {
    response.writeHead(200, { "Content-Type": "application/pdf" });
    response.end("%PDF-1.7");
    return true;
  }
  const body = fixtures[name];
  response.writeHead(body ? 200 : 404, { "Content-Type": "text/html" });
  response.end(body);
  return true;
}
