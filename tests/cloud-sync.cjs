const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { chromium } = require("playwright");

const projectRoot = path.resolve(__dirname, "..");
const mountPath = "/github-pages-subpath/";
const storageKey = "ai-study-studio-progress-v1";
const userStoragePrefix = `${storageKey}:user:`;

const browserCandidates = [
  process.env.CHROME_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].filter(Boolean);
const executablePath = browserCandidates.find((candidate) => fs.existsSync(candidate));

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".pdf": "application/pdf",
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function defaultProgress(overrides = {}) {
  return {
    version: 1,
    settings: { questionCount: "10", shuffleQuestions: true },
    chapters: {},
    recentResults: [],
    updatedAt: null,
    ...overrides,
  };
}

async function startStaticServer() {
  const server = http.createServer((request, response) => {
    const requestUrl = new URL(request.url, "http://127.0.0.1");
    let pathname;
    try {
      pathname = decodeURIComponent(requestUrl.pathname);
    } catch {
      response.writeHead(400).end("Bad request");
      return;
    }

    if (!pathname.startsWith(mountPath)) {
      response.writeHead(404).end("Not found");
      return;
    }

    let relativePath = pathname.slice(mountPath.length);
    if (!relativePath || relativePath.endsWith("/")) relativePath += "index.html";
    const filePath = path.resolve(projectRoot, relativePath);
    const insideProject =
      filePath === projectRoot || filePath.startsWith(`${projectRoot}${path.sep}`);
    if (!insideProject) {
      response.writeHead(403).end("Forbidden");
      return;
    }

    fs.readFile(filePath, (error, data) => {
      if (error) {
        response.writeHead(error.code === "ENOENT" ? 404 : 500).end("Not found");
        return;
      }
      response.writeHead(200, {
        "cache-control": "no-store",
        "content-type": contentTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream",
      });
      response.end(data);
    });
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  return {
    baseUrl: `http://127.0.0.1:${address.port}${mountPath}`,
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}

async function createScenario(browser, baseUrl, scenario, viewport = { width: 1280, height: 900 }) {
  const context = await browser.newContext({ viewport });
  const errors = [];
  const baseConfig = scenario.configured
    ? {
        url: "https://cloud-sync-test.supabase.co",
        publishableKey: "sb_publishable_cloud_sync_test_abcdefghijklmnopqrstuvwxyz",
        requireSignIn: scenario.requireSignIn === true,
        syncDebounceMs: 0,
      }
    : {
        url: "https://YOUR_PROJECT_REF.supabase.co",
        publishableKey: "sb_publishable_REPLACE_WITH_YOUR_KEY",
        requireSignIn: scenario.requireSignIn === true,
        syncDebounceMs: 0,
      };
  const config = { ...baseConfig, ...(scenario.configOverrides || {}) };

  await context.route("https://cdn.jsdelivr.net/**", (route) =>
    route.fulfill({ status: 200, contentType: "text/javascript", body: "/* Supabase SDK mocked by the test. */" }),
  );
  await context.route("**/supabase-config.js", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/javascript",
      body: `window.SUPABASE_CONFIG = Object.freeze(${JSON.stringify(config)});`,
    }),
  );

  await context.addInitScript(
    ({ testScenario, legacyStorageKey }) => {
      const deepClone = (value) => JSON.parse(JSON.stringify(value));
      const state = {
        session: testScenario.session ? deepClone(testScenario.session) : null,
        remoteProgress:
          testScenario.remoteProgress === undefined ? null : deepClone(testScenario.remoteProgress),
        remoteUpdatedAt: testScenario.remoteUpdatedAt || null,
        listeners: [],
        remainingUpsertFailures: Number(testScenario.upsertFailureCount) || 0,
      };
      const calls = {
        createClient: [],
        getSession: 0,
        selects: [],
        upserts: [],
        oauth: [],
        signOuts: [],
        authEvents: [],
      };

      try {
        if (!window.sessionStorage.getItem("cloud-sync-test-seeded")) {
          window.localStorage.clear();
          Object.entries(testScenario.storage || {}).forEach(([key, value]) => {
            window.localStorage.setItem(key, JSON.stringify(value));
          });
          window.sessionStorage.setItem("cloud-sync-test-seeded", "1");
        }
      } catch {
        // The init script can also run on an opaque about:blank origin.
      }

      function emitAuth(event, session) {
        state.session = session ? deepClone(session) : null;
        calls.authEvents.push({ event, session: state.session });
        state.listeners.forEach((listener) => listener(event, state.session));
      }

      window.__SUPABASE_MOCK = { calls, emitAuth };
      window.supabase = {
        createClient(url, publishableKey, options) {
          calls.createClient.push({ url, publishableKey, options: deepClone(options) });
          return {
            auth: {
              onAuthStateChange(listener) {
                state.listeners.push(listener);
                if (testScenario.emitInitialAuthEvent) {
                  queueMicrotask(() => emitAuth("INITIAL_SESSION", state.session));
                }
                return {
                  data: {
                    subscription: {
                      unsubscribe() {
                        state.listeners = state.listeners.filter((item) => item !== listener);
                      },
                    },
                  },
                };
              },
              async getSession() {
                calls.getSession += 1;
                return { data: { session: state.session }, error: null };
              },
              async signInWithOAuth(argumentsValue) {
                calls.oauth.push(deepClone(argumentsValue));
                return { data: { provider: argumentsValue.provider }, error: null };
              },
              async signOut(argumentsValue) {
                calls.signOuts.push(deepClone(argumentsValue));
                emitAuth("SIGNED_OUT", null);
                return { error: null };
              },
            },
            from(table) {
              const query = { table, columns: null, filters: [] };
              return {
                select(columns) {
                  query.columns = columns;
                  return this;
                },
                eq(column, value) {
                  query.filters.push({ column, value });
                  return this;
                },
                async maybeSingle() {
                  calls.selects.push(deepClone(query));
                  if (testScenario.remoteDelayMs) {
                    await new Promise((resolve) => setTimeout(resolve, testScenario.remoteDelayMs));
                  }
                  const data = state.remoteProgress
                    ? {
                        progress: deepClone(state.remoteProgress),
                        updated_at: state.remoteUpdatedAt,
                      }
                    : null;
                  return { data, error: null };
                },
                async upsert(payload, optionsValue) {
                  calls.upserts.push({
                    table,
                    payload: deepClone(payload),
                    options: deepClone(optionsValue),
                  });
                  if (testScenario.upsertDelayMs) {
                    await new Promise((resolve) => setTimeout(resolve, testScenario.upsertDelayMs));
                  }
                  if (state.remainingUpsertFailures > 0) {
                    state.remainingUpsertFailures -= 1;
                    return { data: null, error: { message: "Mock upsert failure" } };
                  }
                  state.remoteProgress = deepClone(payload.progress);
                  state.remoteUpdatedAt = payload.updated_at;
                  return { data: null, error: null };
                },
              };
            },
          };
        },
      };

      window.__CLOUD_TEST_STORAGE_KEY = legacyStorageKey;
    },
    { testScenario: scenario, legacyStorageKey: storageKey },
  );

  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(baseUrl, { waitUntil: "load" });
  await page.locator(".chapter-card").first().waitFor({ state: "attached" });
  return { context, page, errors };
}

async function readStorage(page, key) {
  return page.evaluate((storageName) => {
    const raw = window.localStorage.getItem(storageName);
    return raw ? JSON.parse(raw) : null;
  }, key);
}

async function closeScenario(scenario) {
  assert.deepEqual(scenario.errors, [], `Browser errors found: ${scenario.errors.join(" | ")}`);
  await scenario.context.close();
}

async function testUnconfiguredLocalCompatibility(browser, baseUrl) {
  const localProgress = defaultProgress({
    settings: { questionCount: "5", shuffleQuestions: false },
    updatedAt: "2026-07-01T00:00:00.000Z",
  });
  const scenario = await createScenario(browser, baseUrl, {
    configured: false,
    requireSignIn: true,
    storage: { [storageKey]: localProgress },
  });
  const { page } = scenario;

  assert.equal(await page.locator(".chapter-card").count(), 6);
  assert.equal(await page.locator('#count-selector input[value="5"]').isChecked(), true);
  assert.equal(await page.locator("#shuffle-questions").isChecked(), false);
  assert.equal(await page.locator("#main-content").isVisible(), true);
  assert.equal(await page.locator("#auth-gate").isVisible(), false);
  assert.equal(await page.locator("#auth-login-button").isVisible(), false);

  await page.locator("#shuffle-questions").check();
  await page.waitForFunction(
    (key) => JSON.parse(window.localStorage.getItem(key)).settings.shuffleQuestions === true,
    storageKey,
  );
  const saved = await readStorage(page, storageKey);
  assert.equal(saved.settings.questionCount, "5");
  assert.equal(saved.settings.shuffleQuestions, true);
  const userKeys = await page.evaluate((prefix) =>
    Object.keys(window.localStorage).filter((key) => key.startsWith(prefix)), userStoragePrefix);
  assert.deepEqual(userKeys, []);
  const calls = await page.evaluate(() => window.__SUPABASE_MOCK.calls);
  assert.equal(calls.createClient.length, 0, "Unconfigured mode must not create a Supabase client");

  await closeScenario(scenario);
}

async function testLoggedInRemoteReadSaveAndLogout(browser, baseUrl) {
  const userId = "11111111-1111-4111-8111-111111111111";
  const anonymousProgress = defaultProgress({
    settings: { questionCount: "10", shuffleQuestions: true },
    updatedAt: "2026-06-01T00:00:00.000Z",
  });
  const remoteProgress = defaultProgress({
    settings: { questionCount: "20", shuffleQuestions: false },
    chapters: {
      "chapter-1": {
        sessions: 1,
        bestRate: 67,
        questions: {
          "ch1-q01": {
            totalAnswers: 3,
            correctAnswers: 2,
            incorrectAnswers: 1,
            needsReview: true,
            lastWasCorrect: false,
            lastAnsweredAt: "2026-07-10T00:00:00.000Z",
          },
        },
      },
    },
    updatedAt: "2026-07-10T00:00:00.000Z",
  });
  const scenario = await createScenario(browser, baseUrl, {
    configured: true,
    requireSignIn: true,
    emitInitialAuthEvent: true,
    session: {
      access_token: "test-access-token",
      user: {
        id: userId,
        email: "learner@example.com",
        user_metadata: { name: "Test Learner" },
      },
    },
    remoteProgress,
    remoteUpdatedAt: "2026-07-10T00:00:00.000Z",
    storage: { [storageKey]: anonymousProgress },
  });
  const { page } = scenario;

  await page.locator("#auth-user").waitFor({ state: "visible" });
  await page.waitForFunction(() => document.querySelector("#answered-total")?.textContent === "3");
  assert.equal(await page.locator('#count-selector input[value="20"]').isChecked(), true);
  assert.equal(await page.locator("#shuffle-questions").isChecked(), false);

  const initialCalls = await page.evaluate(() => window.__SUPABASE_MOCK.calls);
  assert.ok(initialCalls.selects.length >= 1, "Logged-in startup should read remote progress");
  assert.ok(
    initialCalls.selects.every((query) =>
      query.filters.some((filter) => filter.column === "user_id" && filter.value === userId)),
    "Every remote read should be scoped to the authenticated user",
  );
  const cachedRemote = await readStorage(page, `${userStoragePrefix}${userId}`);
  assert.equal(cachedRemote.chapters["chapter-1"].questions["ch1-q01"].totalAnswers, 3);

  await page.locator('#count-selector input[value="5"]').check();
  await page.waitForFunction(() => window.__SUPABASE_MOCK.calls.upserts.length > 0);
  const saveCalls = await page.evaluate(() => window.__SUPABASE_MOCK.calls.upserts);
  const latestSave = saveCalls.at(-1);
  assert.equal(latestSave.payload.user_id, userId);
  assert.equal(latestSave.payload.progress.settings.questionCount, "5");
  assert.equal(latestSave.options.onConflict, "user_id");

  await page.locator("#auth-logout-button").click();
  await page.locator("#auth-gate").waitFor({ state: "visible" });
  assert.equal(await page.locator("#main-content").isVisible(), false);
  const logoutCalls = await page.evaluate(() => window.__SUPABASE_MOCK.calls.signOuts);
  assert.deepEqual(logoutCalls, [{ scope: "local" }]);

  const anonymousAfterLogout = await readStorage(page, storageKey);
  const userAfterLogout = await readStorage(page, `${userStoragePrefix}${userId}`);
  assert.equal(anonymousAfterLogout.settings.questionCount, "10");
  assert.equal(userAfterLogout.settings.questionCount, "5");
  assert.equal(await page.locator('#count-selector input[value="10"]').isChecked(), true);

  await closeScenario(scenario);
}

async function testLegacyFirstMigration(browser, baseUrl) {
  const userId = "22222222-2222-4222-8222-222222222222";
  const legacyProgress = defaultProgress({
    chapters: {
      "chapter-1": {
        sessions: 1,
        bestRate: 100,
        questions: {
          "ch1-q02": {
            totalAnswers: 1,
            correctAnswers: 1,
            incorrectAnswers: 0,
            needsReview: false,
            lastWasCorrect: true,
            lastAnsweredAt: "2026-07-11T00:00:00.000Z",
          },
        },
      },
    },
    updatedAt: "2026-07-11T00:00:00.000Z",
  });
  const scenario = await createScenario(browser, baseUrl, {
    configured: true,
    requireSignIn: true,
    session: {
      access_token: "migration-access-token",
      user: { id: userId, email: "migration@example.com", user_metadata: {} },
    },
    remoteProgress: null,
    storage: { [storageKey]: legacyProgress },
  });
  const { page } = scenario;

  await page.waitForFunction(() => window.__SUPABASE_MOCK.calls.upserts.length > 0);
  await page.waitForFunction((key) => window.localStorage.getItem(key) === null, storageKey);
  const migrated = await readStorage(page, `${userStoragePrefix}${userId}`);
  const backup = await readStorage(page, `${storageKey}:migration-backup`);
  assert.equal(migrated.chapters["chapter-1"].questions["ch1-q02"].totalAnswers, 1);
  assert.equal(backup.chapters["chapter-1"].questions["ch1-q02"].totalAnswers, 1);

  const upserts = await page.evaluate(() => window.__SUPABASE_MOCK.calls.upserts);
  assert.equal(upserts.at(-1).payload.user_id, userId);
  assert.equal(
    upserts.at(-1).payload.progress.chapters["chapter-1"].questions["ch1-q02"].totalAnswers,
    1,
  );

  await closeScenario(scenario);
}

async function testSignedOutOAuthAndMobileLayout(browser, baseUrl) {
  const scenario = await createScenario(
    browser,
    baseUrl,
    {
      configured: true,
      requireSignIn: true,
      session: null,
      remoteProgress: null,
      storage: {},
    },
    { width: 390, height: 844 },
  );
  const { page } = scenario;

  await page.locator("#auth-gate").waitFor({ state: "visible" });
  assert.equal(await page.locator("#main-content").isVisible(), false);
  const overflows = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  assert.equal(overflows, false, "Signed-out mobile auth UI should not overflow horizontally");

  await page.locator("#auth-gate-login-button").click();
  await page.waitForFunction(() => window.__SUPABASE_MOCK.calls.oauth.length === 1);
  const oauthCall = await page.evaluate(() => window.__SUPABASE_MOCK.calls.oauth[0]);
  assert.equal(oauthCall.provider, "azure");
  assert.equal(oauthCall.options.scopes, "email");
  assert.equal(oauthCall.options.redirectTo, baseUrl);
  assert.equal(new URL(oauthCall.options.redirectTo).pathname, mountPath);

  await closeScenario(scenario);
}

async function testDelayedHydrationBlocksStaleWrites(browser, baseUrl) {
  const userId = "33333333-3333-4333-8333-333333333333";
  const remoteProgress = defaultProgress({
    settings: { questionCount: "20", shuffleQuestions: false },
    chapters: {
      "chapter-1": {
        sessions: 1,
        bestRate: 100,
        questions: {
          "ch1-q03": {
            totalAnswers: 2,
            correctAnswers: 2,
            incorrectAnswers: 0,
            needsReview: false,
            lastWasCorrect: true,
            lastAnsweredAt: "2026-07-12T00:00:00.000Z",
          },
        },
      },
    },
    updatedAt: "2026-07-12T00:00:00.000Z",
  });
  const scenario = await createScenario(browser, baseUrl, {
    configured: true,
    requireSignIn: true,
    remoteDelayMs: 800,
    session: {
      access_token: "delayed-hydration-token",
      user: { id: userId, email: "delayed@example.com", user_metadata: {} },
    },
    remoteProgress,
    remoteUpdatedAt: "2026-07-12T00:00:00.000Z",
    storage: {},
  });
  const { page } = scenario;

  await page.waitForFunction(
    () => document.querySelector("#auth-gate-title")?.textContent === "学習履歴を同期中",
  );
  assert.equal(await page.locator("#auth-gate").isVisible(), true);
  assert.equal(await page.locator("#main-content").isVisible(), false);
  assert.equal(await page.locator("#auth-gate-login-button").isVisible(), false);

  await page.locator("#main-content").waitFor({ state: "visible" });
  await page.waitForFunction(() => document.querySelector("#answered-total")?.textContent === "2");
  assert.equal(await page.locator('#count-selector input[value="20"]').isChecked(), true);
  assert.equal(await page.locator("#shuffle-questions").isChecked(), false);
  const calls = await page.evaluate(() => window.__SUPABASE_MOCK.calls);
  assert.equal(calls.upserts.length, 0, "Hydration must not write an unreconciled local snapshot");

  await closeScenario(scenario);
}

async function testFailedOldSaveCannotCrossAccounts(browser, baseUrl) {
  const userA = "44444444-4444-4444-8444-444444444444";
  const userB = "55555555-5555-4555-8555-555555555555";
  const scenario = await createScenario(browser, baseUrl, {
    configured: true,
    requireSignIn: true,
    upsertDelayMs: 500,
    upsertFailureCount: 1,
    session: {
      access_token: "user-a-token",
      user: { id: userA, email: "user-a@example.com", user_metadata: {} },
    },
    remoteProgress: defaultProgress({
      settings: { questionCount: "10", shuffleQuestions: true },
      updatedAt: "2026-07-13T00:00:00.000Z",
    }),
    remoteUpdatedAt: "2026-07-13T00:00:00.000Z",
    storage: {},
  });
  const { page } = scenario;

  await page.locator("#main-content").waitFor({ state: "visible" });
  await page.locator('#count-selector input[value="5"]').check();
  await page.waitForFunction(() => window.__SUPABASE_MOCK.calls.upserts.length === 1);

  await page.evaluate(
    ({ nextUserId }) => {
      window.__SUPABASE_MOCK.emitAuth("SIGNED_IN", {
        access_token: "user-b-token",
        user: { id: nextUserId, email: "user-b@example.com", user_metadata: {} },
      });
    },
    { nextUserId: userB },
  );
  await page.locator("#main-content").waitFor({ state: "visible" });
  await page.waitForTimeout(650);
  let upserts = await page.evaluate(() => window.__SUPABASE_MOCK.calls.upserts);
  assert.equal(upserts.length, 1, "A failed save from user A must not be retried as user B");
  assert.equal(upserts[0].payload.user_id, userA);
  assert.equal(upserts[0].payload.progress.settings.questionCount, "5");

  await page.locator('#count-selector input[value="20"]').check();
  await page.waitForFunction(() => window.__SUPABASE_MOCK.calls.upserts.length === 2);
  upserts = await page.evaluate(() => window.__SUPABASE_MOCK.calls.upserts);
  assert.equal(upserts[1].payload.user_id, userB);
  assert.equal(upserts[1].payload.progress.settings.questionCount, "20");

  await closeScenario(scenario);
}

async function testSecretKeyIsRejected(browser, baseUrl) {
  const scenario = await createScenario(browser, baseUrl, {
    configured: true,
    requireSignIn: true,
    configOverrides: {
      publishableKey: "sb_secret_this_key_must_never_be_accepted_in_a_browser",
    },
    session: null,
    remoteProgress: null,
    storage: {},
  });
  const { page } = scenario;

  assert.equal(await page.locator("#main-content").isVisible(), true);
  assert.equal(await page.locator("#auth-gate").isVisible(), false);
  assert.equal(await page.locator("#auth-login-button").isVisible(), false);
  const calls = await page.evaluate(() => window.__SUPABASE_MOCK.calls);
  assert.equal(calls.createClient.length, 0, "A browser secret key must disable cloud initialization");

  await closeScenario(scenario);
}

(async () => {
  const server = await startStaticServer();
  const launchOptions = executablePath
    ? { headless: true, executablePath }
    : { headless: true };
  let browser = null;

  try {
    browser = await chromium.launch(launchOptions);
    await testUnconfiguredLocalCompatibility(browser, server.baseUrl);
    await testLoggedInRemoteReadSaveAndLogout(browser, server.baseUrl);
    await testLegacyFirstMigration(browser, server.baseUrl);
    await testSignedOutOAuthAndMobileLayout(browser, server.baseUrl);
    await testDelayedHydrationBlocksStaleWrites(browser, server.baseUrl);
    await testFailedOldSaveCannotCrossAccounts(browser, server.baseUrl);
    await testSecretKeyIsRejected(browser, server.baseUrl);
    console.log(
      JSON.stringify(
        {
          status: "ok",
          scenarios: [
            "unconfigured-local-compatibility",
            "logged-in-remote-read-upsert-logout",
            "legacy-first-migration",
            "signed-out-oauth-mobile-subpath",
            "delayed-hydration-gate",
            "failed-old-save-account-switch",
            "secret-key-rejection",
          ],
        },
        null,
        2,
      ),
    );
  } finally {
    try {
      if (browser) await browser.close();
    } finally {
      await server.close();
    }
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
