#!/usr/bin/env node
/**
 * Offline tests for the source-injection engine in main.js.
 *
 *   node scripts/test-source-inject.js
 *
 * The plugin itself runs inside Obsidian, so main.js is loaded here with a minimal
 * "obsidian" module stub. Everything exercised below is the same code the plugin
 * uses at runtime; there is no duplicated implementation to drift out of sync.
 */
const assert = require("assert");
const Module = require("module");
const path = require("path");

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

const pluginModule = require(path.join(__dirname, "..", "main.js"));
const internals = pluginModule.__internals;
if (!internals) throw new Error("main.js did not expose __internals");
const { injectSourceRules, lexJavaScript } = internals;

let failures = 0;
let current = "";

function test(name, run) {
  current = name;
  try {
    run();
    console.log(`  PASS  ${name}`);
  } catch (error) {
    failures += 1;
    console.log(`  FAIL  ${name}`);
    console.log(`        ${error && error.message ? error.message : error}`);
  }
}

function inject(code, rules) {
  return injectSourceRules(code, rules.map((rule, index) => ({
    key: `rule-${index}`,
    source: rule.source,
    target: rule.target,
  })));
}

function assertParses(code, label) {
  try {
    // Parses without executing. Bundles are CommonJS, so a top-level wrapper is safe.
    new Function(code);
  } catch (error) {
    assert.fail(`${label || "bundle"} 注入后无法解析：${error.message}`);
  }
}

function assertContains(haystack, needle, label) {
  assert.ok(
    haystack.includes(needle),
    `${label || "结果"} 缺少预期内容 ${JSON.stringify(needle)}；实际片段：${JSON.stringify(haystack.slice(0, 160))}`,
  );
}

console.log("\nsource-injection engine");

test("普通精确替换只改字符串内容", () => {
  const code = 'var s = "Settings";';
  const result = inject(code, [{ source: "Settings", target: "设置" }]);
  assert.ok(result.ok);
  assert.strictEqual(result.code, 'var s = "设置";');
  assertParses(result.code);
  assert.strictEqual(result.stats.get("rule-0").raw, 1);
});

test("词边界保护不会切开标识符", () => {
  const code = 'var ItemView = 1; var View = 2; var s = "View";';
  const result = inject(code, [{ source: "View", target: "视图" }]);
  assert.ok(result.ok);
  assertContains(result.code, "var ItemView = 1;", "标识符 ItemView 应保持原样");
  assertContains(result.code, "var View = 2;", "标识符 View 应保持原样");
  assertContains(result.code, 'var s = "视图";', "字符串应被翻译");
  assertParses(result.code);
});

test("代码里出现但不在字符串里的文本不会被注入", () => {
  const code = "var Settings = 1;\nfunction apply(){ return Settings; }";
  const result = inject(code, [{ source: "Settings", target: "设置" }]);
  assert.ok(result.ok);
  assert.strictEqual(result.code, code);
});

console.log("\nP0-1 target 转义（不再破坏 main.js）");

test("target 含真实换行时按上下文转义", () => {
  const code = 'var s = "Example:";';
  const result = inject(code, [{ source: "Example:", target: "示例：\n==" }]);
  assert.ok(result.ok);
  assertContains(result.code, '"示例：\\n=="', "真实换行应写成 \\n");
  assertParses(result.code, "换行转义后的 bundle");
});

test("target 含定界引号时被转义", () => {
  const code = 'var s = "Click";';
  const result = inject(code, [{ source: "Click", target: '点"击' }]);
  assert.ok(result.ok);
  assertContains(result.code, '"点\\"击"', "双引号应转义");
  assertParses(result.code, "引号转义后的 bundle");
});

test("单引号字符串中的撇号被转义", () => {
  const code = "var s = 'Click';";
  const result = inject(code, [{ source: "Click", target: "点'击" }]);
  assert.ok(result.ok);
  assertContains(result.code, "'点\\'击'", "单引号应转义");
  assertParses(result.code);
});

test("模板字符串里的真实换行保持原样（合法）", () => {
  const code = "var s = `line1\nline2`;";
  const result = inject(code, [{ source: "line1", target: "第一行\n第二行" }]);
  assert.ok(result.ok);
  assertContains(result.code, "`第一行\n第二行", "模板字面量中的换行不应被转义");
  assertParses(result.code);
});

test("模板字符串里的 ${ 被转义，不会变成插值", () => {
  const code = "var s = `hello`;";
  const result = inject(code, [{ source: "hello", target: "值 ${x}" }]);
  assert.ok(result.ok);
  assertContains(result.code, "\\${x}", "${ 应写为 \\${");
  assertParses(result.code);
  assert.strictEqual(new Function(`${result.code} return s;`)(), "值 ${x}");
});

test("target 以反斜杠结尾时不会吞掉收尾引号", () => {
  const code = 'var s = "path";';
  const result = inject(code, [{ source: "path", target: "C:\\" }]);
  assert.ok(result.ok);
  assertParses(result.code, "反斜杠结尾的 target");
  assert.strictEqual(new Function(`${result.code} return s;`)(), "C:\\");
});

test("target 中成对的转义序列不被二次转义（双变体兼容）", () => {
  const code = 'var s = "\\u4e34\\u8fd1";';
  const result = inject(code, [{ source: "\\u4e34\\u8fd1", target: "\\u5173\\u95ed" }]);
  assert.ok(result.ok);
  assertContains(result.code, '"\\u5173\\u95ed"', "既有转义写法应原样保留");
  assert.ok(!result.code.includes("\\\\u5173"), "不应出现双重反斜杠");
  assertParses(result.code);
});

console.log("\nP0-2 转义形态匹配（自然文本规则即可命中）");

test("\\uXXXX 中文 bundle 可被自然文本规则命中", () => {
  const code = 'var s = "\\u4e34\\u8fd1";';
  const result = inject(code, [{ source: "临近", target: "关闭" }]);
  assert.ok(result.ok);
  assertContains(result.code, '"关闭"', "应命中并写入译文");
  assertParses(result.code, "CJK 转义 bundle");
  assert.strictEqual(result.stats.get("rule-0").decoded, 1);
});

test("\\' 撇号转义的 bundle 可被自然文本规则命中", () => {
  const code = "var s = 'Here\\'s the thing';";
  const result = inject(code, [{ source: "Here's", target: "这里是" }]);
  assert.ok(result.ok);
  assertContains(result.code, "'这里是 the thing'", "撇号转义形态应被识别");
  assertParses(result.code);
});

test('双引号中的 \\n 可被真实换行规则命中', () => {
  const code = 'var s = "Example:\\n==";';
  const result = inject(code, [{ source: "Example:\n==", target: "示例：\n==" }]);
  assert.ok(result.ok);
  assertContains(result.code, '"示例：\\n=="', "应命中并保持转义");
  assertParses(result.code);
});

test("双变体规则与自然文本规则共存时行为不变", () => {
  const code = 'var s = "\\u4e34\\u8fd1";';
  const result = inject(code, [
    { source: "\\u4e34\\u8fd1", target: "\\u5173\\u95ed" },
    { source: "临近", target: "关闭" },
  ]);
  assert.ok(result.ok);
  assertContains(result.code, '"\\u5173\\u95ed"', "先命中的仓库字节变体优先");
  assertParses(result.code);
});

console.log("\n健壮性与诊断");

test("无法解析的 bundle 会被拒绝而不是写坏", () => {
  const code = 'var s = "unterminated;';
  const result = inject(code, [{ source: "unterminated", target: "未闭合" }]);
  assert.strictEqual(result.ok, false);
  assert.ok(result.reason);
  assert.strictEqual(result.code, code);
});

test("正则字面量与注释不会干扰词法扫描", () => {
  const code = 'var re = /[\'"]+/g; // a "quoted" comment\nvar s = "Settings";';
  const result = inject(code, [{ source: "Settings", target: "设置" }]);
  assert.ok(result.ok);
  assertContains(result.code, '"设置"');
  assertContains(result.code, "// a \"quoted\" comment", "注释应原样保留");
  assertParses(result.code);
});

test("零命中规则可被统计出来，并区分代码内出现", () => {
  const code = 'var Missing = 1; // Missing text\nvar s = "Settings";';
  const result = inject(code, [{ source: "Missing", target: "缺失" }]);
  assert.ok(result.ok);
  assert.strictEqual(result.stats.get("rule-0"), undefined, "不应产生命中记录");
  assert.strictEqual(result.code, code);
});

test("命中次数按规则累计（同一字符串多次出现）", () => {
  const code = 'var a = "Save"; var b = "Save"; var c = "Save";';
  const result = inject(code, [{ source: "Save", target: "保存" }]);
  assert.ok(result.ok);
  assert.strictEqual(result.stats.get("rule-0").raw, 3);
  assert.strictEqual((result.code.match(/保存/g) || []).length, 3);
});

console.log("\n词法器自身");

test("字面量位置被正确识别", () => {
  const code = 'var a = "one"; var b = \'two\'; var c = `three ${ "four" } five`;';
  const lexed = lexJavaScript(code);
  assert.ok(lexed.ok);
  assert.strictEqual(lexed.literals.length, 4);
});

test("块注释未闭合时拒绝扫描", () => {
  const lexed = lexJavaScript("var a = 1; /* never ends");
  assert.strictEqual(lexed.ok, false);
});

console.log("\n性能");

test("1.5 MB bundle + 145 条规则在合理时间内完成", () => {
  const chunk = 'function pad(){return "The quick brown fox jumps over the lazy dog";}\n';
  const bundle = chunk.repeat(Math.ceil(1.5 * 1024 * 1024 / chunk.length));
  const rules = [];
  for (let index = 0; index < 145; index += 1) {
    rules.push({ source: `不存在的中文文案${index}`, target: `译文${index}` });
  }
  const started = Date.now();
  const result = inject(bundle, rules);
  const elapsed = Date.now() - started;
  assert.ok(result.ok);
  console.log(`        1.5 MB / 145 条规则耗时 ${elapsed} ms`);
  assert.ok(elapsed < 4000, `耗时 ${elapsed} ms，超出 4 s 预算`);
});

console.log("\n插件层集成（mock vault）");

// Minimal in-memory vault so the real plugin methods can run outside Obsidian.
function createHarness(files) {
  const store = new Map(Object.entries(files));
  const adapter = {
    async exists(target) {
      if (store.has(target)) return true;
      for (const key of store.keys()) if (key.startsWith(`${target}/`)) return true;
      return false;
    },
    async read(target) {
      if (!store.has(target)) throw new Error(`ENOENT ${target}`);
      return store.get(target);
    },
    async write(target, value) {
      store.set(target, value);
    },
    async mkdir(target) {
      if (!store.has(target)) store.set(target, "");
    },
    async list(target) {
      const files = [];
      const folders = new Set();
      for (const key of store.keys()) {
        if (!key.startsWith(`${target}/`)) continue;
        const rest = key.slice(target.length + 1);
        if (rest.includes("/")) folders.add(rest.split("/")[0]);
        else if (rest) files.push(key);
      }
      return { files, folders: [...folders] };
    },
    getConfig() {
      return "";
    },
  };
  const plugin = new pluginModule();
  plugin.app = {
    vault: { adapter, getConfig: () => "" },
    plugins: {
      manifests: {
        "demo-plugin": { dir: ".obsidian/plugins/demo-plugin", version: "1.0.0" },
      },
      enabledPlugins: new Set(),
      disablePlugin: async () => {},
      enablePlugin: async () => {},
    },
  };
  plugin.manifest = { id: "translation-patch", dir: ".obsidian/plugins/translation-patch" };
  plugin.settings = {
    enabled: true,
    applySourcePatches: true,
    translateAttributes: true,
    observeDom: true,
    language: "zh-CN",
    commandIntervalMs: 5000,
    inlinePatches: [],
  };
  plugin.patches = [];
  plugin.compiledEntries = [];
  plugin.ruleStats = new Map();
  plugin.exactEntriesBySource = new Map();
  plugin.regexEntries = [];
  plugin.runtimeEntries = [];
  plugin.commandExactBySource = new Map();
  plugin.commandRegexEntries = [];
  plugin.styleSettingsPatchRevision = 0;
  plugin.sourceVersionSnapshot = new Map();
  plugin.sourcePatchReport = { applied: [], skipped: [], errors: [], zeroHit: 0, invalid: 0 };
  plugin.configuredThemeName = "";
  return { plugin, store };
}

const demoBundle = [
  'var a = "\\u4e34\\u8fd1";',
  'var b = "Due";',
  'var c = "这条不会用到";',
  'function demo(){ return a + b + c; }',
].join("\n");

async function runIntegration() {
  const { plugin, store } = createHarness({
    ".obsidian/plugins/demo-plugin/main.js": demoBundle,
  });
  plugin.patches = [plugin.validatePatch({
    schemaVersion: 1,
    id: "demo-zh",
    name: "Demo 中文",
    language: "zh-CN",
    target: { pluginId: "demo-plugin" },
    translations: [
      { source: "临近", target: "关闭" },
      { source: "Due", target: "到期" },
      { source: "没有这条", target: "不会命中" },
      { source: "这条不会用到", target: "忽略", injectSource: false },
    ],
  }, "test", [])].filter(Boolean);

  plugin.compilePatches();
  await plugin.applySourcePatches();

  const mainPath = ".obsidian/plugins/demo-plugin/main.js";
  const written = store.get(mainPath);
  assertContains(written, '"关闭"', "CJK 转义应在插件层被命中");
  assertContains(written, '"到期"', "普通规则应在插件层被命中");
  assertContains(written, '"这条不会用到"', "injectSource:false 的规则不应注入");
  assertParses(written, "插件层注入结果");
  assert.deepStrictEqual(plugin.sourcePatchReport.applied, ["demo-plugin"]);

  const backupPath = ".obsidian/plugins/translation-patch/backups/demo-plugin/1.0.0/main.js";
  assert.strictEqual(store.get(backupPath), demoBundle, "应保留原始备份");

  const zero = plugin.listSourceZeroHitRules();
  assert.strictEqual(zero.length, 1, "应只有一条源码零命中规则");
  assert.strictEqual(zero[0].source, "没有这条");

  await plugin.restoreSourcePatches(false);
  assert.strictEqual(store.get(mainPath), demoBundle, "恢复备份应还原源码");
}

runIntegration()
  .then(() => console.log("  PASS  插件层注入 / 备份 / 恢复 / 零命中统计"))
  .catch((error) => {
    failures += 1;
    console.log("  FAIL  插件层注入 / 备份 / 恢复 / 零命中统计");
    console.log(`        ${error && error.message ? error.message : error}`);
  })
  .then(() => {
    console.log("");
    if (failures) {
      console.log(`${failures} 个用例失败\n`);
      process.exit(1);
    }
    console.log("全部用例通过\n");
  });

