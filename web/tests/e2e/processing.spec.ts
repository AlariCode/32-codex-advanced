import { expect, test, type Page } from "@playwright/test";
const id = "11111111-1111-4111-8111-111111111111";
const oldId = "22222222-2222-4222-8222-222222222222";
function card(key = id, generation = 1, state = "processing") {
  return {
    id: key,
    submitted_url: `https://example.com/${key}`,
    title: state === "ready" ? "Saved title" : null,
    state,
    generation,
    reason: null,
    can_read: state === "ready",
    created_at: "2026-10-15T00:00:00Z",
    requested_at: "2026-10-15T00:00:00Z",
    deadline_at: "2026-10-15T00:02:00Z",
  };
}
const pageOf = (links: ReturnType<typeof card>[]) => ({
  links,
  next_cursor: "",
  server_time: "2026-10-15T00:00:00Z",
});
async function base(page: Page) {
  await page.route("**/api/users/me", (r) =>
    r.fulfill({
      json: {
        id: "owner",
        email: "owner@example.com",
        created_at: "2026-10-15T00:00:00Z",
      },
    }),
  );
  await page.route("**/api/links?*", (r) =>
    r.fulfill({ json: pageOf([card()]) }),
  );
}
test("polling discovers active cards outside visible page and terminal stops polling", async ({
  page,
}) => {
  await base(page);
  let ids: string[] = [];
  let terminal = false;
  await page.route("**/api/links/statuses?*", (r) => {
    const requested = new URL(r.request().url()).searchParams.get("ids");
    if (!requested) return r.fulfill({ json: pageOf([card(), card(oldId)]) });
    ids = requested.split(",");
    terminal = true;
    return r.fulfill({
      json: pageOf([card(id, 1, "ready"), card(oldId, 1, "failed")]),
    });
  });
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Читать статью" })).toBeVisible();
  expect(ids.sort()).toEqual([id, oldId].sort());
  expect(terminal).toBe(true);
  let polls = 0;
  page.on("request", (r) => {
    if (r.url().includes("/api/links/statuses")) polls++;
  });
  await page.waitForTimeout(4500);
  expect(polls).toBe(0);
});
test("hidden tab pauses frequent polling and returning online reconciles immediately", async ({
  page,
}) => {
  await base(page);
  let polls = 0;
  await page.route("**/api/links/statuses?*", (r) => {
    polls++;
    return r.fulfill({ json: pageOf([card()]) });
  });
  await page.goto("/");
  await expect(page.getByText("Обрабатываем", { exact: true })).toBeVisible();
  await expect.poll(() => polls).toBeGreaterThan(0);
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  const hidden = polls;
  await page.waitForTimeout(4500);
  expect(polls).toBe(hidden);
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect.poll(() => polls, { timeout: 1500 }).toBeGreaterThan(hidden);
  const restored = polls;
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect.poll(() => polls, { timeout: 1500 }).toBeGreaterThan(restored);
});
test("401 during polling removes all private content", async ({ page }) => {
  await base(page);
  let calls = 0;
  await page.route("**/api/links/statuses?*", (r) =>
    ++calls === 1
      ? r.fulfill({ json: pageOf([card()]) })
      : r.fulfill({ status: 401, json: { code: "unauthorized" } }),
  );
  await page.goto("/");
  await expect(page.getByText("Обрабатываем", { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/login\?returnTo=/);
  await expect(page.getByRole("article")).toHaveCount(0);
  await expect(page.getByText("owner@example.com")).toHaveCount(0);
});
test("late metadata from earlier generation cannot replace current ready card", async ({
  page,
}) => {
  await base(page);
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(`**/api/links/${id}`, async (r) => {
    await pending;
    await r.fulfill({ json: card() });
  });
  await page.route("**/api/links/statuses?*", (r) =>
    r.fulfill({
      json: pageOf([
        new URL(r.request().url()).searchParams.has("ids")
          ? card(id, 2, "ready")
          : card(),
      ]),
    }),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Открыть карточку" }).click();
  await expect(page.getByRole("link", { name: "Читать статью" })).toBeVisible();
  release();
  await expect(page.getByText("Saved title")).toBeVisible();
  await expect(page.getByText("Обрабатываем", { exact: true })).toHaveCount(0);
});
test("reader rejects incompatible document and renders dangerous markup as text", async ({
  page,
}) => {
  await page.route("**/api/users/me", (r) =>
    r.fulfill({ json: { id: "owner", email: "owner@example.com" } }),
  );
  await page.route(`**/api/links/${id}/document`, (r) =>
    r.fulfill({
      json: {
        title: "Safe archive",
        submitted_url: "https://example.com/",
        generation: 1,
        warnings: [],
        document: {
          schema_version: 1,
          blocks: [
            { kind: "paragraph", text: "<script>window.attack=true</script>" },
          ],
        },
      },
    }),
  );
  await page.goto(`/links/${id}`);
  const article = page.getByRole("article", {
    name: "Сохранённая статья",
    exact: true,
  });
  await expect(article).toContainText("<script>window.attack=true</script>");
  expect(await article.locator("script").count()).toBe(0);
  await page.route(`**/api/links/${id}/document`, (r) =>
    r.fulfill({
      json: {
        title: "Unsafe archive",
        submitted_url: "https://example.com/",
        document: {
          schema_version: 99,
          blocks: [{ kind: "script", text: "attack" }],
        },
      },
    }),
  );
  await page.reload();
  await expect(
    page.getByText("Эта версия статьи не поддерживается."),
  ).toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(0);
});
