const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");

const projectRoot = path.resolve(__dirname, "..");
const siteUrl = pathToFileURL(path.join(projectRoot, "index.html")).href;
const browserCandidates = [
  process.env.CHROME_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].filter(Boolean);
const executablePath = browserCandidates.find((candidate) => fs.existsSync(candidate));

async function answerCurrentQuestion(page, chooseCorrect) {
  const questionText = (await page.locator("#quiz-question").textContent()).trim();
  const correctText = await page.evaluate((text) => {
    for (const chapter of window.QUIZ_DATA) {
      const question = chapter.questions.find((item) => item.question === text);
      if (question) return question.options[question.answer];
    }
    return null;
  }, questionText);

  assert.ok(correctText, `Correct answer not found for: ${questionText}`);
  const optionTexts = await page.locator(".option-text").allTextContents();
  const optionIndex = chooseCorrect
    ? optionTexts.findIndex((text) => text.trim() === correctText)
    : optionTexts.findIndex((text) => text.trim() !== correctText);

  assert.notEqual(optionIndex, -1, "A selectable answer should exist");
  await page.locator(".option-button").nth(optionIndex).click();
  await page.locator("#feedback-panel").waitFor({ state: "visible" });

  const correctOptions = await page.locator(".option-button.is-correct").count();
  assert.equal(correctOptions, 1, "Exactly one correct option should be shown");
}

(async () => {
  assert.ok(executablePath, "Chrome or Edge executable is required for the smoke test");
  const browser = await chromium.launch({ headless: true, executablePath });
  const errors = [];

  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.on("pageerror", (error) => errors.push(error.message));

    await page.goto(siteUrl, { waitUntil: "load" });
    await page.evaluate(() => window.localStorage.clear());
    await page.reload({ waitUntil: "load" });

    assert.equal(await page.locator(".chapter-card").count(), 6, "Six chapter cards should render");
    const dataSummary = await page.evaluate(() =>
      window.QUIZ_DATA.map((chapter) => ({
        id: chapter.id,
        questions: chapter.questions.length,
        uniqueIds: new Set(chapter.questions.map((question) => question.id)).size,
        validQuestions: chapter.questions.every(
          (question) =>
            question.options.length === 4 &&
            Number.isInteger(question.answer) &&
            question.answer >= 0 &&
            question.answer < 4 &&
            question.explanation &&
            question.sourcePage,
        ),
      })),
    );
    dataSummary.forEach((chapter) => {
      assert.equal(chapter.questions, 25, `${chapter.id} should have 25 questions`);
      assert.equal(chapter.uniqueIds, 25, `${chapter.id} should have unique question IDs`);
      assert.ok(chapter.validQuestions, `${chapter.id} should contain valid questions`);
    });

    const shuffleControl = page.locator("#shuffle-questions");
    assert.equal(await shuffleControl.isChecked(), true, "Question shuffle should default to ON");
    await shuffleControl.uncheck();
    await page.locator('input[value="5"]').check();
    await page.locator(".start-button").first().click();
    assert.equal(await page.locator("#source-link").count(), 0, "PDF source link should not be rendered");
    assert.equal(
      await page.locator('a[href*=".pdf"]').count(),
      0,
      "No PDF URL should be exposed as a page link",
    );
    await page.locator("#quiz-view").waitFor({ state: "visible" });
    const firstQuestion = (await page.locator("#quiz-question").textContent()).trim();
    const expectedFirstQuestion = await page.evaluate(() => window.QUIZ_DATA[0].questions[0].question);
    assert.equal(firstQuestion, expectedFirstQuestion, "Shuffle OFF should preserve source order");
    await page.locator("#quit-quiz-button").click();
    await page.locator("#home-view").waitFor({ state: "visible" });

    await page.reload({ waitUntil: "load" });
    assert.equal(await shuffleControl.isChecked(), false, "Shuffle OFF should persist after reload");
    await page.evaluate(() => {
      Math.random = () => 0;
    });
    await shuffleControl.check();
    await page.locator(".start-button").first().click();
    await page.locator("#quiz-view").waitFor({ state: "visible" });
    const shuffledFirstQuestion = (await page.locator("#quiz-question").textContent()).trim();
    assert.notEqual(shuffledFirstQuestion, expectedFirstQuestion, "Shuffle ON should change question order");
    await page.locator("#quit-quiz-button").click();
    await page.locator("#home-view").waitFor({ state: "visible" });
    await page.reload({ waitUntil: "load" });
    assert.equal(await shuffleControl.isChecked(), true, "Shuffle ON should persist after reload");
    const storedShuffleSetting = await page.evaluate(() =>
      JSON.parse(window.localStorage.getItem("ai-study-studio-progress-v1")),
    );
    assert.equal(storedShuffleSetting.settings.shuffleQuestions, true, "Shuffle setting should be saved");

    await page.screenshot({ path: path.join(os.tmpdir(), "ai-study-home.png"), fullPage: true });

    for (const [countValue, expectedTotal] of [
      ["10", "10"],
      ["20", "20"],
      ["all", "25"],
    ]) {
      await page.locator(`input[value="${countValue}"]`).check();
      await page.locator(".start-button").first().click();
      await page.locator("#quiz-view").waitFor({ state: "visible" });
      assert.equal(await page.locator("#quiz-progress-track").getAttribute("aria-valuemax"), expectedTotal);
      await page.locator("#quit-quiz-button").click();
      await page.locator("#home-view").waitFor({ state: "visible" });
    }

    await page.locator('input[value="5"]').check();
    await page.locator(".start-button").first().click();
    await page.locator("#quiz-view").waitFor({ state: "visible" });

    const normalQuestionTexts = [];
    for (let index = 0; index < 5; index += 1) {
      normalQuestionTexts.push((await page.locator("#quiz-question").textContent()).trim());
      await answerCurrentQuestion(page, index !== 0);
      await page.locator("#next-question-button").click();
    }

    await page.locator("#result-view").waitFor({ state: "visible" });
    assert.equal((await page.locator("#result-total").textContent()).trim(), "5");
    assert.equal((await page.locator("#result-wrong").textContent()).trim(), "1");
    assert.ok(await page.locator("#retry-button").isVisible(), "Retry action should be visible");
    assert.ok(await page.locator("#next-chapter-button").isVisible(), "Next chapter action should be visible");

    const storedAfterQuiz = await page.evaluate(() =>
      JSON.parse(window.localStorage.getItem("ai-study-studio-progress-v1")),
    );
    assert.ok(storedAfterQuiz, "Progress should be saved to localStorage");
    assert.equal(storedAfterQuiz.recentResults.length, 1, "Completed result should be stored");
    const reviewRecords = Object.values(storedAfterQuiz.chapters["chapter-1"].questions).filter(
      (record) => record.needsReview,
    );
    assert.equal(reviewRecords.length, 1, "Wrong answer should enter the review queue");

    await page.locator("#retry-button").click();
    await page.locator("#quiz-view").waitFor({ state: "visible" });
    assert.equal(
      (await page.locator("#quiz-question").textContent()).trim(),
      normalQuestionTexts[0],
      "Normal retry should reuse the just-completed question order",
    );
    await page.locator("#quit-quiz-button").click();
    await page.locator("#home-view").waitFor({ state: "visible" });

    const reviewButton = page.locator(".chapter-card").first().locator(".review-button");
    assert.equal(await reviewButton.isDisabled(), false, "Review action should become available");
    await reviewButton.click();
    const reviewQuestionText = (await page.locator("#quiz-question").textContent()).trim();
    await answerCurrentQuestion(page, true);
    await page.locator("#next-question-button").click();
    await page.locator("#result-view").waitFor({ state: "visible" });
    assert.equal((await page.locator("#result-percent").textContent()).trim(), "100%");

    const reviewRemaining = await page.evaluate(() => {
      const saved = JSON.parse(window.localStorage.getItem("ai-study-studio-progress-v1"));
      return Object.values(saved.chapters["chapter-1"].questions).filter((record) => record.needsReview).length;
    });
    assert.equal(reviewRemaining, 0, "Correct review answer should clear the review queue");

    await page.locator("#retry-button").click();
    await page.locator("#quiz-view").waitFor({ state: "visible" });
    assert.equal(
      await page.locator("#quiz-progress-track").getAttribute("aria-valuemax"),
      "1",
      "Review retry should reuse the just-completed question set",
    );
    assert.equal(
      (await page.locator("#quiz-question").textContent()).trim(),
      reviewQuestionText,
      "Review retry should reuse the just-completed question order",
    );
    await answerCurrentQuestion(page, true);
    await page.locator("#next-question-button").click();
    await page.locator("#result-view").waitFor({ state: "visible" });

    await page.locator("#next-chapter-button").click();
    await page.locator("#quiz-view").waitFor({ state: "visible" });
    assert.equal((await page.locator("#quiz-chapter-pill").textContent()).trim(), "第2章");

    const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
    mobile.on("pageerror", (error) => errors.push(`mobile: ${error.message}`));
    await mobile.goto(siteUrl, { waitUntil: "load" });
    const overflows = await mobile.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    assert.equal(overflows, false, "Mobile layout should not overflow horizontally");
    await mobile.screenshot({ path: path.join(os.tmpdir(), "ai-study-mobile.png"), fullPage: true });

    const recovery = await browser.newPage();
    recovery.on("pageerror", (error) => errors.push(`recovery: ${error.message}`));
    await recovery.goto(siteUrl, { waitUntil: "load" });
    await recovery.evaluate(() => {
      window.localStorage.setItem(
        "ai-study-studio-progress-v1",
        JSON.stringify({
          version: 1,
          settings: { questionCount: "10" },
          chapters: { "chapter-1": "corrupted" },
          recentResults: [null],
        }),
      );
    });
    await recovery.reload({ waitUntil: "load" });
    assert.equal(await recovery.locator(".chapter-card").count(), 6, "Corrupted progress should recover safely");
    assert.equal(
      await recovery.locator("#shuffle-questions").isChecked(),
      true,
      "Saved data without a shuffle setting should migrate to shuffle ON",
    );

    assert.deepEqual(errors, [], `Browser errors found: ${errors.join(" | ")}`);
    console.log(JSON.stringify({ status: "ok", chapters: dataSummary, screenshots: os.tmpdir() }, null, 2));
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
