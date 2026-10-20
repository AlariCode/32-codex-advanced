// Original, deterministic binary corpus; no external downloads in integration tests.
import { readFile } from "node:fs/promises";
const origin = "http://127.0.0.1:39876";
const images = Object.fromEntries(
  await Promise.all(
    ["png", "jpeg", "gif"].map(async (codec) => [
      codec,
      await readFile(
        new URL(
          `../web/tests/fixtures/images/archive.${codec}`,
          import.meta.url,
        ),
      ),
    ]),
  ),
);
const template = await readFile(
  new URL("../web/tests/fixtures/images.html", import.meta.url),
  "utf8",
);
const MiB = 1024 * 1024;
export function imageFixture(request, response) {
  const url = new URL(request.url, origin);
  if (url.pathname.startsWith("/image-bytes/")) {
    const name = url.pathname.split("/").at(-1);
    if (name === "redirect-blocked") {
      response.writeHead(302, { Location: "http://127.0.0.1:39877/forbidden" });
      response.end();
      return true;
    }
    let data = images[name];
    if (name === "large" || name === "padded") {
      data = Buffer.alloc(5 * MiB + (name === "large" ? 1 : 0));
      images.png.copy(data);
    }
    if (name === "invalid") data = Buffer.from("broken image bytes");
    if (name === "unsupported")
      data = Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" onload="window.fixtureAttack=true"/>',
      );
    response.writeHead(data ? 200 : 404, {
      "Content-Type":
        name === "jpeg"
          ? "image/jpeg"
          : name === "gif"
            ? "image/gif"
            : "image/png",
    });
    response.end(data);
    return true;
  }
  if (!url.pathname.startsWith("/images/")) return false;
  const mode = url.pathname.split("/")[2];
  const names = {
    normal: ["png", "jpeg", "gif"],
    single: ["png", "large"],
    total: Array(5).fill("padded"),
    count: Array(51).fill("png"),
    invalid: ["png", "invalid", "unsupported", "redirect-blocked"],
  }[mode];
  if (!names) {
    response.writeHead(404);
    response.end();
    return true;
  }
  const figures = names
    .map(
      (name, index) =>
        `<figure><img src="${origin}/image-bytes/${name}?position=${index}" alt="Archive photo ${index + 1}" onerror="window.fixtureAttack=true"><figcaption>Archive caption ${index + 1}</figcaption></figure>`,
    )
    .join("\n");
  response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  response.end(template.replace("@@IMAGES@@", figures));
  return true;
}
