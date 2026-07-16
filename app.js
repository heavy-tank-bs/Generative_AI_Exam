(() => {
  "use strict";

  const STORAGE_KEY = "ai-study-studio-progress-v1";
  const USER_STORAGE_PREFIX = `${STORAGE_KEY}:user:`;
  const VALID_COUNTS = new Set(["5", "10", "20", "all"]);
  const chapters = Array.isArray(window.QUIZ_DATA)
    ? [...window.QUIZ_DATA]
    : [];

  const elements = {
    homeView: document.querySelector("#home-view"),
    quizView: document.querySelector("#quiz-view"),
    resultView: document.querySelector("#result-view"),
    brandHome: document.querySelector("#brand-home"),
    mainContent: document.querySelector("#main-content"),
    siteFooter: document.querySelector(".site-footer"),
    storageIndicator: document.querySelector("#storage-indicator"),
    authLoginButton: document.querySelector("#auth-login-button"),
    authLogoutButton: document.querySelector("#auth-logout-button"),
    authUser: document.querySelector("#auth-user"),
    authUserName: document.querySelector("#auth-user-name"),
    authUserEmail: document.querySelector("#auth-user-email"),
    authAvatar: document.querySelector("#auth-avatar"),
    authLoading: document.querySelector("#auth-loading"),
    authGate: document.querySelector("#auth-gate"),
    authGateTitle: document.querySelector("#auth-gate-title"),
    authGateDescription: document.querySelector("#auth-gate-description"),
    authGateLoginButton: document.querySelector("#auth-gate-login-button"),
    authGateNote: document.querySelector(".auth-gate-note"),
    progressDate: document.querySelector("#progress-date"),
    answeredTotal: document.querySelector("#answered-total"),
    bestRate: document.querySelector("#best-rate"),
    reviewTotal: document.querySelector("#review-total"),
    continueButton: document.querySelector("#continue-button"),
    continueLabel: document.querySelector("#continue-label"),
    countSelector: document.querySelector("#count-selector"),
    shuffleQuestions: document.querySelector("#shuffle-questions"),
    chapterGrid: document.querySelector("#chapter-grid"),
    reviewStrip: document.querySelector("#review-strip"),
    reviewStripCount: document.querySelector("#review-strip-count"),
    reviewAllButton: document.querySelector("#review-all-button"),
    resetProgressButton: document.querySelector("#reset-progress-button"),
    quitQuizButton: document.querySelector("#quit-quiz-button"),
    quizChapterPill: document.querySelector("#quiz-chapter-pill"),
    quizChapterTitle: document.querySelector("#quiz-chapter-title"),
    quizModePill: document.querySelector("#quiz-mode-pill"),
    quizProgressLabel: document.querySelector("#quiz-progress-label"),
    quizScoreLive: document.querySelector("#quiz-score-live"),
    quizProgressTrack: document.querySelector("#quiz-progress-track"),
    quizProgressBar: document.querySelector("#quiz-progress-bar"),
    quizQuestion: document.querySelector("#quiz-question"),
    optionList: document.querySelector("#option-list"),
    feedbackPanel: document.querySelector("#feedback-panel"),
    feedbackMark: document.querySelector("#feedback-mark"),
    feedbackTitle: document.querySelector("#feedback-title"),
    feedbackText: document.querySelector("#feedback-text"),
    nextQuestionButton: document.querySelector("#next-question-button"),
    resultKicker: document.querySelector("#result-kicker"),
    resultTitle: document.querySelector("#result-title"),
    resultSubtitle: document.querySelector("#result-subtitle"),
    scoreRing: document.querySelector("#score-ring"),
    resultPercent: document.querySelector("#result-percent"),
    resultCorrect: document.querySelector("#result-correct"),
    resultTotal: document.querySelector("#result-total"),
    resultWrong: document.querySelector("#result-wrong"),
    retryButton: document.querySelector("#retry-button"),
    nextChapterButton: document.querySelector("#next-chapter-button"),
    resultHomeButton: document.querySelector("#result-home-button"),
    answerReview: document.querySelector("#answer-review"),
    answerReviewToggle: document.querySelector("#answer-review-toggle"),
    answerReviewList: document.querySelector("#answer-review-list"),
    toast: document.querySelector("#toast"),
  };

  let storageAvailable = checkStorage();
  let activeStorageKey = STORAGE_KEY;
  let progress = loadProgress(activeStorageKey);
  let currentCloudUser = null;
  let cloudConfigured = false;
  let cloudStatus = "disabled";
  let accountCandidate = null;
  let toastTimer = null;

  const state = {
    view: "home",
    selectedCount: VALID_COUNTS.has(progress.settings?.questionCount)
      ? progress.settings.questionCount
      : "10",
    shuffleQuestions: progress.settings?.shuffleQuestions !== false,
    session: null,
    lastResult: null,
  };

  initialize();

  function initialize() {
    validateQuizData();
    bindStaticEvents();
    syncCountSelector();
    cloudConfigured = Boolean(window.QuizCloudSync?.isConfigured?.());
    if (cloudConfigured) cloudStatus = "checking";
    updateStorageIndicator();
    updateAuthUI();
    applyAuthRequirement();
    renderHome();
    initializeCloudSync();

    const today = new Intl.DateTimeFormat("ja-JP", {
      month: "short",
      day: "numeric",
    }).format(new Date());
    elements.progressDate.textContent = today.toUpperCase();
  }

  function defaultProgress() {
    return {
      version: 1,
      settings: { questionCount: "10", shuffleQuestions: true },
      chapters: {},
      recentResults: [],
      updatedAt: null,
    };
  }

  function checkStorage() {
    try {
      const testKey = `${STORAGE_KEY}-test`;
      window.localStorage.setItem(testKey, "1");
      window.localStorage.removeItem(testKey);
      return true;
    } catch (error) {
      console.warn("Local storage is unavailable.", error);
      return false;
    }
  }

  function normalizeProgress(value) {
    const fallback = defaultProgress();
    const saved = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    const chaptersValue =
      saved.chapters && typeof saved.chapters === "object" && !Array.isArray(saved.chapters)
        ? saved.chapters
        : {};
    return {
      ...fallback,
      ...saved,
      settings: { ...fallback.settings, ...(saved.settings || {}) },
      chapters: chaptersValue,
      recentResults: Array.isArray(saved.recentResults)
        ? saved.recentResults
            .filter(
              (result) => result && typeof result === "object" && typeof result.chapterId === "string",
            )
            .slice(0, 20)
        : [],
      updatedAt: typeof saved.updatedAt === "string" ? saved.updatedAt : null,
    };
  }

  function readStoredProgress(storageKey) {
    const fallback = defaultProgress();
    if (!storageAvailable) return { exists: false, progress: fallback };

    try {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) return { exists: false, progress: fallback };
      return { exists: true, progress: normalizeProgress(JSON.parse(raw)) };
    } catch (error) {
      console.warn("Saved progress could not be loaded.", error);
      return { exists: false, progress: fallback };
    }
  }

  function loadProgress(storageKey = activeStorageKey) {
    return readStoredProgress(storageKey).progress;
  }

  function progressHasActivity(value) {
    if (!value || typeof value !== "object") return false;
    if (Array.isArray(value.recentResults) && value.recentResults.length) return true;
    if (value.settings?.questionCount !== "10" || value.settings?.shuffleQuestions === false) return true;
    return Object.values(value.chapters || {}).some((chapter) => {
      if (!chapter || typeof chapter !== "object") return false;
      if (Number(chapter.sessions) > 0 || Number.isFinite(chapter.bestRate)) return true;
      return Object.values(chapter.questions || {}).some(
        (record) => record && typeof record === "object" && Number(record.totalAnswers) > 0,
      );
    });
  }

  function getProgressTimestamp(value, fallback = null) {
    const timestamps = [value?.updatedAt, fallback]
      .map((candidate) => Date.parse(candidate || ""))
      .filter(Number.isFinite);
    return timestamps.length ? Math.max(...timestamps) : 0;
  }

  function saveProgress({ syncCloud = true, touchUpdatedAt = true } = {}) {
    if (touchUpdatedAt) progress.updatedAt = new Date().toISOString();
    let savedLocally = false;

    if (storageAvailable) {
      try {
        window.localStorage.setItem(activeStorageKey, JSON.stringify(progress));
        savedLocally = true;
      } catch (error) {
        storageAvailable = false;
        updateStorageIndicator();
        console.warn("Progress could not be saved.", error);
      }
    }

    const queuedForCloud = Boolean(
      syncCloud && currentCloudUser && window.QuizCloudSync?.queueSave(progress),
    );
    return savedLocally || queuedForCloud;
  }

  function updateStorageIndicator() {
    if (!elements.storageIndicator) return;
    const isCloudError = cloudConfigured && cloudStatus === "error";
    const isSyncing = ["checking", "loading", "saving"].includes(cloudStatus);
    const isCloudSaved = currentCloudUser && ["ready", "synced"].includes(cloudStatus);
    elements.storageIndicator.classList.toggle("storage-error", !storageAvailable || isCloudError);
    elements.storageIndicator.classList.toggle("storage-syncing", isSyncing);
    elements.storageIndicator.classList.toggle("storage-cloud", Boolean(isCloudSaved));
    const label = elements.storageIndicator.querySelector("span:last-child");
    let message = "この端末に自動保存";
    let title = "学習履歴はこのブラウザ内に保存されます";

    if (!storageAvailable) {
      message = currentCloudUser ? "クラウド保存を利用" : "このタブ内のみ保存";
      title = currentCloudUser
        ? "ブラウザの保存機能は利用できませんが、ログイン中はクラウドへ保存します"
        : "ブラウザの保存機能を利用できないため、履歴はこのタブ内だけ保持されます";
    } else if (isSyncing) {
      message = cloudStatus === "saving" ? "クラウドへ保存中" : "クラウドと同期中";
      title = "学習履歴をSupabaseと同期しています";
    } else if (isCloudSaved) {
      message = "クラウドに保存済み";
      title = "この端末とSupabaseに学習履歴を保存しています";
    } else if (isCloudError) {
      message = "端末に保存・同期待ち";
      title = "端末への保存は完了しています。通信回復後に再度クラウド保存を試みます";
    } else if (cloudConfigured) {
      message = "端末に保存・ログインで同期";
      title = "Microsoft 365でログインすると学習履歴をクラウドにも保存できます";
    }

    if (label) label.textContent = message;
    elements.storageIndicator.title = title;
  }

  async function initializeCloudSync() {
    if (!window.QuizCloudSync) {
      cloudConfigured = false;
      cloudStatus = "disabled";
      updateAuthUI();
      applyAuthRequirement();
      updateStorageIndicator();
      return;
    }

    try {
      await window.QuizCloudSync.initialize({
        onAuthChange: handleCloudAuthChange,
        onRemoteProgress: handleRemoteProgress,
        onStatusChange: handleCloudStatusChange,
      });
    } catch (error) {
      console.error("Cloud sync could not be initialized.", error);
      cloudStatus = "error";
      updateAuthUI();
      applyAuthRequirement();
      updateStorageIndicator();
      showToast("クラウド同期を初期化できませんでした。端末への保存は継続します。");
    }
  }

  async function handleCloudAuthChange({ user, configured }) {
    cloudConfigured = Boolean(configured);
    const previousUserId = currentCloudUser?.id || null;
    const nextUserId = user?.id || null;
    const accountChanged = previousUserId !== nextUserId;
    currentCloudUser = user || null;

    if (user && accountChanged) {
      activeStorageKey = `${USER_STORAGE_PREFIX}${user.id}`;
      const userStored = readStoredProgress(activeStorageKey);
      const anonymousStored = readStoredProgress(STORAGE_KEY);
      const shouldClaimAnonymous = !userStored.exists && progressHasActivity(anonymousStored.progress);
      const candidate = userStored.exists ? userStored.progress : defaultProgress();

      accountCandidate = {
        userId: user.id,
        userCacheExists: userStored.exists,
        claimedAnonymous: shouldClaimAnonymous,
        anonymousProgress: shouldClaimAnonymous ? anonymousStored.progress : null,
      };
      applyProgress(candidate, { forceHome: previousUserId !== null });
    } else if (!user && accountChanged) {
      activeStorageKey = STORAGE_KEY;
      accountCandidate = null;
      applyProgress(loadProgress(STORAGE_KEY), { forceHome: true });
    }

    updateAuthUI();
    applyAuthRequirement();
    updateStorageIndicator();
  }

  async function handleRemoteProgress({ user, progress: remoteValue, updatedAt }) {
    if (!currentCloudUser || currentCloudUser.id !== user.id) return;

    const remoteExists = Boolean(remoteValue && typeof remoteValue === "object");
    if (remoteExists) {
      const remoteProgress = normalizeProgress(remoteValue);
      const localCacheCanOverride = Boolean(
        accountCandidate?.userId === user.id && accountCandidate.userCacheExists,
      );
      const localIsNewer =
        localCacheCanOverride &&
        getProgressTimestamp(progress) > getProgressTimestamp(remoteProgress, updatedAt);

      if (localIsNewer) {
        saveProgress({ syncCloud: true, touchUpdatedAt: false });
        showToast("この端末の新しい学習履歴をクラウドへ同期します。");
      } else {
        applyProgress(remoteProgress, { forceHome: false });
        saveProgress({ syncCloud: false, touchUpdatedAt: false });
      }
    } else {
      if (accountCandidate?.userId === user.id && accountCandidate.anonymousProgress) {
        applyProgress(accountCandidate.anonymousProgress, { forceHome: false });
      }
      if (!progress.updatedAt) progress.updatedAt = new Date().toISOString();
      saveProgress({ syncCloud: true, touchUpdatedAt: false });

      if (accountCandidate?.userId === user.id && accountCandidate.claimedAnonymous && storageAvailable) {
        try {
          const anonymousRaw = window.localStorage.getItem(STORAGE_KEY);
          if (anonymousRaw) {
            window.localStorage.setItem(`${STORAGE_KEY}:migration-backup`, anonymousRaw);
            window.localStorage.removeItem(STORAGE_KEY);
          }
          showToast("この端末の学習履歴をアカウント用に引き継ぎ、クラウド同期を開始しました。");
        } catch (error) {
          console.warn("Anonymous progress could not be archived after migration.", error);
        }
      }
    }

    accountCandidate = null;
  }

  function handleCloudStatusChange({ status, message }) {
    const previousStatus = cloudStatus;
    cloudStatus = status;
    updateAuthUI();
    applyAuthRequirement();
    updateStorageIndicator();
    if (status === "error" && previousStatus !== "error" && message) showToast(message);
  }

  function applyProgress(nextProgress, { forceHome = false } = {}) {
    progress = normalizeProgress(nextProgress);
    state.selectedCount = VALID_COUNTS.has(progress.settings?.questionCount)
      ? progress.settings.questionCount
      : "10";
    state.shuffleQuestions = progress.settings?.shuffleQuestions !== false;
    state.lastResult = null;
    syncCountSelector();

    if (forceHome && state.view !== "home") {
      showHome();
    } else {
      renderHome();
    }
  }

  function getCloudUserProfile() {
    if (!currentCloudUser) return null;
    const metadata = currentCloudUser.user_metadata || {};
    const email = currentCloudUser.email || metadata.email || "";
    const name =
      metadata.full_name ||
      metadata.name ||
      metadata.display_name ||
      email.split("@")[0] ||
      "Microsoft 365ユーザー";
    const compactName = Array.from(String(name).replace(/\s+/g, ""));
    const initials = compactName.slice(0, 2).join("").toUpperCase() || "MS";
    return { name: String(name), email: String(email), initials };
  }

  function updateAuthUI() {
    const checking = cloudConfigured && cloudStatus === "checking" && !currentCloudUser;
    const hydrating =
      cloudConfigured &&
      Boolean(currentCloudUser) &&
      ["checking", "loading"].includes(cloudStatus);
    const profile = getCloudUserProfile();

    if (elements.authLoading) elements.authLoading.hidden = !checking;
    if (elements.authLoginButton) {
      elements.authLoginButton.hidden = !cloudConfigured || Boolean(currentCloudUser) || checking;
      elements.authLoginButton.disabled = checking;
    }
    if (elements.authUser) elements.authUser.hidden = !currentCloudUser;
    if (elements.authLogoutButton) elements.authLogoutButton.disabled = checking || hydrating;
    if (elements.authGateLoginButton) {
      elements.authGateLoginButton.hidden = hydrating;
      elements.authGateLoginButton.disabled = checking || hydrating;
      const label = elements.authGateLoginButton.querySelector("span:last-child");
      if (label) label.textContent = checking ? "ログイン状態を確認中" : "Microsoft 365でログイン";
    }

    if (profile) {
      if (elements.authUserName) elements.authUserName.textContent = profile.name;
      if (elements.authUserEmail) elements.authUserEmail.textContent = profile.email;
      if (elements.authAvatar) elements.authAvatar.textContent = profile.initials;
    }
  }

  function applyAuthRequirement() {
    const loginRequired =
      cloudConfigured && window.SUPABASE_CONFIG?.requireSignIn === true && !currentCloudUser;
    const hydrating =
      cloudConfigured &&
      Boolean(currentCloudUser) &&
      ["checking", "loading"].includes(cloudStatus);
    const showGate = loginRequired || hydrating;

    if (elements.authGate) elements.authGate.hidden = !showGate;
    if (elements.mainContent) elements.mainContent.hidden = showGate;
    if (elements.siteFooter) elements.siteFooter.hidden = showGate;

    if (hydrating) {
      if (elements.authGateTitle) elements.authGateTitle.textContent = "学習履歴を同期中";
      if (elements.authGateDescription) {
        elements.authGateDescription.textContent =
          "このアカウントの学習履歴を読み込んでいます。同期が完了すると自動的にクイズを表示します。";
      }
      if (elements.authGateNote) elements.authGateNote.textContent = "画面を閉じずにお待ちください";
    } else {
      if (elements.authGateTitle) elements.authGateTitle.textContent = "社内アカウントでログイン";
      if (elements.authGateDescription) {
        elements.authGateDescription.textContent =
          "この学習ツールは社内向けです。Microsoft 365の社内アカウントでログインしてください。学習履歴はアカウントごとに安全に同期されます。";
      }
      if (elements.authGateNote) elements.authGateNote.textContent = "Microsoft 365の認証画面へ移動します";
    }
  }

  async function startMicrosoftLogin() {
    try {
      await window.QuizCloudSync?.signIn();
    } catch (error) {
      console.error("Microsoft login could not be started.", error);
      showToast(error.message || "Microsoft 365ログインを開始できませんでした。");
    }
  }

  async function logoutCloudAccount() {
    try {
      await window.QuizCloudSync?.signOut();
      showToast("ログアウトしました。この端末の匿名用履歴へ切り替えました。");
    } catch (error) {
      console.error("Logout failed.", error);
      showToast(error.message || "ログアウトできませんでした。");
    }
  }

  function validateQuizData() {
    const errors = [];
    const invalidChapterIndexes = [];
    const seenChapterIds = new Set();

    chapters.forEach((chapter, chapterIndex) => {
      const validChapter =
        chapter?.id &&
        !seenChapterIds.has(chapter.id) &&
        Number.isFinite(Number(chapter.number)) &&
        typeof chapter.title === "string" &&
        typeof chapter.source === "string" &&
        Array.isArray(chapter.questions);
      if (!validChapter) {
        errors.push("章データの形式が正しくありません。");
        invalidChapterIndexes.push(chapterIndex);
        return;
      }
      seenChapterIds.add(chapter.id);

      const seenIds = new Set();
      chapter.questions = chapter.questions.filter((question, index) => {
        const valid =
          question?.id &&
          !seenIds.has(question.id) &&
          typeof question.question === "string" &&
          Array.isArray(question.options) &&
          question.options.length === 4 &&
          question.options.every((option) => typeof option === "string" && option.trim()) &&
          Number.isInteger(question.answer) &&
          question.answer >= 0 &&
          question.answer < 4 &&
          typeof question.explanation === "string" &&
          question.explanation.trim() &&
          Number.isFinite(Number(question.sourcePage)) &&
          Number(question.sourcePage) > 0;
        if (!valid) errors.push(`${chapter.id} の ${index + 1} 問目の形式が正しくありません。`);
        if (valid) seenIds.add(question.id);
        return valid;
      });

      if (chapter.questions.length === 0) {
        errors.push(`${chapter.id} に有効な問題がありません。`);
        invalidChapterIndexes.push(chapterIndex);
      }
    });

    invalidChapterIndexes.reverse().forEach((index) => chapters.splice(index, 1));
    chapters.sort((a, b) => a.number - b.number);

    if (errors.length) {
      console.error("Quiz data validation errors:", errors);
      showToast("一部の問題データを読み込めませんでした。コンソールを確認してください。");
    }
  }

  function bindStaticEvents() {
    elements.brandHome.addEventListener("click", (event) => {
      event.preventDefault();
      requestHome();
    });

    elements.authLoginButton?.addEventListener("click", startMicrosoftLogin);
    elements.authGateLoginButton?.addEventListener("click", startMicrosoftLogin);
    elements.authLogoutButton?.addEventListener("click", logoutCloudAccount);

    elements.countSelector.addEventListener("change", (event) => {
      if (!event.target.matches('input[name="question-count"]')) return;
      state.selectedCount = event.target.value;
      progress.settings.questionCount = state.selectedCount;
      saveProgress();
      renderChapterCards();
    });

    elements.shuffleQuestions.addEventListener("change", () => {
      state.shuffleQuestions = elements.shuffleQuestions.checked;
      progress.settings.shuffleQuestions = state.shuffleQuestions;
      saveProgress();
      showToast(state.shuffleQuestions ? "問題のシャッフルをONにしました。" : "問題を資料順に出題します。");
    });

    elements.continueButton.addEventListener("click", () => {
      const recent = progress.recentResults.find((result) => findChapter(result.chapterId));
      if (recent) startQuiz(recent.chapterId, "normal");
    });

    elements.reviewAllButton.addEventListener("click", startReviewAll);
    elements.resetProgressButton.addEventListener("click", resetProgress);
    elements.quitQuizButton.addEventListener("click", requestHome);
    elements.nextQuestionButton.addEventListener("click", goToNextQuestion);
    elements.retryButton.addEventListener("click", retryLastQuiz);
    elements.nextChapterButton.addEventListener("click", goToNextChapter);
    elements.resultHomeButton.addEventListener("click", showHome);
    elements.answerReviewToggle.addEventListener("click", toggleAnswerReview);

    document.addEventListener("keydown", handleKeyboardInput);
  }

  function syncCountSelector() {
    const input = elements.countSelector.querySelector(`input[value="${state.selectedCount}"]`);
    if (input) input.checked = true;
    elements.shuffleQuestions.checked = state.shuffleQuestions;
  }

  function getChapterProgress(chapterId) {
    const savedChapter = progress.chapters[chapterId];
    if (!savedChapter || typeof savedChapter !== "object" || Array.isArray(savedChapter)) {
      progress.chapters[chapterId] = {
        sessions: 0,
        bestRate: null,
        questions: {},
      };
    }
    const chapterProgress = progress.chapters[chapterId];
    if (
      !chapterProgress.questions ||
      typeof chapterProgress.questions !== "object" ||
      Array.isArray(chapterProgress.questions)
    ) {
      chapterProgress.questions = {};
    }
    return chapterProgress;
  }

  function getQuestionProgress(chapterId, questionId) {
    const chapterProgress = getChapterProgress(chapterId);
    const savedQuestion = chapterProgress.questions[questionId];
    if (!savedQuestion || typeof savedQuestion !== "object" || Array.isArray(savedQuestion)) {
      chapterProgress.questions[questionId] = {
        totalAnswers: 0,
        correctAnswers: 0,
        incorrectAnswers: 0,
        needsReview: false,
        lastWasCorrect: null,
        lastAnsweredAt: null,
      };
    }
    return chapterProgress.questions[questionId];
  }

  function getChapterStats(chapter) {
    const chapterProgress = getChapterProgress(chapter.id);
    const records = chapter.questions.map((question) => chapterProgress.questions[question.id]).filter(Boolean);
    return {
      answeredUnique: records.filter((record) => Number(record.totalAnswers) > 0).length,
      reviewCount: records.filter((record) => record.needsReview).length,
      totalAnswers: records.reduce((sum, record) => sum + (Number(record.totalAnswers) || 0), 0),
      bestRate: Number.isFinite(chapterProgress.bestRate) ? chapterProgress.bestRate : null,
    };
  }

  function getOverallStats() {
    const chapterStats = chapters.map(getChapterStats);
    const bestRates = chapterStats.map((stats) => stats.bestRate).filter(Number.isFinite);
    return {
      totalAnswers: chapterStats.reduce((sum, stats) => sum + stats.totalAnswers, 0),
      reviewCount: chapterStats.reduce((sum, stats) => sum + stats.reviewCount, 0),
      bestRate: bestRates.length ? Math.max(...bestRates) : null,
    };
  }

  function renderHome() {
    const overall = getOverallStats();
    elements.answeredTotal.textContent = String(overall.totalAnswers);
    elements.reviewTotal.textContent = String(overall.reviewCount);
    elements.bestRate.textContent = Number.isFinite(overall.bestRate) ? `${overall.bestRate}%` : "—";

    const recent = progress.recentResults.find((result) => findChapter(result.chapterId));
    if (recent) {
      const chapter = findChapter(recent.chapterId);
      elements.continueLabel.textContent = `${chapter.shortTitle || `第${chapter.number}章`}をもう一度`;
      elements.continueButton.hidden = false;
    } else {
      elements.continueButton.hidden = true;
    }

    renderChapterCards();
    elements.reviewStrip.hidden = overall.reviewCount === 0;
    elements.reviewStripCount.textContent = String(overall.reviewCount);
  }

  function renderChapterCards() {
    elements.chapterGrid.replaceChildren();

    if (!chapters.length) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.textContent = "問題データを読み込めませんでした。data フォルダを確認してください。";
      elements.chapterGrid.append(empty);
      return;
    }

    chapters.forEach((chapter) => {
      const stats = getChapterStats(chapter);
      const card = document.createElement("article");
      card.className = "chapter-card";
      const titleId = `chapter-title-${chapter.id}`;
      card.setAttribute("aria-labelledby", titleId);

      const top = document.createElement("div");
      top.className = "chapter-card-top";

      const number = document.createElement("span");
      number.className = "chapter-number";
      number.textContent = String(chapter.number).padStart(2, "0");

      const count = document.createElement("span");
      count.className = "chapter-count";
      count.textContent = `${chapter.questions.length} QUESTIONS`;
      top.append(number, count);

      const title = document.createElement("h3");
      title.id = titleId;
      title.textContent = chapter.title;

      const description = document.createElement("p");
      description.className = "chapter-description";
      description.textContent = chapter.description;

      const progressWrap = document.createElement("div");
      progressWrap.className = "chapter-progress";
      const progressCopy = document.createElement("div");
      progressCopy.className = "chapter-progress-copy";
      const progressLabel = document.createElement("span");
      progressLabel.textContent = stats.answeredUnique
        ? `${stats.answeredUnique} / ${chapter.questions.length}問に回答済み`
        : "まだ挑戦していません";
      const reviewLabel = document.createElement("span");
      reviewLabel.textContent = stats.reviewCount ? `復習 ${stats.reviewCount}問` : "復習なし";
      progressCopy.append(progressLabel, reviewLabel);

      const miniProgress = document.createElement("div");
      miniProgress.className = "mini-progress";
      const miniBar = document.createElement("span");
      miniBar.style.width = `${Math.round((stats.answeredUnique / chapter.questions.length) * 100)}%`;
      miniProgress.append(miniBar);

      const actions = document.createElement("div");
      actions.className = "chapter-actions";
      const startButton = document.createElement("button");
      startButton.className = "start-button";
      startButton.type = "button";
      startButton.setAttribute("aria-label", `${chapter.shortTitle || `第${chapter.number}章`}「${chapter.title}」をはじめる`);
      startButton.innerHTML = `<span>この章をはじめる</span><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m7 4 6 6-6 6" /></svg>`;
      startButton.addEventListener("click", () => startQuiz(chapter.id, "normal"));

      const reviewButton = document.createElement("button");
      reviewButton.className = "review-button";
      reviewButton.type = "button";
      reviewButton.setAttribute(
        "aria-label",
        `${chapter.shortTitle || `第${chapter.number}章`}「${chapter.title}」の間違えた問題を復習`,
      );
      reviewButton.disabled = stats.reviewCount === 0;
      reviewButton.textContent = stats.reviewCount ? `復習 ${stats.reviewCount}` : "復習";
      reviewButton.title = stats.reviewCount
        ? `この章の間違えた問題を最大${getRequestedCountLabel(stats.reviewCount)}復習`
        : "間違えた問題はありません";
      reviewButton.addEventListener("click", () => startQuiz(chapter.id, "review"));

      actions.append(startButton, reviewButton);
      progressWrap.append(progressCopy, miniProgress, actions);
      card.append(top, title, description, progressWrap);
      elements.chapterGrid.append(card);
    });
  }

  function getRequestedCountLabel(poolSize) {
    if (state.selectedCount === "all") return `${poolSize}問`;
    return `${Math.min(Number(state.selectedCount), poolSize)}問`;
  }

  function startQuiz(chapterId, mode = "normal") {
    const chapter = findChapter(chapterId);
    if (!chapter) return;

    let pool = chapter.questions;
    if (mode === "review") {
      const chapterProgress = getChapterProgress(chapter.id);
      pool = chapter.questions.filter((question) => chapterProgress.questions[question.id]?.needsReview);
    }

    if (!pool.length) {
      showHome();
      showToast("この章の復習待ちはありません。よくできました！");
      return;
    }

    const requested = state.selectedCount === "all" ? pool.length : Number(state.selectedCount);
    const orderedPool = state.shuffleQuestions ? shuffle(pool) : [...pool];
    const selected = orderedPool.slice(0, Math.min(requested, pool.length));
    state.session = createSession(
      selected.map((question) => prepareQuestion(question, chapter)),
      mode,
      chapter.id,
    );

    showView("quiz");
    renderQuestion();
  }

  function startReviewAll() {
    const pool = [];
    chapters.forEach((chapter) => {
      const chapterProgress = getChapterProgress(chapter.id);
      chapter.questions.forEach((question) => {
        if (chapterProgress.questions[question.id]?.needsReview) {
          pool.push(prepareQuestion(question, chapter));
        }
      });
    });

    if (!pool.length) {
      showHome();
      showToast("復習待ちの問題はありません。よくできました！");
      return;
    }

    const requested = state.selectedCount === "all" ? pool.length : Number(state.selectedCount);
    const orderedPool = state.shuffleQuestions ? shuffle(pool) : pool;
    state.session = createSession(
      orderedPool.slice(0, Math.min(requested, pool.length)),
      "review-all",
      null,
    );
    showView("quiz");
    renderQuestion();
  }

  function createSession(questions, mode, baseChapterId) {
    return {
      mode,
      baseChapterId,
      questions,
      index: 0,
      answers: [],
      startedAt: new Date().toISOString(),
      completed: false,
    };
  }

  function prepareQuestion(question, chapter) {
    const displayOptions = shuffle(
      question.options.map((text, originalIndex) => ({
        text,
        correct: originalIndex === question.answer,
      })),
    );

    return {
      id: question.id,
      question: question.question,
      explanation: question.explanation,
      chapterId: chapter.id,
      chapterNumber: chapter.number,
      chapterTitle: chapter.title,
      chapterShortTitle: chapter.shortTitle || `第${chapter.number}章`,
      displayOptions,
      selectedIndex: null,
      isCorrect: null,
      answered: false,
    };
  }

  function renderQuestion() {
    const session = state.session;
    if (!session) return;
    const current = session.questions[session.index];
    const total = session.questions.length;
    const currentNumber = session.index + 1;
    const correctSoFar = session.answers.filter((answer) => answer.isCorrect).length;

    elements.quizChapterPill.textContent = current.chapterShortTitle;
    elements.quizChapterTitle.textContent = session.mode === "review-all" ? "全章ミックス" : current.chapterTitle;
    elements.quizModePill.textContent = session.mode === "normal" ? "通常モード" : "復習モード";
    elements.quizModePill.classList.toggle("review-mode", session.mode !== "normal");
    elements.quizProgressLabel.textContent = `QUESTION ${String(currentNumber).padStart(2, "0")} / ${String(total).padStart(2, "0")}`;
    elements.quizScoreLive.textContent = `正解 ${correctSoFar}`;
    elements.quizProgressTrack.setAttribute("aria-valuemax", String(total));
    elements.quizProgressTrack.setAttribute("aria-valuenow", String(currentNumber));
    elements.quizProgressBar.style.width = `${(currentNumber / total) * 100}%`;
    elements.quizQuestion.textContent = current.question;

    elements.optionList.replaceChildren();
    current.displayOptions.forEach((option, index) => {
      const button = document.createElement("button");
      button.className = "option-button";
      button.type = "button";
      button.dataset.index = String(index);
      button.setAttribute("aria-label", `${index + 1}. ${option.text}`);

      const letter = document.createElement("span");
      letter.className = "option-letter";
      letter.textContent = String.fromCharCode(65 + index);
      const text = document.createElement("span");
      text.className = "option-text";
      text.textContent = option.text;
      const status = document.createElement("span");
      status.className = "option-status";
      status.setAttribute("aria-hidden", "true");
      button.append(letter, text, status);
      button.addEventListener("click", () => answerQuestion(index));
      elements.optionList.append(button);
    });

    elements.feedbackPanel.hidden = true;
    elements.feedbackPanel.classList.remove("is-wrong");
    elements.nextQuestionButton.hidden = true;
    const nextLabel = elements.nextQuestionButton.querySelector("span");
    if (nextLabel) nextLabel.textContent = currentNumber === total ? "結果を見る" : "次の問題";
    document.title = `${currentNumber}/${total} ${current.chapterShortTitle} | AI Study Studio`;
    elements.quizQuestion.setAttribute("tabindex", "-1");
    window.setTimeout(() => elements.quizQuestion.focus({ preventScroll: true }), 30);
  }

  function answerQuestion(selectedIndex) {
    const session = state.session;
    const current = session?.questions[session.index];
    if (!current || current.answered || !current.displayOptions[selectedIndex]) return;

    current.selectedIndex = selectedIndex;
    current.isCorrect = current.displayOptions[selectedIndex].correct;
    current.answered = true;

    const correctOption = current.displayOptions.find((option) => option.correct);
    session.answers.push({
      questionId: current.id,
      chapterId: current.chapterId,
      question: current.question,
      selectedText: current.displayOptions[selectedIndex].text,
      correctText: correctOption.text,
      explanation: current.explanation,
      isCorrect: current.isCorrect,
    });

    recordAnswer(current, session.mode);
    showAnswerFeedback(current, selectedIndex);
  }

  function recordAnswer(question, mode) {
    const record = getQuestionProgress(question.chapterId, question.id);
    record.totalAnswers = (Number(record.totalAnswers) || 0) + 1;
    record.lastWasCorrect = question.isCorrect;
    record.lastAnsweredAt = new Date().toISOString();

    if (question.isCorrect) {
      record.correctAnswers = (Number(record.correctAnswers) || 0) + 1;
      if (mode === "review" || mode === "review-all") record.needsReview = false;
    } else {
      record.incorrectAnswers = (Number(record.incorrectAnswers) || 0) + 1;
      record.needsReview = true;
    }
    saveProgress();
  }

  function showAnswerFeedback(current, selectedIndex) {
    const buttons = [...elements.optionList.querySelectorAll(".option-button")];
    buttons.forEach((button, index) => {
      const option = current.displayOptions[index];
      const status = button.querySelector(".option-status");
      button.disabled = true;
      if (option.correct) {
        button.classList.add("is-correct");
        status.textContent = "✓";
      } else if (index === selectedIndex) {
        button.classList.add("is-wrong");
        status.textContent = "×";
      } else {
        button.classList.add("is-muted");
      }
    });

    elements.feedbackPanel.hidden = false;
    elements.feedbackPanel.classList.toggle("is-wrong", !current.isCorrect);
    elements.feedbackMark.textContent = current.isCorrect ? "✓" : "!";
    elements.feedbackTitle.textContent = current.isCorrect
      ? "正解です！"
      : `正解は「${current.displayOptions.find((option) => option.correct).text}」`;
    elements.feedbackText.textContent = current.explanation;
    elements.nextQuestionButton.hidden = false;

    const correctSoFar = state.session.answers.filter((answer) => answer.isCorrect).length;
    elements.quizScoreLive.textContent = `正解 ${correctSoFar}`;
  }

  function goToNextQuestion() {
    const session = state.session;
    const current = session?.questions[session.index];
    if (!session || !current?.answered) return;

    if (session.index >= session.questions.length - 1) {
      completeSession();
      return;
    }

    session.index += 1;
    renderQuestion();
  }

  function completeSession() {
    const session = state.session;
    if (!session || session.completed) return;
    session.completed = true;

    const correct = session.answers.filter((answer) => answer.isCorrect).length;
    const total = session.answers.length;
    const percent = total ? Math.round((correct / total) * 100) : 0;

    if (session.baseChapterId) {
      const chapterProgress = getChapterProgress(session.baseChapterId);
      chapterProgress.sessions = (Number(chapterProgress.sessions) || 0) + 1;
      if (session.mode === "normal") {
        chapterProgress.bestRate = Number.isFinite(chapterProgress.bestRate)
          ? Math.max(chapterProgress.bestRate, percent)
          : percent;
      }
      progress.recentResults.unshift({
        chapterId: session.baseChapterId,
        mode: session.mode,
        percent,
        correct,
        total,
        completedAt: new Date().toISOString(),
      });
      progress.recentResults = progress.recentResults.slice(0, 20);
    }

    saveProgress();
    state.lastResult = {
      mode: session.mode,
      baseChapterId: session.baseChapterId,
      questionRefs: session.questions.map((question) => ({
        chapterId: question.chapterId,
        questionId: question.id,
      })),
      answers: [...session.answers],
      correct,
      total,
      percent,
    };
    renderResult();
    showView("result");
  }

  function renderResult() {
    const result = state.lastResult;
    if (!result) return;
    const wrongAnswers = result.answers.filter((answer) => !answer.isCorrect);
    const isReview = result.mode !== "normal";

    elements.resultKicker.textContent = isReview ? "REVIEW COMPLETE" : "CHAPTER COMPLETE";
    if (result.percent === 100) {
      elements.resultTitle.textContent = "パーフェクト！";
      elements.resultSubtitle.textContent = isReview
        ? "復習した問題をすべてクリアしました。"
        : "このセットは全問正解です。知識がしっかり定着しています。";
    } else if (result.percent >= 80) {
      elements.resultTitle.textContent = "すばらしい結果です！";
      elements.resultSubtitle.textContent = "あと少し。間違えた問題を復習して仕上げましょう。";
    } else if (result.percent >= 60) {
      elements.resultTitle.textContent = "いいペースです！";
      elements.resultSubtitle.textContent = "解説を振り返ると、次はもっと伸ばせます。";
    } else {
      elements.resultTitle.textContent = "ここから定着させよう";
      elements.resultSubtitle.textContent = "間違いは伸びしろです。復習リストを活用しましょう。";
    }

    elements.resultPercent.textContent = `${result.percent}%`;
    elements.resultCorrect.textContent = String(result.correct);
    elements.resultTotal.textContent = String(result.total);
    elements.resultWrong.textContent = String(wrongAnswers.length);
    elements.scoreRing.style.background = `conic-gradient(var(--lime) 0%, var(--lime) ${result.percent}%, rgba(24, 49, 83, 0.09) ${result.percent}%)`;

    const chapter = result.baseChapterId ? findChapter(result.baseChapterId) : null;
    const nextChapter = chapter ? chapters[chapters.findIndex((item) => item.id === chapter.id) + 1] : null;
    const nextText = elements.nextChapterButton.querySelector("span");
    if (nextText) nextText.textContent = nextChapter ? "次の章に進む" : "章一覧に戻る";

    elements.answerReview.hidden = wrongAnswers.length === 0;
    elements.answerReviewToggle.setAttribute("aria-expanded", "false");
    elements.answerReviewList.hidden = true;
    elements.answerReviewList.replaceChildren();
    wrongAnswers.forEach((answer) => {
      const item = document.createElement("div");
      item.className = "review-answer-item";
      const question = document.createElement("strong");
      question.textContent = answer.question;
      const correct = document.createElement("span");
      correct.textContent = `正解：${answer.correctText}`;
      const explanation = document.createElement("span");
      explanation.textContent = answer.explanation;
      item.append(question, correct, explanation);
      elements.answerReviewList.append(item);
    });

    document.title = `結果 ${result.percent}% | AI Study Studio`;
  }

  function retryLastQuiz() {
    const result = state.lastResult;
    if (!result) return;

    const questions = (result.questionRefs || [])
      .map((reference) => {
        const chapter = findChapter(reference.chapterId);
        const question = chapter?.questions.find((item) => item.id === reference.questionId);
        return chapter && question ? prepareQuestion(question, chapter) : null;
      })
      .filter(Boolean);

    if (!questions.length) {
      showHome();
      showToast("問題データを再読込できませんでした。章一覧から選び直してください。");
      return;
    }

    state.session = createSession(questions, result.mode, result.baseChapterId);
    showView("quiz");
    renderQuestion();
  }

  function goToNextChapter() {
    const result = state.lastResult;
    const chapter = result?.baseChapterId ? findChapter(result.baseChapterId) : null;
    if (!chapter) {
      showHome();
      return;
    }
    const chapterIndex = chapters.findIndex((item) => item.id === chapter.id);
    const nextChapter = chapters[chapterIndex + 1];
    if (nextChapter) {
      startQuiz(nextChapter.id, "normal");
    } else {
      showHome();
    }
  }

  function toggleAnswerReview() {
    const expanded = elements.answerReviewToggle.getAttribute("aria-expanded") === "true";
    elements.answerReviewToggle.setAttribute("aria-expanded", String(!expanded));
    elements.answerReviewList.hidden = expanded;
  }

  function requestHome() {
    const sessionInProgress =
      state.view === "quiz" &&
      state.session &&
      !state.session.completed &&
      (state.session.index > 0 || state.session.questions[state.session.index]?.answered);

    if (sessionInProgress) {
      const leave = window.confirm("クイズを途中で終了しますか？ 回答済みの履歴は保存されています。");
      if (!leave) return;
    }
    showHome();
  }

  function showHome() {
    state.session = null;
    renderHome();
    showView("home");
  }

  function showView(viewName) {
    state.view = viewName;
    elements.homeView.hidden = viewName !== "home";
    elements.quizView.hidden = viewName !== "quiz";
    elements.resultView.hidden = viewName !== "result";
    window.scrollTo({ top: 0, behavior: "smooth" });

    if (viewName === "home") document.title = "AI Study Studio | AI基礎講座クイズ";
    const focusTarget =
      viewName === "home"
        ? document.querySelector("#home-title")
        : viewName === "result"
          ? elements.resultTitle
          : null;
    if (focusTarget) {
      focusTarget.setAttribute("tabindex", "-1");
      window.setTimeout(() => focusTarget.focus({ preventScroll: true }), 30);
    }
  }

  function resetProgress() {
    const confirmed = window.confirm(
      "学習履歴、ベスト正答率、復習リストをすべて削除します。この操作は元に戻せません。",
    );
    if (!confirmed) return;

    const preservedSettings = {
      questionCount: state.selectedCount,
      shuffleQuestions: state.shuffleQuestions,
    };
    progress = defaultProgress();
    progress.settings = { ...progress.settings, ...preservedSettings };
    syncCountSelector();
    saveProgress();
    renderHome();
    showToast("学習履歴をリセットしました。");
  }

  function handleKeyboardInput(event) {
    if (state.view !== "quiz" || !state.session) return;
    const current = state.session.questions[state.session.index];

    if (/^[1-4]$/.test(event.key) && !current.answered) {
      event.preventDefault();
      const selectedIndex = Number(event.key) - 1;
      if (current.displayOptions[selectedIndex]) answerQuestion(selectedIndex);
      return;
    }

    const interactiveTarget = event.target.closest?.(
      "a, button, input, select, textarea, [contenteditable='true'], [role='button']",
    );
    if (
      event.key === "Enter" &&
      !interactiveTarget &&
      current.answered &&
      !elements.nextQuestionButton.hidden
    ) {
      event.preventDefault();
      goToNextQuestion();
    }
  }

  function findChapter(chapterId) {
    return chapters.find((chapter) => chapter.id === chapterId);
  }

  function shuffle(items) {
    const copy = [...items];
    for (let index = copy.length - 1; index > 0; index -= 1) {
      const randomIndex = Math.floor(Math.random() * (index + 1));
      [copy[index], copy[randomIndex]] = [copy[randomIndex], copy[index]];
    }
    return copy;
  }

  function showToast(message) {
    window.clearTimeout(toastTimer);
    elements.toast.textContent = message;
    elements.toast.hidden = false;
    toastTimer = window.setTimeout(() => {
      elements.toast.hidden = true;
    }, 3600);
  }
})();
