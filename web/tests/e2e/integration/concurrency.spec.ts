import {
  expect,
  test,
  type Page,
  type APIRequestContext,
} from "@playwright/test";

const fixture = "http://127.0.0.1:39876";
const control = "http://127.0.0.1:39877";
async function command(request: APIRequestContext, path: string) {
  expect((await request.post(control + path)).ok()).toBeTruthy();
}
async function stats(request: APIRequestContext, id: string) {
  const response = await request.get(`${control}/link/stats?id=${id}`);
  expect(response.ok()).toBeTruthy();
  return response.json();
}
async function login(page: Page) {
  const email = `concurrency-${crypto.randomUUID()}@example.com`;
  expect(
    (
      await page.request.post("/api/users/register", {
        data: { email, password: "ReliableArchive42!" },
      })
    ).status(),
  ).toBe(201);
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Пароль", { exact: true }).fill("ReliableArchive42!");
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
}
async function save(page: Page, url: string) {
  await page.getByLabel("Ссылка на статью", { exact: true }).fill(url);
  const response = page.waitForResponse(
    (r) => r.request().method() === "POST" && r.url().endsWith("/api/links"),
  );
  await page
    .getByRole("button", { name: "Сохранить ссылку", exact: true })
    .click();
  const { link } = await (await response).json();
  return {
    link,
    card: page.getByRole("article", {
      name: `Сохранённая ссылка ${url}`,
      exact: true,
    }),
  };
}
async function remove(page: Page) {
  await page.getByRole("button", { name: "Удалить", exact: true }).click();
  await page
    .getByRole("button", { name: "Удалить навсегда", exact: true })
    .click();
}
async function entered(request: APIRequestContext, key: string) {
  await expect
    .poll(
      async () =>
        (await (await request.get(control + "/stats")).json()).barriers[key]
          ?.hits ?? 0,
    )
    .toBe(1);
}
async function metadata(page: Page, id: string) {
  return page.evaluate(async (id) => {
    const response = await fetch(`/api/links/${id}`, { cache: "no-store" });
    return { status: response.status, body: await response.json() };
  }, id);
}

test.beforeEach(async ({ request }) => {
  await command(request, "/worker2/off");
  await command(request, "/worker/on");
});
test.afterEach(async ({ request }) => {
  await command(request, "/worker2/off");
  await command(request, "/worker/resume");
  await command(request, "/publication/release");
  await command(request, "/api/on");
  await command(request, "/worker/on");
});

for (const stage of ["html", "media"]) {
  test(`delete during ${stage}; a second worker saves the same URL without resurrecting the stopped execution`, async ({
    page,
    request,
  }) => {
    await login(page);
    const key = `/barrier/${stage}/${crypto.randomUUID()}`;
    const url =
      fixture + (stage === "media" ? key.replace("/media/", "/article/") : key);
    const old = await save(page, url);
    await entered(request, key);
    // Stop the executor so neither context cancellation nor heartbeat can be
    // relied on. The response can finish while its execution is obsolete.
    await command(request, "/worker/pause");
    await remove(page);
    await expect(old.card).toHaveCount(0);
    const replacement = await save(page, url);
    expect(replacement.link.id).not.toBe(old.link.id);
    await command(request, `/barrier/release?key=${encodeURIComponent(key)}`);
    await command(request, "/worker2/on");
    await expect(
      replacement.card.getByRole("link", { name: "Читать статью" }),
    ).toBeVisible({ timeout: 20_000 });
    await command(request, "/worker/resume");
    // Drain the old worker through a new HTML barrier. Reaching it proves the
    // obsolete process returned from publication before asserting absence.
    const drained = `/barrier/html/${crypto.randomUUID()}`;
    await command(request, "/worker2/off");
    await save(page, fixture + drained);
    await entered(request, drained);
    expect(await stats(request, old.link.id)).toMatchObject({
      state: "missing",
      jobs: 0,
      snapshots: 0,
      assets: 0,
    });
    expect(await stats(request, replacement.link.id)).toMatchObject({
      state: "ready",
      jobs: 1,
      executions: 1,
      snapshots: 1,
      assets: stage === "media" ? 1 : 0,
    });
    expect((await metadata(page, old.link.id)).status).toBe(404);
    for (const suffix of ["/document", "/assets/" + "a".repeat(64)]) {
      expect(
        (await page.request.get(`/api/links/${old.link.id}${suffix}`)).status(),
      ).toBe(404);
    }
    await command(
      request,
      `/barrier/release?key=${encodeURIComponent(drained)}`,
    );
  });
}

test("SIGKILL during deferred COMMIT leaves one atomic archive and preserves the deadline", async ({
  page,
  request,
}) => {
  test.setTimeout(75_000);
  await login(page);
  await command(request, "/worker/off");
  const { card, link } = await save(
    page,
    `${fixture}/images/normal/${crypto.randomUUID()}`,
  );
  await command(request, `/publication/hold?id=${link.id}`);
  await command(request, "/worker/on");
  await expect
    .poll(async () => (await stats(request, link.id)).publicationBlocked)
    .toBe(true);
  expect(await stats(request, link.id)).toMatchObject({
    state: "processing",
    jobs: 1,
    executions: 1,
    snapshots: 0,
    assets: 0,
  });
  await command(request, "/worker/off");
  await command(request, "/publication/release");
  await expect
    .poll(async () => (await stats(request, link.id)).publicationBlocked)
    .toBe(false);
  // A disconnected COMMIT has an unknown outcome: PostgreSQL may already
  // commit before observing the dead client. Both outcomes must be atomic;
  // a rollback is recovered by the original lease, a commit is never repeated.
  const interrupted = await stats(request, link.id);
  expect([
    { state: "processing", snapshots: 0, assets: 0 },
    { state: "ready", snapshots: 1, assets: 3 },
  ]).toContainEqual({
    state: interrupted.state,
    snapshots: interrupted.snapshots,
    assets: interrupted.assets,
  });
  await command(request, "/worker/on");
  await command(request, "/worker2/on");
  await expect(card.getByRole("link", { name: "Читать статью" })).toBeVisible({
    timeout: 60_000,
  });
  expect(await stats(request, link.id)).toMatchObject({
    state: "ready",
    jobs: 1,
    snapshots: 1,
    assets: 3,
  });
  expect([1, 2]).toContain((await stats(request, link.id)).executions);
  expect((await metadata(page, link.id)).body.deadline_at).toBe(
    link.deadline_at,
  );
});

test("SIGKILL after confirmed COMMIT keeps one complete archive and DELETE removes it", async ({
  page,
  request,
}) => {
  await login(page);
  const { card, link } = await save(
    page,
    `${fixture}/images/normal/${crypto.randomUUID()}`,
  );
  await expect(card.getByRole("link", { name: "Читать статью" })).toBeVisible({
    timeout: 20_000,
  });
  await command(request, "/worker/off");
  await command(request, "/worker/on");
  await command(request, "/worker2/on");
  expect(await stats(request, link.id)).toMatchObject({
    state: "ready",
    executions: 1,
    snapshots: 1,
    assets: 3,
  });
  await remove(page);
  await expect(card).toHaveCount(0);
  expect(await stats(request, link.id)).toMatchObject({
    state: "missing",
    jobs: 0,
    snapshots: 0,
    assets: 0,
  });
});

test("retry from a second tab races DELETE without reviving the card", async ({
  page,
  context,
  request,
}) => {
  await login(page);
  const { card, link } = await save(
    page,
    `${fixture}/unreachable/${crypto.randomUUID()}`,
  );
  await expect(
    card.getByRole("button", { name: "Повторить", exact: true }),
  ).toBeVisible({ timeout: 20_000 });
  const second = await context.newPage();
  await second.goto("/");
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let arrived!: () => void;
  const waiting = new Promise<void>((resolve) => {
    arrived = resolve;
  });
  await second.route(`**/api/links/${link.id}/retry`, async (route) => {
    arrived();
    await gate;
    await route.continue();
  });
  await second.getByRole("button", { name: "Повторить", exact: true }).click();
  await waiting;
  const retried = second.waitForResponse((r) =>
    r.url().endsWith(`/api/links/${link.id}/retry`),
  );
  // Both HTTP operations are released together; SQL serialization decides order.
  release();
  await remove(page);
  expect([200, 404]).toContain((await retried).status());
  await expect(card).toHaveCount(0);
  expect(await stats(request, link.id)).toMatchObject({
    state: "missing",
    jobs: 0,
    snapshots: 0,
    assets: 0,
  });
  await second.reload();
  await expect(second.getByRole("article")).toHaveCount(0);
  await second.close();
});

test("complete API and worker outage expires queued and claimed jobs on the original 120 second deadline", async ({
  page,
  request,
}) => {
  test.setTimeout(155_000);
  await login(page);
  const key = `/barrier/html/${crypto.randomUUID()}`;
  const claimed = await save(page, fixture + key);
  await entered(request, key);
  await command(request, "/worker/off");
  const queued = await save(page, `${fixture}/article/${crypto.randomUUID()}`);
  for (const attempt of [claimed, queued]) {
    expect(
      Date.parse(attempt.link.deadline_at) -
        Date.parse(attempt.link.requested_at),
    ).toBe(120_000);
  }
  await command(request, "/api/off");
  const remaining =
    Math.max(...[claimed, queued].map((x) => Date.parse(x.link.deadline_at))) -
    Date.now() +
    1000;
  await page.waitForTimeout(Math.max(0, remaining));
  await command(request, `/barrier/release?key=${encodeURIComponent(key)}`);
  await command(request, "/api/on");
  await expect
    .poll(async () => {
      try {
        return (await page.request.get("/api/users/me")).status();
      } catch {
        return 0;
      }
    })
    .toBe(200);
  await command(request, "/worker/on");
  await command(request, "/worker2/on");
  await page.reload();
  for (const attempt of [claimed, queued]) {
    await expect(attempt.card).toContainText(
      "Не удалось обработать ссылку за две минуты.",
    );
    expect((await metadata(page, attempt.link.id)).body).toMatchObject({
      state: "failed",
      reason: "timeout",
      deadline_at: attempt.link.deadline_at,
    });
    expect(await stats(request, attempt.link.id)).toMatchObject({
      state: "failed",
      snapshots: 0,
      assets: 0,
      executions: attempt === claimed ? 1 : 0,
    });
  }
});
