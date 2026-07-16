(() => {
  "use strict";

  const DEFAULT_TABLE = "quiz_progress";
  const DEFAULT_DEBOUNCE_MS = 700;
  const AUTH_STORAGE_KEY = "ai-study-studio-supabase-auth";

  const config = window.SUPABASE_CONFIG || {};
  let client = null;
  let callbacks = {};
  let initialized = false;
  let currentSession = null;
  let currentUserId = null;
  let hydratedUserId = null;
  let hydrationGeneration = 0;
  let accountGeneration = 0;
  let saveTimer = null;
  let savePromise = null;
  let queuedSave = null;
  let authSubscription = null;

  function hasUsableConfiguration() {
    const url = String(config.url || "").trim();
    const key = String(config.publishableKey || "").trim();
    const placeholder = /YOUR_|ここに|example|PROJECT_REF/i;
    const isPublishableKey = /^sb_publishable_[a-z0-9._-]{16,}$/i.test(key);
    return Boolean(
      window.supabase?.createClient &&
        /^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(url) &&
        isPublishableKey &&
        !placeholder.test(url) &&
        !placeholder.test(key),
    );
  }

  function clone(value) {
    if (typeof structuredClone === "function") return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  }

  function emitStatus(status, message, error = null) {
    callbacks.onStatusChange?.({ status, message, error });
  }

  function getDefaultRedirectUrl() {
    const url = new URL(window.location.href);
    url.search = "";
    url.hash = "";
    if (!url.pathname.endsWith("/")) return new URL(".", url).href;
    return url.href;
  }

  async function fetchRemoteProgress(user, generation) {
    const { data, error } = await client
      .from(config.table || DEFAULT_TABLE)
      .select("progress, updated_at")
      .eq("user_id", user.id)
      .maybeSingle();

    if (generation !== hydrationGeneration || currentUserId !== user.id) return;
    if (error) throw error;

    // Discard snapshots queued before hydration. The callback below decides whether
    // remote, cached, or migrated progress is authoritative and queues a fresh save
    // only when that reconciled state should be written back.
    window.clearTimeout(saveTimer);
    saveTimer = null;
    queuedSave = null;

    await callbacks.onRemoteProgress?.({
      user,
      progress: data?.progress || null,
      updatedAt: data?.updated_at || null,
    });

    hydratedUserId = user.id;
    emitStatus(data ? "synced" : "ready", data ? "クラウドと同期済み" : "クラウド保存の準備ができました");
    scheduleQueuedSave();
  }

  async function handleSession(event, session) {
    const user = session?.user || null;
    const userId = user?.id || null;
    const isSameUser = userId && userId === currentUserId;
    const accountChanged = userId !== currentUserId;
    currentSession = session || null;

    if (accountChanged) {
      accountGeneration += 1;
      window.clearTimeout(saveTimer);
      saveTimer = null;
      queuedSave = null;
      hydratedUserId = null;
    }

    if (!userId) {
      hydrationGeneration += 1;
      currentUserId = null;
      hydratedUserId = null;
      queuedSave = null;
      window.clearTimeout(saveTimer);
      saveTimer = null;
      await callbacks.onAuthChange?.({ user: null, event, configured: true });
      emitStatus("signed-out", "この端末に保存中。ログインするとクラウド同期できます");
      return;
    }

    currentUserId = userId;
    const needsHydration = !isSameUser || hydratedUserId !== userId;
    if (needsHydration) emitStatus("loading", "クラウドの学習履歴を読み込んでいます");
    await callbacks.onAuthChange?.({ user, event, configured: true });
    if (!needsHydration) return;

    const generation = ++hydrationGeneration;
    try {
      await fetchRemoteProgress(user, generation);
    } catch (error) {
      if (generation !== hydrationGeneration) return;
      console.error("Cloud progress could not be loaded.", error);
      emitStatus("error", "クラウドから読み込めません。端末には保存されています", error);
    }
  }

  async function initialize(nextCallbacks = {}) {
    if (initialized) return { configured: Boolean(client), user: currentSession?.user || null };
    initialized = true;
    callbacks = nextCallbacks;

    if (!hasUsableConfiguration()) {
      await callbacks.onAuthChange?.({ user: null, event: "DISABLED", configured: false });
      emitStatus("disabled", "Supabase未設定のため、この端末だけに保存します");
      return { configured: false, user: null };
    }

    emitStatus("checking", "ログイン状態を確認しています");
    client = window.supabase.createClient(config.url, config.publishableKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storageKey: AUTH_STORAGE_KEY,
      },
    });

    const { data } = client.auth.onAuthStateChange((event, session) => {
      window.setTimeout(() => {
        handleSession(event, session).catch((error) => {
          console.error("Auth state could not be applied.", error);
          emitStatus("error", "ログイン状態を反映できませんでした", error);
        });
      }, 0);
    });
    authSubscription = data.subscription;

    const { data: sessionData, error } = await client.auth.getSession();
    if (error) {
      console.error("Supabase session could not be loaded.", error);
      emitStatus("error", "ログイン状態を確認できませんでした", error);
      return { configured: true, user: null };
    }
    await handleSession("INITIAL_SESSION", sessionData.session);
    return { configured: true, user: sessionData.session?.user || null };
  }

  async function signIn() {
    if (!client) throw new Error("Supabaseが設定されていません。supabase-config.jsを確認してください。");
    emitStatus("checking", "Microsoft 365のログイン画面へ移動します");
    const redirectTo = String(config.redirectUrl || "").trim() || getDefaultRedirectUrl();
    const { error } = await client.auth.signInWithOAuth({
      provider: "azure",
      options: {
        redirectTo,
        scopes: String(config.azureScopes || "email").trim(),
      },
    });
    if (error) {
      emitStatus("error", "Microsoft 365ログインを開始できませんでした", error);
      throw error;
    }
  }

  async function signOut() {
    if (!client) return;
    await flush();
    emitStatus("checking", "ログアウトしています");
    const { error } = await client.auth.signOut({ scope: "local" });
    if (error) {
      emitStatus("error", "ログアウトできませんでした", error);
      throw error;
    }
  }

  function queueSave(progress) {
    if (!client || !currentSession?.user) return false;
    queuedSave = {
      userId: currentSession.user.id,
      accountGeneration,
      progress: clone(progress),
    };
    if (hydratedUserId !== currentSession.user.id) return true;
    scheduleQueuedSave();
    return true;
  }

  function scheduleQueuedSave() {
    if (
      !queuedSave ||
      !currentSession?.user ||
      queuedSave.userId !== currentSession.user.id ||
      queuedSave.accountGeneration !== accountGeneration ||
      hydratedUserId !== currentSession.user.id
    ) {
      return;
    }
    window.clearTimeout(saveTimer);
    const delay = Number(config.syncDebounceMs);
    saveTimer = window.setTimeout(
      () => performSave(),
      Number.isFinite(delay) && delay >= 0 ? delay : DEFAULT_DEBOUNCE_MS,
    );
  }

  async function performSave() {
    window.clearTimeout(saveTimer);
    saveTimer = null;
    if (savePromise) {
      await savePromise;
      if (queuedSave) return performSave();
      return;
    }
    if (!queuedSave || !currentSession?.user) return;
    if (
      queuedSave.userId !== currentSession.user.id ||
      queuedSave.accountGeneration !== accountGeneration ||
      hydratedUserId !== currentSession.user.id
    ) {
      queuedSave = null;
      return;
    }

    const saveItem = queuedSave;
    const { userId, accountGeneration: saveGeneration, progress: payload } = saveItem;
    queuedSave = null;
    emitStatus("saving", "クラウドへ保存しています");

    savePromise = client
      .from(config.table || DEFAULT_TABLE)
      .upsert(
        {
          user_id: userId,
          progress: payload,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" },
      )
      .then(({ error }) => {
        if (error) throw error;
        if (currentUserId === userId && accountGeneration === saveGeneration) {
          emitStatus("synced", "クラウドに保存済み");
        }
      })
      .catch((error) => {
        if (currentUserId === userId && accountGeneration === saveGeneration && !queuedSave) {
          queuedSave = saveItem;
        }
        console.error("Cloud progress could not be saved.", error);
        if (currentUserId === userId && accountGeneration === saveGeneration) {
          emitStatus("error", "クラウドへ保存できません。端末には保存されています", error);
        }
      })
      .finally(() => {
        savePromise = null;
      });

    await savePromise;
    if (queuedSave) scheduleQueuedSave();
  }

  async function flush() {
    if (saveTimer) {
      window.clearTimeout(saveTimer);
      saveTimer = null;
    }
    if (
      queuedSave &&
      queuedSave.userId === currentSession?.user?.id &&
      queuedSave.accountGeneration === accountGeneration &&
      hydratedUserId === currentSession?.user?.id
    ) {
      await performSave();
    }
    if (savePromise) await savePromise;
  }

  function destroy() {
    window.clearTimeout(saveTimer);
    queuedSave = null;
    authSubscription?.unsubscribe();
    authSubscription = null;
  }

  window.addEventListener("pagehide", () => {
    flush().catch(() => {});
  });

  window.addEventListener("online", () => {
    if (!client || !currentSession?.user) return;
    if (hydratedUserId === currentSession.user.id) {
      scheduleQueuedSave();
      return;
    }
    handleSession("ONLINE", currentSession).catch((error) => {
      console.error("Cloud sync retry failed.", error);
    });
  });

  window.QuizCloudSync = Object.freeze({
    initialize,
    signIn,
    signOut,
    queueSave,
    flush,
    destroy,
    isConfigured: hasUsableConfiguration,
    getUser: () => currentSession?.user || null,
  });
})();
