const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const context = { window: { QUIZ_DATA: [] } };
vm.createContext(context);

for (const chapterNumber of [1, 2, 3, 4, 5, 6]) {
  const file = path.join(root, "data", `chapter-${chapterNumber}.js`);
  assert.ok(fs.existsSync(file), `Missing quiz data: ${file}`);
  vm.runInContext(fs.readFileSync(file, "utf8"), context, { filename: file });
}

const chapters = context.window.QUIZ_DATA;
const chapterAwareLanguage = /本章|本文|この章|章末確認問題|本資料|資料では|講座では|テキストでは/;
assert.equal(chapters.length, 6, "Exactly six chapters should be loaded");
assert.deepEqual(
  chapters.map((chapter) => chapter.number).sort(),
  [1, 2, 3, 4, 5, 6],
  "Chapter numbers should be 1 through 6",
);

const allIds = new Set();
for (const chapter of chapters) {
  assert.equal(chapter.questions.length, 25, `${chapter.id} should contain 25 questions`);
  assert.ok(chapter.title && chapter.description && chapter.source, `${chapter.id} metadata is incomplete`);

  const chapterIds = new Set();
  const answerCounts = [0, 0, 0, 0];
  for (const question of chapter.questions) {
    assert.ok(question.id && !chapterIds.has(question.id), `Duplicate ID in ${chapter.id}: ${question.id}`);
    assert.ok(!allIds.has(question.id), `Duplicate global question ID: ${question.id}`);
    assert.equal(question.options.length, 4, `${question.id} should have four options`);
    assert.ok(
      Number.isInteger(question.answer) && question.answer >= 0 && question.answer < 4,
      `${question.id} has an invalid answer index`,
    );
    assert.ok(question.question && question.explanation, `${question.id} is missing text`);
    assert.equal(
      chapterAwareLanguage.test(`${question.question}\n${question.explanation}`),
      false,
      `${question.id} contains chapter-aware wording`,
    );
    assert.ok(Number(question.sourcePage) > 0, `${question.id} has an invalid source page`);
    chapterIds.add(question.id);
    allIds.add(question.id);
    answerCounts[question.answer] += 1;
  }

  assert.ok(answerCounts.every((count) => count >= 3), `${chapter.id} answer positions are too imbalanced`);
}

console.log(`Quiz data OK: ${chapters.length} chapters / ${allIds.size} questions`);
