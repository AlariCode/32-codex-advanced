import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("**/api/users/me", (r) =>
    r.fulfill({ json: { id: "owner", email: "owner@example.com" } }),
  );
});

const id = "12345678-1234-4234-8234-123456789abc";
const text = (value: string) => ({ kind: "text", text: value });

test("version two renders native details, safe inline text and independent overflow", async ({
  page,
}) => {
  const code =
    "  const value = '" + "long".repeat(300) + "';\n\treturn value;\n";
  await page.route(`**/api/links/${id}/document`, (route) =>
    route.fulfill({
      json: {
        title: "Formatting",
        submitted_url: "https://example.com/",
        warnings: [],
        generation: 1,
        document: {
          schema_version: 2,
          blocks: [
            {
              kind: "paragraph",
              children: [
                text("Before "),
                { kind: "strong", children: [text("bold")] },
                text(" after "),
                {
                  kind: "link",
                  href: "https://example.com/reference",
                  children: [text("Reference")],
                },
              ],
            },
            {
              kind: "details",
              children: [
                { kind: "summary", children: [text("More")] },
                { kind: "paragraph", children: [text("Hidden text")] },
              ],
            },
            { kind: "code", text: code, language: "javascript" },
            {
              kind: "table",
              children: [
                {
                  kind: "table_body",
                  children: [
                    {
                      kind: "table_row",
                      children: [
                        { kind: "cell", children: [text("wide".repeat(300))] },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      },
    }),
  );
  await page.goto(`/links/${id}`);
  await expect(
    page.locator("article p").filter({ hasText: "Before" }),
  ).toHaveText("Before bold after Reference");
  await expect(
    page.getByText("Hidden text", { exact: true }),
  ).not.toBeVisible();
  await page.getByText("More", { exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText("Hidden text", { exact: true })).toBeVisible();
  await expect(page.locator("pre code")).toHaveText(code);
  expect(await page.locator("pre code").textContent()).toBe(code);
  for (const selector of ["pre", "[aria-label='Таблица статьи']"]) {
    const area = page.locator(selector);
    expect(await area.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(
      true,
    );
    await area.focus();
    await expect(area).toBeFocused();
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    page.viewportSize()!.width,
  );
  await expect(
    page.getByRole("link", { name: "Reference", exact: true }),
  ).toHaveAttribute("rel", "noopener noreferrer");
});

for (const [name, block] of Object.entries({
  active: {
    kind: "paragraph",
    children: [
      { kind: "link", href: "javascript:alert(1)", children: [text("bad")] },
    ],
  },
  props: { kind: "paragraph", onclick: "bad", children: [text("bad")] },
  html: { kind: "iframe", text: "bad" },
  nesting: {
    kind: "table",
    children: [{ kind: "paragraph", children: [text("bad")] }],
  },
})) {
  test(`rejects ${name} without HTML fallback`, async ({ page }) => {
    await page.route(`**/api/links/${id}/document`, (route) =>
      route.fulfill({
        json: {
          title: "Bad archive",
          submitted_url: "https://example.com",
          warnings: [],
          generation: 1,
          document: { schema_version: 2, blocks: [block] },
        },
      }),
    );
    await page.goto(`/links/${id}`);
    await expect(page.getByRole("main").getByRole("alert")).toHaveText(
      "Эта версия статьи не поддерживается.",
    );
    await expect(page.locator("article")).toHaveCount(0);
  });
}
