import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("**/api/users/me", (r) =>
    r.fulfill({ json: { id: "owner", email: "owner@example.com" } }),
  );
});

const id = "12345678-1234-4234-8234-123456789abc";
const asset = "a".repeat(64);
test("reader uses private assets and explains each missing position without source fallback", async ({
  page,
}) => {
  const paths: string[] = [];
  page.on("request", (r) => paths.push(r.url()));
  await page.route(`**/api/links/${id}/document`, (route) =>
    route.fulfill({
      json: {
        title: "Illustrations",
        submitted_url: "https://source.example/article",
        generation: 1,
        warnings: ["images_omitted"],
        document: {
          schema_version: 2,
          blocks: [
            {
              kind: "figure",
              children: [
                { kind: "image", asset_id: asset, alt: "Saved picture" },
                {
                  kind: "figcaption",
                  children: [{ kind: "text", text: "Preserved caption" }],
                },
              ],
            },
            {
              kind: "paragraph",
              children: [
                {
                  kind: "image",
                  alt: "Missing picture",
                  omission: "image_too_large",
                },
              ],
            },
          ],
        },
      },
    }),
  );
  await page.route(`**/api/links/${id}/assets/${asset}`, (route) =>
    route.fulfill({ status: 404 }),
  );
  await page.goto(`/links/${id}`);
  await expect(
    page.getByText("Preserved caption", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("note").filter({ hasText: "размер больше 5 MiB" }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("note")
      .filter({ hasText: "сохранённое изображение недоступно" }),
  ).toBeVisible();
  expect(paths.some((url) => url.startsWith("https://source.example"))).toBe(
    false,
  );
});
test("reader rejects an external asset reference", async ({ page }) => {
  await page.route(`**/api/links/${id}/document`, (route) =>
    route.fulfill({
      json: {
        title: "Unsafe",
        submitted_url: "https://source.example/article",
        generation: 1,
        warnings: [],
        document: {
          schema_version: 2,
          blocks: [
            { kind: "image", asset_id: "https://tracker.example/pixel" },
          ],
        },
      },
    }),
  );
  await page.goto(`/links/${id}`);
  await expect(page.getByRole("main").getByRole("alert")).toHaveText(
    "Эта версия статьи не поддерживается.",
  );
  await expect(page.locator("article img")).toHaveCount(0);
});
