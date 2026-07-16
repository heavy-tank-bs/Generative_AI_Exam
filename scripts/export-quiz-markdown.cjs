const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const outputPath = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(root, "AI基礎講座_クイズ全150問.md");

const context = { window: { QUIZ_DATA: [] } };
vm.createContext(context);

for (const chapterNumber of [1, 2, 3, 4, 5, 6]) {
  const dataPath = path.join(root, "data", `chapter-${chapterNumber}.js`);
  vm.runInContext(fs.readFileSync(dataPath, "utf8"), context, { filename: dataPath });
}

const chapters = context.window.QUIZ_DATA.sort((a, b) => a.number - b.number);
const letters = ["A", "B", "C", "D"];

function escapeCell(value) {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, "<br>")
    .trim();
}

const totalQuestions = chapters.reduce((sum, chapter) => sum + chapter.questions.length, 0);
const lines = [
  "# AI基礎講座 クイズ全問題一覧",
  "",
  `全${chapters.length}章・${totalQuestions}問。各問題に4つの選択肢、正解、解説を掲載しています。`,
  "",
  "## 章一覧",
  "",
  "| 章 | テーマ | 問題数 |",
  "|---:|---|---:|",
];

for (const chapter of chapters) {
  lines.push(
    `| 第${chapter.number}章 | ${escapeCell(chapter.title)} | ${chapter.questions.length}問 |`,
  );
}

for (const chapter of chapters) {
  lines.push(
    "",
    `## 第${chapter.number}章：${chapter.title}`,
    "",
    chapter.description,
    "",
    "| No. | 問題 | 選択肢 | 正解 | 解説 |",
    "|---:|---|---|---|---|",
  );

  chapter.questions.forEach((question, index) => {
    const options = question.options
      .map((option, optionIndex) => `${letters[optionIndex]}. ${escapeCell(option)}`)
      .join("<br>");
    const correct = `${letters[question.answer]}. ${escapeCell(question.options[question.answer])}`;
    lines.push(
      `| ${String(index + 1).padStart(2, "0")} | ${escapeCell(question.question)} | ${options} | ${correct} | ${escapeCell(question.explanation)} |`,
    );
  });
}

lines.push("");
fs.writeFileSync(outputPath, lines.join("\n"), "utf8");

console.log(
  JSON.stringify(
    {
      output: outputPath,
      chapters: chapters.length,
      questions: totalQuestions,
      bytes: fs.statSync(outputPath).size,
    },
    null,
    2,
  ),
);
