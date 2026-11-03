import { expect, test, type Page } from "@playwright/test";
const id = "11111111-1111-4111-8111-111111111111";
const card = (state = "ready") => ({
  id,
  submitted_url: "https://example.com/article",
  title: "Archived article",
  state,
  generation: 1,
  reason: "article_unavailable",
  can_read: state === "ready",
  created_at: "2026-10-15T00:00:00Z",
  requested_at: "2026-10-15T00:00:00Z",
  deadline_at: "2026-10-15T00:02:00Z",
});
const pageOf = (links: ReturnType<typeof card>[]) => ({
  links,
  next_cursor: "",
  server_time: "2026-10-15T00:00:00Z",
});
async function setup(page: Page, state = "ready") {
  await page.route("**/api/users/me", (r) =>
    r.fulfill({ json: { id: "owner", email: "owner@example.com" } }),
  );
  await page.route("**/api/links?*", (r) =>
    r.fulfill({ json: pageOf([card(state)]) }),
  );
  await page.route("**/api/links/statuses?*", (r) =>
    r.fulfill({ json: pageOf([]) }),
  );
}
async function confirm(page: Page, repeat = false) {
  await page
    .getByRole("button", {
      name: repeat ? "Повторить удаление" : "Удалить",
      exact: true,
    })
    .click();
  await page
    .getByRole("button", { name: "Удалить навсегда", exact: true })
    .click();
}
for (const state of ["processing", "ready", "unavailable", "failed"]) {
  test(`${state}: cancel then confirm keeps card pending and prevents double DELETE`, async ({
    page,
  }) => {
    await setup(page, state);
    let calls = 0,
      finish = () => {};
    await page.route(`**/api/links/${id}`, async (r) => {
      calls++;
      await new Promise<void>((resolve) => (finish = resolve));
      await r.fulfill({ status: 204 });
    });
    await page.goto("/");
    const remove = page.getByRole("button", { name: "Удалить", exact: true });
    await remove.click();
    await expect(
      page.getByRole("button", { name: "Отмена", exact: true }),
    ).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(remove).toBeFocused();
    expect(calls).toBe(0);
    await remove.click();
    await page.getByRole("button", { name: "Отмена", exact: true }).click();
    expect(calls).toBe(0);
    await confirm(page);
    await expect(page.getByRole("article")).toHaveCount(1);
    const pending = page.getByRole("button", { name: "Удаляем…", exact: true });
    await expect(pending).toBeDisabled();
    await pending.evaluate((button) => (button as HTMLButtonElement).click());
    expect(calls).toBe(1);
    finish();
    await expect(page.getByRole("article")).toHaveCount(0);
    await expect(
      page.getByLabel("Ссылка на статью", { exact: true }),
    ).toBeFocused();
    await expect(
      page.getByText("Ссылка и сохранённая статья удалены", { exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBe(page.viewportSize()!.width);
  });
}
test("error before commit retains card and permits confirmed retry", async ({
  page,
}) => {
  await setup(page);
  let calls = 0;
  await page.route(`**/api/links/${id}`, (r) => {
    calls++;
    return r.fulfill(
      calls === 1
        ? { status: 500, json: { code: "internal_error" } }
        : { status: 204 },
    );
  });
  await page.goto("/");
  await confirm(page);
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "Не удалось подтвердить удаление",
  );
  await expect(page.getByRole("article")).toHaveCount(1);
  await confirm(page, true);
  await expect(page.getByRole("article")).toHaveCount(0);
  expect(calls).toBe(2);
});
for (const outcome of ["lost", "404"]) {
  test(`${outcome}: only fresh metadata 404 verifies deletion`, async ({
    page,
  }) => {
    await setup(page);
    let verified = false;
    await page.route(`**/api/links/${id}`, (r) => {
      if (r.request().method() === "DELETE")
        return outcome === "lost"
          ? r.abort()
          : r.fulfill({ status: 404, json: { code: "not_found" } });
      verified = true;
      return r.fulfill({
        status: 404,
        json: { code: "not_found" },
        headers: { "Cache-Control": "no-store" },
      });
    });
    await page.goto("/");
    await page.evaluate(() => {
      const original = window.fetch;
      window.fetch = (input, init) => {
        if (
          typeof input === "string" &&
          /\/api\/links\/[^/]+$/.test(input) &&
          init?.method === "GET"
        )
          sessionStorage.setItem("verification-cache", init?.cache ?? "");
        return original(input, init);
      };
    });
    await confirm(page);
    await expect(page.getByRole("article")).toHaveCount(0);
    expect(verified).toBe(true);
    expect(
      await page.evaluate(() => sessionStorage.getItem("verification-cache")),
    ).toBe("no-store");
  });
}
for (const verification of [200, 500, 401]) {
  test(`DELETE 404 with verification ${verification} does not silently remove card`, async ({
    page,
  }) => {
    await setup(page);
    await page.route(`**/api/links/${id}`, (r) =>
      r.fulfill(
        r.request().method() === "DELETE"
          ? { status: 404, json: { code: "not_found" } }
          : {
              status: verification,
              json:
                verification === 200
                  ? card()
                  : {
                      code:
                        verification === 401
                          ? "unauthorized"
                          : "internal_error",
                    },
            },
      ),
    );
    await page.goto("/");
    await confirm(page);
    if (verification === 401) {
      await expect(page).toHaveURL(/\/login\?returnTo=%2F$/);
      await expect(page.getByRole("article")).toHaveCount(0);
    } else {
      await expect(page.getByRole("main").getByRole("alert")).toContainText(
        "Не удалось подтвердить удаление",
      );
      await expect(page.getByRole("article")).toHaveCount(1);
    }
  });
}
for (const source of ["list", "status", "retry", "duplicate"]) {
  test(`late ${source} response cannot resurrect deleted ID`, async ({
    page,
  }) => {
    await setup(page, source === "status" ? "processing" : "failed");
    let began = () => {},
      release = () => {};
    const started = new Promise<void>((resolve) => (began = resolve));
    const held = new Promise<void>((resolve) => (release = resolve));
    let listCalls = 0,
      pollCalls = 0,
      deleted = false;
    if (source === "list")
      await page.route("**/api/links?*", async (r) => {
        if (++listCalls === 1)
          return r.fulfill({ json: pageOf([card("failed")]) });
        began();
        await held;
        return r.fulfill({ json: pageOf([card()]) });
      });
    if (source === "status")
      await page.route("**/api/links/statuses?*", async (r) => {
        const ids = new URL(r.request().url()).searchParams.get("ids");
        if (!ids)
          return r.fulfill({
            json: pageOf(deleted ? [] : [card("processing")]),
          });
        pollCalls++;
        began();
        await held;
        return r.fulfill({ json: pageOf([card()]) });
      });
    if (source === "retry")
      await page.route(`**/api/links/${id}/retry`, async (r) => {
        began();
        await held;
        return r.fulfill({
          json: { link: card(), server_time: pageOf([]).server_time },
        });
      });
    if (source === "duplicate")
      await page.route("**/api/links", async (r) => {
        began();
        await held;
        return r.fulfill({
          json: {
            link: card(),
            created: false,
            server_time: pageOf([]).server_time,
          },
        });
      });
    await page.route(`**/api/links/${id}`, (r) => {
      deleted = true;
      return r.fulfill({ status: 204 });
    });
    await page.goto("/");
    await expect(page.getByRole("article")).toHaveCount(1);
    if (source === "list")
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    if (source === "retry")
      await page
        .getByRole("button", { name: "Повторить", exact: true })
        .click();
    if (source === "duplicate") {
      await page
        .getByLabel("Ссылка на статью", { exact: true })
        .fill(card().submitted_url);
      await page
        .getByRole("button", { name: "Сохранить ссылку", exact: true })
        .click();
    }
    await started;
    await confirm(page);
    await expect(page.locator(`#link-${id}`)).toHaveCount(0);
    release();
    await expect(
      page.getByText("Здесь будут ваши ссылки", { exact: true }),
    ).toBeVisible();
    await page.waitForTimeout(source === "status" ? 2300 : 150);
    await expect(page.getByRole("article")).toHaveCount(0);
    if (source === "status") expect(pollCalls).toBe(1);
  });
}
test("DELETE 401 clears private UI and preserves safe login returnTo", async ({
  page,
}) => {
  await setup(page);
  await page.route(`**/api/links/${id}`, (r) =>
    r.fulfill({ status: 401, json: { code: "unauthorized" } }),
  );
  await page.goto("/");
  await confirm(page);
  await expect(page).toHaveURL(/\/login\?returnTo=%2F$/);
  await expect(page.getByRole("article")).toHaveCount(0);
});
