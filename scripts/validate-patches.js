#!/usr/bin/env node
/**
 * Schema-level validation for translation patch files.
 *
 *   node scripts/validate-patches.js [dir-or-file ...]
 *
 * Implements the invariants from skills/obsidian-translation-patch/references/patch-format.md
 * that do not need a target bundle: required fields, regex compilation, duplicate rules,
 * placeholder compatibility and source-injection hazards.
 *
 * Exit code 1 means at least one error was found. Warnings do not fail the run.
 */
const fs = require("fs");
const path = require("path");

const DEFAULT_PATHS = ["patches"];
const GENERIC_TOKENS = new Set([
  "none", "true", "false", "auto", "block", "flex", "grid", "inline",
  "hidden", "default", "normal", "inherit", "initial", "unset", "visible",
]);

let errors = 0;
let warnings = 0;
const report = {
  error(message) {
    errors += 1;
    console.log(`  ERROR  ${message}`);
  },
  warn(message) {
    warnings += 1;
    console.log(`  WARN   ${message}`);
  },
};

function trimBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function listFiles(target) {
  const stat = fs.statSync(target);
  if (stat.isFile()) return [target];
  return fs
    .readdirSync(target)
    .filter((name) => name.toLowerCase().endsWith(".json"))
    .map((name) => path.join(target, name));
}

function countMatches(text, pattern) {
  const matches = text.match(pattern);
  return matches ? matches.length : 0;
}

// Placeholders that change program behaviour if dropped or renamed.
function criticalTokens(text) {
  return {
    interpolation: countMatches(text, /\$\{[^}]*\}/g) + countMatches(text, /\{\{[^}]*\}\}/g),
    printf: countMatches(text, /%(?:\d+\$)?[sdif]/g),
    indexed: countMatches(text, /\$\d+/g),
    braces: countMatches(text, /\{\d+\}/g),
  };
}

// Only real HTML tags count as markup. Plugins also render pseudo-tags such as
// "<empty list>" or "<function>" as plain text, and treating those as markup would
// bury the real findings in noise.
const HTML_TAGS = [
  "a", "b", "i", "em", "strong", "code", "pre", "span", "div", "br", "hr", "p",
  "small", "sup", "sub", "kbd", "mark", "s", "u", "ul", "ol", "li", "table",
  "thead", "tbody", "tr", "td", "th", "blockquote", "img", "svg", "path",
  "button", "input", "label", "details", "summary", "del", "ins", "figure",
];
const TAG_PATTERN = new RegExp(`<\\/?(${HTML_TAGS.join("|")})(?:\\s[^<>]*)?\\/?>`, "gi");

// Markup that should normally survive translation, but where a deliberate change is
// acceptable (for example removing a redundant <b> wrapper).
function markupTokens(text) {
  return {
    tags: countMatches(text, TAG_PATTERN),
    links: countMatches(text, /\[[^\]]*\]\([^)]*\)/g),
    code: countMatches(text, /`[^`]*`/g),
  };
}

function validatePatch(patch, file, index) {
  const label = `${path.basename(file)}${index ? `[${index}]` : ""}`;
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    report.error(`${label}：顶层必须是对象`);
    return;
  }
  if (!patch.id || typeof patch.id !== "string") {
    report.error(`${label}：缺少字符串 id`);
    return;
  }
  if (!Array.isArray(patch.translations) || !patch.translations.length) {
    report.error(`${label}：缺少非空 translations 数组`);
    return;
  }
  const schemaVersion = Number(patch.schemaVersion || 1);
  if (!Number.isFinite(schemaVersion) || schemaVersion < 1) {
    report.error(`${label}：schemaVersion 非法（${patch.schemaVersion}）`);
  }
  const target = patch.target && typeof patch.target === "object" ? patch.target : {};
  const theme = target.theme ? String(target.theme) : "";
  const pluginId = target.pluginId ? String(target.pluginId) : "";
  const sourceInjection = target.source !== false;
  const seen = new Map();

  patch.translations.forEach((entry, position) => {
    const where = `${label} 第 ${position + 1} 条`;
    if (!entry || typeof entry !== "object") {
      report.error(`${where}：不是对象`);
      return;
    }
    if (typeof entry.source !== "string" || !entry.source) {
      report.error(`${where}：source 必须是非空字符串（规则级源码开关请用 injectSource）`);
      return;
    }
    if (typeof entry.target !== "string") {
      report.error(`${where}：target 必须是字符串`);
      return;
    }
    if (entry.injectSource != null && typeof entry.injectSource !== "boolean") {
      report.error(`${where}：injectSource 只能是布尔值`);
    }
    if (entry.regex) {
      try {
        // eslint-disable-next-line no-new
        new RegExp(entry.source, entry.flags || "");
      } catch (error) {
        report.error(`${where}：正则无法编译 — ${error.message}`);
      }
      const groups = (entry.source.match(/(^|[^\\])\((?!\?)/g) || []).length;
      const used = new Set((entry.target.match(/\$(\d+)/g) || []).map((item) => Number(item.slice(1))));
      for (const group of used) {
        if (group > groups) report.error(`${where}：target 引用了不存在的捕获组 $${group}（source 只有 ${groups} 个）`);
      }
    }

    const key = [pluginId, theme, entry.selector || "", entry.source].join("\u0000");
    if (seen.has(key)) {
      const previous = seen.get(key);
      if (previous.target !== entry.target) report.error(`${where}：与第 ${previous.position + 1} 条重复且译文冲突`);
      else report.warn(`${where}：与第 ${previous.position + 1} 条完全重复`);
    } else {
      seen.set(key, { position, target: entry.target });
    }

    const sourceTokens = criticalTokens(entry.source);
    const targetTokens = criticalTokens(entry.target);
    for (const name of ["interpolation", "printf", "braces"]) {
      if (sourceTokens[name] !== targetTokens[name]) {
        report.error(`${where}：占位符数量不一致（${name} ${sourceTokens[name]} → ${targetTokens[name]}）`);
      }
    }
    // "$1" is a capture reference, not a placeholder: for regex rules it belongs in the
    // target only, and the group-count check above already bound it.
    if (!entry.regex && sourceTokens.indexed !== targetTokens.indexed) {
      report.error(`${where}：占位符数量不一致（numbered ${sourceTokens.indexed} → ${targetTokens.indexed}）`);
    }
    const sourceMarkup = markupTokens(entry.source);
    const targetMarkup = markupTokens(entry.target);
    for (const name of ["tags", "links", "code"]) {
      if (sourceMarkup[name] !== targetMarkup[name]) {
        report.warn(`${where}：标记数量变化（${name} ${sourceMarkup[name]} → ${targetMarkup[name]}），请人工确认`);
      }
    }

    if (sourceInjection && !entry.regex && !entry.selector && entry.injectSource !== false) {
      const plain = entry.source.trim().toLowerCase();
      if (GENERIC_TOKENS.has(plain)) {
        report.warn(`${where}：通用词 "${entry.source}" 会参与源码注入，建议加 selector 或 injectSource:false`);
      }
      if (/^(https?:|www\.)/i.test(entry.source)) {
        report.warn(`${where}：看起来是 URL，源码注入可能改动链接`);
      }
    }
    if (entry.source === entry.target) {
      report.warn(`${where}：source 与 target 相同，建议删除该规则`);
    }
  });
}

const targets = process.argv.slice(2);
const inputs = targets.length ? targets : DEFAULT_PATHS;
let files = [];
for (const input of inputs) {
  if (!fs.existsSync(input)) {
    console.log(`跳过不存在的路径：${input}`);
    continue;
  }
  files = files.concat(listFiles(input));
}
if (!files.length) {
  console.log("没有找到补丁文件。");
  process.exit(0);
}

console.log(`校验 ${files.length} 个补丁文件\n`);
let totalRules = 0;
for (const file of files) {
  let parsed;
  try {
    parsed = JSON.parse(trimBom(fs.readFileSync(file, "utf8")));
  } catch (error) {
    report.error(`${path.basename(file)}：JSON 解析失败 — ${error.message}`);
    continue;
  }
  const patches = Array.isArray(parsed) ? parsed : [parsed];
  patches.forEach((patch, index) => {
    if (patch && Array.isArray(patch.translations)) totalRules += patch.translations.length;
    validatePatch(patch, file, patches.length > 1 ? index : 0);
  });
}

console.log(`\n共 ${totalRules} 条规则；错误 ${errors}，警告 ${warnings}`);
process.exit(errors ? 1 : 0);
