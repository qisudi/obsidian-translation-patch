#!/usr/bin/env node
/**
 * Validate a patch against a real bundled main.js without Obsidian.
 *
 *   node scripts/validate-source-patch.js <target-main.js> <patch.json> [out.js]
 *
 * Runs the exact injection engine the plugin uses (main.js is shared, not copied),
 * reports per-rule hit counts, and refuses to write output that no longer parses.
 * Exit code 1 means at least one rule or the resulting bundle failed validation.
 */
const fs = require("fs");
const path = require("path");
const Module = require("module");

const obsidianStub = {
  Plugin: class Plugin {},
  PluginSettingTab: class PluginSettingTab {},
  Setting: class Setting {},
  Notice: class Notice {},
  Modal: class Modal {},
};
const originalLoad = Module._load;
Module._load = function load(request, ...rest) {
  if (request === "obsidian") return obsidianStub;
  return originalLoad.call(this, request, ...rest);
};

const { injectSourceRules, PATCH_SCHEMA_VERSION } = require(path.join(__dirname, "..", "main.js")).__internals;

const [sourcePath, patchPath, outputPath] = process.argv.slice(2);
if (!sourcePath || !patchPath) {
  console.error("用法: node scripts/validate-source-patch.js <target-main.js> <patch.json> [out.js]");
  process.exit(2);
}

const code = fs.readFileSync(sourcePath, "utf8");
const rawPatch = JSON.parse(fs.readFileSync(patchPath, "utf8"));
const patches = Array.isArray(rawPatch) ? rawPatch : [rawPatch];

let failed = false;
const rules = [];

for (const patch of patches) {
  const schemaVersion = Number(patch.schemaVersion || 1);
  if (schemaVersion > PATCH_SCHEMA_VERSION) {
    console.error(`! ${patch.id}: schemaVersion ${patch.schemaVersion} 高于插件支持的 ${PATCH_SCHEMA_VERSION}`);
    failed = true;
    continue;
  }
  if (!patch.id || !Array.isArray(patch.translations)) {
    console.error(`! 补丁缺少 id 或 translations：${JSON.stringify(patch).slice(0, 80)}`);
    failed = true;
    continue;
  }
  if (patch.target && patch.target.source === false) {
    console.log(`- ${patch.id}: target.source=false，跳过源码注入（仍可用于运行时）`);
    continue;
  }
  for (const entry of patch.translations) {
    if (!entry || typeof entry !== "object") continue;
    if (entry.regex || entry.selector) continue;
    if (entry.injectSource === false) continue;
    if (entry.source === entry.target) continue;
    if (typeof entry.source !== "string" || typeof entry.target !== "string") {
      console.error(`! ${patch.id}: 规则的 source/target 必须是字符串`);
      failed = true;
      continue;
    }
    rules.push({ key: `${patch.id}\u0000${entry.source}`, source: entry.source, target: entry.target });
  }
}

rules.sort((a, b) => b.source.length - a.source.length);
const result = injectSourceRules(code, rules);
if (!result.ok) {
  console.error(`! 目标 bundle 无法解析：${result.reason}`);
  process.exit(1);
}

const zero = [];
for (const rule of rules) {
  const stat = result.stats.get(rule.key);
  const hits = stat ? stat.raw + stat.decoded : 0;
  if (!hits) zero.push(rule);
}

const injected = rules.length - zero.length;
console.log(`规则：${rules.length} 条，命中 ${injected} 条，零命中 ${zero.length} 条`);
console.log(`转义目标被拒绝：${result.invalid} 次`);

if (zero.length) {
  failed = true;
  console.log("\n零命中规则：");
  for (const rule of zero.slice(0, 50)) {
    console.log(`  - ${JSON.stringify(rule.source.slice(0, 80))}`);
  }
  if (zero.length > 50) console.log(`  … 还有 ${zero.length - 50} 条`);
}

// Parsing the output is the final gate: never hand back a broken bundle.
try {
  new Function(result.code);
} catch (error) {
  console.error(`\n! 注入结果无法解析：${error.message}`);
  process.exit(1);
}

if (outputPath) {
  fs.writeFileSync(outputPath, result.code, "utf8");
  console.log(`\n已写入 ${outputPath}（${result.code.length} 字符）`);
}

process.exit(failed ? 1 : 0);
