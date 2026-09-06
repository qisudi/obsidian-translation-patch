const { Plugin, PluginSettingTab, Setting, Notice, Modal } = require("obsidian");

const DEFAULT_SETTINGS = {
  enabled: true,
  applySourcePatches: true,
  translateAttributes: true,
  observeDom: true,
  language: "zh-CN",
  commandIntervalMs: 5000,
  inlinePatches: [],
};

const PATCH_SCHEMA_VERSION = 1;
const LANGUAGE_LABELS = {
  auto: "跟随 Obsidian",
  "zh-CN": "简体中文",
  "zh-TW": "繁體中文",
  en: "English",
  ja: "日本語",
  ko: "한국어",
  de: "Deutsch",
  fr: "Français",
  es: "Español",
  pt: "Português",
  "pt-BR": "Português (Brasil)",
  ru: "Русский",
  it: "Italiano",
};
const TRANSLATABLE_ATTRIBUTES = [
  "aria-label",
  "aria-description",
  "title",
  "data-tooltip",
  "placeholder",
  "alt",
];

function normaliseText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normaliseLocale(value) {
  const raw = normaliseText(value).replace(/_/g, "-");
  if (!raw) return "";
  const lower = raw.toLocaleLowerCase();
  if (lower === "auto" || lower === "default" || lower === "all" || lower === "*") return lower === "default" ? "" : lower;
  const aliases = {
    zh: "zh-CN",
    "zh-cn": "zh-CN",
    "zh-hans": "zh-CN",
    "zh-sg": "zh-CN",
    "zh-my": "zh-CN",
    "zh-tw": "zh-TW",
    "zh-hant": "zh-TW",
    "zh-hk": "zh-TW",
    "zh-mo": "zh-TW",
    "pt-br": "pt-BR",
  };
  if (aliases[lower]) return aliases[lower];
  if (lower.startsWith("zh-hans-")) return "zh-CN";
  if (lower.startsWith("zh-hant-")) return "zh-TW";
  const parts = raw.split("-").filter(Boolean);
  if (parts.length === 1) return parts[0].toLocaleLowerCase();
  return `${parts[0].toLocaleLowerCase()}-${parts.slice(1).map((part) => part.length === 2 || part.length === 3 ? part.toUpperCase() : part).join("-")}`;
}

function localeBase(value) {
  return normaliseLocale(value).split("-")[0];
}

function inferLocaleFromSource(source) {
  const name = String(source || "").split(/[\\/]/).pop().toLocaleLowerCase();
  const match = name.match(/(?:^|[-_.])(zh[-_]?cn|zh[-_]?tw|zh[-_]?hans|zh[-_]?hant|zh|en|ja|ko|de|fr|es|pt[-_]?br|pt|ru|it)(?:[-_.]|$)/i);
  if (!match) return "";
  return normaliseLocale(match[1]);
}

function isElement(node) {
  return node && node.nodeType === 1;
}

function isIgnoredElement(element) {
  if (!isElement(element)) return true;
  return Boolean(element.closest("script, style, code, pre, textarea, .translation-patch-ignore"));
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function safeRegex(source, flags) {
  try {
    return new RegExp(source, flags || "");
  } catch (_error) {
    return null;
  }
}

function isWordCharacter(value) {
  return value != null && /[A-Za-z0-9_$]/.test(value);
}

function replaceSourceLiteral(code, source, target) {
  if (!source || source === target) return code;
  let result = "";
  let cursor = 0;
  while (cursor < code.length) {
    const index = code.indexOf(source, cursor);
    if (index < 0) {
      result += code.slice(cursor);
      break;
    }
    const before = index > 0 ? code[index - 1] : "";
    const after = code[index + source.length] || "";
    const bounded = !isWordCharacter(source[0]) || !isWordCharacter(before);
    const boundedEnd = !isWordCharacter(source[source.length - 1]) || !isWordCharacter(after);
    result += code.slice(cursor, index);
    if (bounded && boundedEnd) {
      result += target;
      cursor = index + source.length;
    } else {
      result += source;
      cursor = index + source.length;
    }
  }
  return result;
}

class TranslationPatchPlugin extends Plugin {
  async onload() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    this.settings.inlinePatches = asArray(this.settings.inlinePatches);
    this.settings.language = normaliseLocale(this.settings.language) || DEFAULT_SETTINGS.language;
    this.patches = [];
    this.compiledEntries = [];
    this.observer = null;
    this.observerFrame = null;
    this.observerTextNodes = new Set();
    this.observerAttributeNodes = new Set();
    this.observerAddedNodes = new Set();
    this.lastCommandPatch = 0;
    this.originalCommandNames = new Map();
    this.textSnapshots = new Map();
    this.attributeSnapshots = new Map();
    this.lastLoadReport = { folders: [], files: [], errors: [] };
    this.sourcePatchReport = { applied: [], skipped: [], errors: [] };
    this.sourceVersionSnapshot = new Map();
    this.sourcePatchCheckRunning = false;
    this.lastSourcePatchCheck = 0;
    this.configuredThemeName = "";
    this.styleSettingsSnapshots = new Map();
    this.styleSettingsHooks = new Map();
    this.styleSettingsSyncState = null;
    this.styleSettingsPatchRevision = 0;
    this.exactEntriesBySource = new Map();
    this.regexEntries = [];
    this.runtimeEntries = [];
    this.needsFullTranslation = true;
    this.fullTranslationHandle = null;
    this.fullTranslationUsesIdle = false;
    this.sourceContextChanged = false;
    await this.updateActiveThemeFromConfig(false);
    this.activeThemeKey = this.getActiveThemeKey();
    this.activeLanguageKey = this.getActiveLanguageKey();

    this.addSettingTab(new TranslationPatchSettingTab(this.app, this));
    this.addCommand({
      id: "reload-translation-patches",
      name: "重新加载汉化补丁",
      callback: () => this.reloadPatches(true),
    });
    this.addCommand({
      id: "toggle-translation-patches",
      name: "启用/停用汉化补丁",
      callback: async () => {
        this.settings.enabled = !this.settings.enabled;
        await this.saveSettings();
        this.needsFullTranslation = true;
        this.refresh(true);
        new Notice(this.settings.enabled ? "汉化补丁已启用" : "汉化补丁已停用");
      },
    });
    this.addCommand({
      id: "restore-source-patches",
      name: "恢复源码补丁备份",
      callback: () => this.restoreSourcePatches(true),
    });

    this.registerEvent(this.app.workspace.on("layout-ready", () => this.refresh(true)));
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.refresh(false)));
    this.registerEvent(this.app.workspace.on("css-change", () => {
      window.setTimeout(() => this.updateActiveThemeFromConfig(true), 100);
    }));
    // Keep periodic work for command/source-version checks, but do not rescan the
    // entire document on every tick. Older saved settings used 1500 ms; migrate
    // that legacy default to the lighter 5-second interval.
    const configuredInterval = Number(this.settings.commandIntervalMs);
    const commandIntervalMs = Math.max(1000, configuredInterval === 1500 ? DEFAULT_SETTINGS.commandIntervalMs : (configuredInterval || DEFAULT_SETTINGS.commandIntervalMs));
    this.registerInterval(window.setInterval(() => this.refresh(false), commandIntervalMs));
    await this.ensurePatchesFolder();
    await this.reloadPatches(false);
    this.startObserver();
  }

  onunload() {
    this.settings.enabled = false;
    this.cancelFullTranslation();
    this.restoreDom();
    this.patchCommands();
    this.stopObserver();
  }

  get patchesFolder() {
    const dir = this.manifest && this.manifest.dir ? String(this.manifest.dir).replace(/\\/g, "/") : "";
    return `${dir || `.obsidian/plugins/${this.manifest.id}`}/patches`;
  }

  get patchesFolders() {
    return [...new Set([
      this.patchesFolder,
      `.obsidian/plugins/${this.manifest.id}/patches`,
      `plugins/${this.manifest.id}/patches`,
    ])];
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  async ensurePatchesFolder() {
    try {
      if (!(await this.app.vault.adapter.exists(this.patchesFolder))) {
        await this.app.vault.adapter.mkdir(this.patchesFolder);
      }
    } catch (_error) {
      // A read-only or restricted vault can still use inline patches.
    }
  }

  async reloadPatches(showNotice) {
    const loaded = [];
    const errors = [];
    const files = [];
    const folders = [];

    for (const patch of this.settings.inlinePatches) {
      const checked = this.validatePatch(patch, "内置补丁");
      if (checked) loaded.push(checked);
      else errors.push("内置补丁格式无效");
    }

    for (const folder of this.patchesFolders) {
      try {
        const listing = await this.app.vault.adapter.list(folder);
        folders.push(folder);
        for (const path of asArray(listing.files)) {
          if (!path.toLowerCase().endsWith(".json") || files.includes(path)) continue;
          files.push(path);
          try {
            const parsed = JSON.parse(await this.app.vault.adapter.read(path));
            const values = Array.isArray(parsed) ? parsed : [parsed];
            values.forEach((value) => {
              const checked = this.validatePatch(value, path);
              if (checked) loaded.push(checked);
              else errors.push(`${path} 格式无效`);
            });
          } catch (error) {
            errors.push(`${path} 无法读取`);
          }
        }
      } catch (_error) {
        // Missing candidate folders are expected on different Obsidian versions.
      }
    }

    this.patches = loaded.filter((patch) => patch.enabled !== false);
    this.compilePatches();
    this.lastLoadReport = { folders, files, errors };
    if (this.settings.applySourcePatches) await this.applySourcePatches();
    this.needsFullTranslation = true;
    this.refresh(true);
    if (showNotice) {
      const message = `已加载 ${this.patches.length} 个汉化补丁（${this.compiledEntries.length} 条规则）`;
      const sourceCount = this.sourcePatchReport.applied.length;
      const sourceMessage = sourceCount ? `；已注入 ${sourceCount} 个插件源码` : "";
      new Notice(errors.length ? `${message}${sourceMessage}；${errors.length} 个文件被跳过` : `${message}${sourceMessage}`);
    }
  }

  get pluginRoot() {
    const dir = this.manifest && this.manifest.dir ? String(this.manifest.dir).replace(/\\/g, "/") : "";
    return dir || `.obsidian/plugins/${this.manifest.id}`;
  }

  get sourceBackupRoot() {
    return `${this.pluginRoot}/backups`;
  }

  async findPluginMainPath(pluginId) {
    const manifest = this.app.plugins && this.app.plugins.manifests ? this.app.plugins.manifests[pluginId] : null;
    const candidates = [];
    if (manifest && manifest.dir) candidates.push(`${String(manifest.dir).replace(/\\/g, "/")}/main.js`);
    candidates.push(`.obsidian/plugins/${pluginId}/main.js`, `plugins/${pluginId}/main.js`);
    for (const candidate of [...new Set(candidates)]) {
      try {
        if (await this.app.vault.adapter.exists(candidate)) return candidate;
      } catch (_error) {
        // Continue with the next path candidate.
      }
    }
    return null;
  }

  getPluginVersion(pluginId) {
    const manifest = this.app.plugins && this.app.plugins.manifests ? this.app.plugins.manifests[pluginId] : null;
    return manifest && manifest.version ? String(manifest.version).replace(/[^A-Za-z0-9._-]/g, "_") : "unknown";
  }

  getSourceBackupPath(pluginId) {
    return `${this.sourceBackupRoot}/${pluginId}/${this.getPluginVersion(pluginId)}/main.js`;
  }

  async applySourcePatches() {
    const applied = [];
    const skipped = [];
    const errors = [];
    const reloaded = new Set();
    const groups = new Map();
    for (const patch of this.patches) {
      if (!this.patchMatchesEnvironment(patch)) continue;
      const pluginId = patch.target && patch.target.pluginId ? String(patch.target.pluginId) : "";
      if (!pluginId || patch.target.source === false) continue;
      if (!groups.has(pluginId)) groups.set(pluginId, []);
      groups.get(pluginId).push(patch);
    }

    for (const [pluginId, pluginPatches] of groups) {
      const mainPath = await this.findPluginMainPath(pluginId);
      if (!mainPath) {
        skipped.push(`${pluginId}（未找到 main.js）`);
        continue;
      }

      try {
        const current = await this.app.vault.adapter.read(mainPath);
        this.sourceVersionSnapshot.set(pluginId, this.getPluginVersion(pluginId));
        const backupPath = this.getSourceBackupPath(pluginId);
        if (!(await this.app.vault.adapter.exists(backupPath))) {
          const legacyBackupPath = `${this.sourceBackupRoot}/${pluginId}/main.js`;
          await this.app.vault.adapter.mkdir(this.sourceBackupRoot).catch(() => {});
          await this.app.vault.adapter.mkdir(`${this.sourceBackupRoot}/${pluginId}`).catch(() => {});
          await this.app.vault.adapter.mkdir(`${this.sourceBackupRoot}/${pluginId}/${this.getPluginVersion(pluginId)}`).catch(() => {});
          const looksAlreadyPatched = pluginPatches.some((patch) =>
            patch.translations.some((entry) => !entry.regex && entry.target && current.includes(entry.target))
          );
          if (looksAlreadyPatched && await this.app.vault.adapter.exists(legacyBackupPath)) {
            await this.app.vault.adapter.write(backupPath, await this.app.vault.adapter.read(legacyBackupPath));
          } else {
            await this.app.vault.adapter.write(backupPath, current);
          }
        }

        // Always rebuild from the untouched backup. This makes editing a translation and
        // clicking “reload” work even when the current main.js already contains an older translation.
        const original = await this.app.vault.adapter.read(backupPath);
        let translated = original;
        const sourceEntries = pluginPatches.flatMap((patch) => patch.translations)
          // Selector-scoped rules are deliberately runtime-only. Their source text may be
          // a generic token such as a CSS value (for example "none") that is unsafe to
          // replace throughout a bundled JavaScript file.
          .filter((entry) => !entry.regex && !entry.selector && entry.source !== entry.target)
          .sort((a, b) => b.source.length - a.source.length);
        for (const entry of sourceEntries) {
          // Source mode deliberately applies exact strings only. Regex rules can be marked
          // sourceRegex: true in a future patch when their scope is proven safe.
          translated = replaceSourceLiteral(translated, entry.source, entry.target);
        }

        if (translated === current) {
          skipped.push(`${pluginId}（无可替换字符串）`);
          continue;
        }
        await this.app.vault.adapter.write(mainPath, translated);
        applied.push(pluginId);

        const enabled = this.app.plugins.enabledPlugins && this.app.plugins.enabledPlugins.has(pluginId);
        if (enabled && !reloaded.has(pluginId) && this.app.plugins.disablePlugin && this.app.plugins.enablePlugin) {
          reloaded.add(pluginId);
          await this.app.plugins.disablePlugin(pluginId);
          await this.app.plugins.enablePlugin(pluginId);
        }
      } catch (error) {
        errors.push(`${pluginId}: ${error && error.message ? error.message : "写入失败"}`);
      }
    }
    this.sourcePatchReport = { applied, skipped, errors };
  }

  async restoreSourcePatches(showNotice) {
    const restored = [];
    const errors = [];
    const pluginIds = [...new Set(this.patches
      .map((patch) => patch.target && patch.target.pluginId ? String(patch.target.pluginId) : "")
      .filter(Boolean))];
    for (const pluginId of pluginIds) {
      try {
        let backupPath = this.getSourceBackupPath(pluginId);
        if (!(await this.app.vault.adapter.exists(backupPath))) {
          const legacyBackupPath = `${this.sourceBackupRoot}/${pluginId}/main.js`;
          if (await this.app.vault.adapter.exists(legacyBackupPath)) backupPath = legacyBackupPath;
          else continue;
        }
        const mainPath = await this.findPluginMainPath(pluginId);
        if (!mainPath) continue;
        await this.app.vault.adapter.write(mainPath, await this.app.vault.adapter.read(backupPath));
        restored.push(pluginId);
        if (this.app.plugins.enabledPlugins && this.app.plugins.enabledPlugins.has(pluginId) && this.app.plugins.disablePlugin && this.app.plugins.enablePlugin) {
          await this.app.plugins.disablePlugin(pluginId);
          await this.app.plugins.enablePlugin(pluginId);
        }
      } catch (error) {
        errors.push(`${pluginId}: ${error && error.message ? error.message : "恢复失败"}`);
      }
    }
    if (showNotice) new Notice(errors.length ? `已恢复 ${restored.length} 个插件；${errors.length} 个恢复失败` : `已恢复 ${restored.length} 个插件源码`);
  }

  validatePatch(patch, source) {
    if (!patch || typeof patch !== "object") return null;
    if (!patch.id || !Array.isArray(patch.translations)) return null;
    const target = patch.target && typeof patch.target === "object" ? patch.target : {};
    const language = normaliseLocale(
      patch.language ?? patch.locale ?? target.language ?? target.locale ?? inferLocaleFromSource(source),
    ) || DEFAULT_SETTINGS.language;
    return {
      schemaVersion: patch.schemaVersion || PATCH_SCHEMA_VERSION,
      id: String(patch.id),
      name: String(patch.name || patch.id),
      enabled: patch.enabled !== false,
      language,
      target,
      translations: patch.translations
        .filter((entry) => entry && typeof entry === "object" && entry.source != null && entry.target != null)
        .map((entry) => ({
          source: String(entry.source),
          target: String(entry.target),
          regex: Boolean(entry.regex),
          flags: String(entry.flags || ""),
          attributes: entry.attributes == null ? true : Boolean(entry.attributes),
          selector: entry.selector ? String(entry.selector) : "",
        })),
      source,
    };
  }

  compilePatches() {
    this.compiledEntries = [];
    this.exactEntriesBySource.clear();
    this.regexEntries = [];
    this.runtimeEntries = [];
    this.styleSettingsPatchRevision += 1;
    for (const patch of this.patches) {
      if (!this.patchMatchesEnvironment(patch)) continue;
      for (const entry of patch.translations) {
        const compiled = {
          patch,
          entry,
          regex: entry.regex ? safeRegex(entry.source, entry.flags) : null,
        };
        this.compiledEntries.push(compiled);
        if (compiled.regex) {
          this.regexEntries.push(compiled);
          this.runtimeEntries.push(compiled);
        } else {
          const sourceKey = normaliseText(entry.source);
          if (!this.exactEntriesBySource.has(sourceKey)) this.exactEntriesBySource.set(sourceKey, []);
          this.exactEntriesBySource.get(sourceKey).push(compiled);
          if (entry.selector || (patch.target && patch.target.selector)) this.runtimeEntries.push(compiled);
        }
      }
    }
  }

  getActiveThemeName() {
    try {
      if (this.configuredThemeName) return normaliseText(this.configuredThemeName);
      const configured = this.app.vault && this.app.vault.getConfig
        ? this.app.vault.getConfig("cssTheme")
        : "";
      const runtime = this.app.customCss && this.app.customCss.theme
        ? this.app.customCss.theme
        : "";
      return normaliseText(configured || runtime || "");
    } catch (_error) {
      return "";
    }
  }

  getConfiguredLanguage() {
    const values = [];
    try {
      if (this.app.vault && typeof this.app.vault.getConfig === "function") {
        values.push(this.app.vault.getConfig("language"));
        values.push(this.app.vault.getConfig("locale"));
      }
    } catch (_error) {
      // Continue with browser locale fallback.
    }
    try {
      if (typeof navigator !== "undefined" && navigator.language) values.push(navigator.language);
    } catch (_error) {
      // Some mobile webviews do not expose navigator.language.
    }
    return values.map((value) => normaliseLocale(value)).find(Boolean) || "en";
  }

  getActiveLanguageKey() {
    const selected = normaliseLocale(this.settings && this.settings.language);
    return selected && selected !== "auto" ? selected : this.getConfiguredLanguage();
  }

  getLanguageLabel(locale) {
    const key = normaliseLocale(locale);
    return LANGUAGE_LABELS[key] || key || "未知语言";
  }

  getPatchLanguage(patch) {
    if (!patch) return DEFAULT_SETTINGS.language;
    return normaliseLocale(patch.language) || DEFAULT_SETTINGS.language;
  }

  getLanguageOptions() {
    const options = new Map(Object.entries(LANGUAGE_LABELS));
    const selected = normaliseLocale(this.settings && this.settings.language);
    if (selected && !options.has(selected)) options.set(selected, selected);
    for (const patch of this.patches || []) {
      const locale = this.getPatchLanguage(patch);
      if (locale && locale !== "all" && locale !== "*") {
        if (!options.has(locale)) options.set(locale, locale);
      }
    }
    const ordered = [];
    if (options.has("auto")) ordered.push(["auto", options.get("auto")]);
    for (const [locale, label] of options) {
      if (locale !== "auto") ordered.push([locale, label]);
    }
    return ordered;
  }

  async setLanguage(value) {
    const next = normaliseLocale(value) || DEFAULT_SETTINGS.language;
    if (next === this.settings.language) return;
    this.settings.language = next;
    await this.saveSettings();
    this.refreshPatchContext();
    if (this.settings.enabled && this.settings.applySourcePatches) {
      await this.restoreSourcePatches(false);
      await this.applySourcePatches();
    }
    this.sourceContextChanged = false;
    this.needsFullTranslation = true;
    this.refresh(true);
  }

  async updateActiveThemeFromConfig(refresh) {
    try {
      const configDir = this.app.vault && this.app.vault.configDir
        ? String(this.app.vault.configDir).replace(/\\/g, "/")
        : ".obsidian";
      const raw = await this.app.vault.adapter.read(`${configDir}/appearance.json`);
      const appearance = JSON.parse(raw);
      this.configuredThemeName = appearance && appearance.cssTheme
        ? String(appearance.cssTheme)
        : "";
    } catch (_error) {
      // The runtime customCss value remains a fallback when appearance.json is absent.
    }
    if (refresh) this.refresh();
  }

  getActiveThemeKey() {
    return this.getActiveThemeName().toLocaleLowerCase();
  }

  patchMatchesLanguage(patch) {
    const requested = this.getPatchLanguage(patch);
    if (!requested || requested === "all" || requested === "*" || requested === "auto") return true;
    const active = this.getActiveLanguageKey();
    if (!active) return true;
    if (requested === active) return true;
    const requestedBase = localeBase(requested);
    const activeBase = localeBase(active);
    // A generic patch such as `en` can serve en-US/en-GB, but a regional patch
    // must not unexpectedly replace another regional variant.
    return requestedBase === activeBase && !requested.includes("-");
  }

  patchMatchesEnvironment(patch) {
    if (!this.patchMatchesLanguage(patch)) return false;
    const target = patch && patch.target ? patch.target : {};
    const requested = target.theme ?? target.cssTheme ?? target.themes;
    if (requested == null || requested === "") return true;
    const themes = asArray(Array.isArray(requested) ? requested : [requested])
      .map((value) => normaliseText(value).toLocaleLowerCase())
      .filter(Boolean);
    return themes.length === 0 || themes.includes(this.getActiveThemeKey());
  }

  refreshPatchContext() {
    const nextThemeKey = this.getActiveThemeKey();
    const nextLanguageKey = this.getActiveLanguageKey();
    if (nextThemeKey === this.activeThemeKey && nextLanguageKey === this.activeLanguageKey) return;
    this.restoreDom();
    this.restoreStyleSettingsConfig();
    this.sourceContextChanged = true;
    this.activeThemeKey = nextThemeKey;
    this.activeLanguageKey = nextLanguageKey;
    this.compilePatches();
    this.styleSettingsSyncState = null;
    this.needsFullTranslation = true;
  }

  startObserver() {
    this.stopObserver();
    if (!this.settings.observeDom || typeof MutationObserver === "undefined") return;
    this.observer = new MutationObserver((mutations) => {
      if (!this.settings.enabled) return;
      for (const mutation of mutations) {
        if (mutation.type === "characterData") this.observerTextNodes.add(mutation.target);
        else if (mutation.type === "attributes") this.observerAttributeNodes.add(mutation.target);
        else mutation.addedNodes.forEach((node) => this.observerAddedNodes.add(node));
      }
      this.scheduleObserverFlush();
    });
    this.observer.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: this.settings.translateAttributes,
      attributeFilter: TRANSLATABLE_ATTRIBUTES,
    });
  }

  stopObserver() {
    if (this.observer) this.observer.disconnect();
    this.observer = null;
    if (this.observerFrame != null) {
      if (typeof window.cancelAnimationFrame === "function") window.cancelAnimationFrame(this.observerFrame);
      else window.clearTimeout(this.observerFrame);
    }
    this.observerFrame = null;
    this.observerTextNodes.clear();
    this.observerAttributeNodes.clear();
    this.observerAddedNodes.clear();
  }

  scheduleFullTranslation() {
    if (this.fullTranslationHandle != null || !this.settings.enabled) return;
    const run = () => {
      this.fullTranslationHandle = null;
      this.fullTranslationUsesIdle = false;
      if (!this.settings.enabled || !document.body) return;
      this.translateTree(document.body);
      this.needsFullTranslation = false;
    };
    if (typeof window.requestIdleCallback === "function") {
      this.fullTranslationUsesIdle = true;
      this.fullTranslationHandle = window.requestIdleCallback(run, { timeout: 1200 });
    } else {
      this.fullTranslationHandle = window.setTimeout(run, 0);
    }
  }

  cancelFullTranslation() {
    if (this.fullTranslationHandle == null) return;
    if (this.fullTranslationUsesIdle && typeof window.cancelIdleCallback === "function") {
      window.cancelIdleCallback(this.fullTranslationHandle);
    } else {
      window.clearTimeout(this.fullTranslationHandle);
    }
    this.fullTranslationHandle = null;
    this.fullTranslationUsesIdle = false;
  }

  scheduleObserverFlush() {
    if (this.observerFrame != null || !this.settings.enabled) return;
    const flush = () => {
      this.observerFrame = null;
      if (!this.settings.enabled) {
        this.observerTextNodes.clear();
        this.observerAttributeNodes.clear();
        this.observerAddedNodes.clear();
        return;
      }
      const textNodes = [...this.observerTextNodes];
      const attributeNodes = [...this.observerAttributeNodes];
      const addedNodes = [...this.observerAddedNodes];
      this.observerTextNodes.clear();
      this.observerAttributeNodes.clear();
      this.observerAddedNodes.clear();
      textNodes.forEach((node) => this.translateTextNode(node));
      attributeNodes.forEach((node) => this.translateElementAttributes(node));
      addedNodes.forEach((node) => this.translateTree(node));
      if (this.observerTextNodes.size || this.observerAttributeNodes.size || this.observerAddedNodes.size) {
        this.scheduleObserverFlush();
      }
    };
    this.observerFrame = typeof window.requestAnimationFrame === "function"
      ? window.requestAnimationFrame(flush)
      : window.setTimeout(flush, 16);
  }

  refresh(forceFullScan = false) {
    this.refreshPatchContext();
    this.maybeReapplySourcePatches();
    this.syncStyleSettingsIntegration();
    if (!this.settings.enabled) {
      this.restoreDom();
      this.restoreStyleSettingsConfig();
      this.patchCommands();
      return;
    }
    this.patchCommands();
    if (document.body && (forceFullScan || this.needsFullTranslation)) this.scheduleFullTranslation();
  }

  async maybeReapplySourcePatches() {
    if (!this.settings.enabled || !this.settings.applySourcePatches || this.sourcePatchCheckRunning) return;
    if (this.sourceContextChanged) {
      this.sourcePatchCheckRunning = true;
      try {
        this.sourceContextChanged = false;
        await this.restoreSourcePatches(false);
        await this.applySourcePatches();
      } finally {
        this.sourcePatchCheckRunning = false;
      }
      return;
    }
    const now = Date.now();
    if (now - this.lastSourcePatchCheck < 5000) return;
    this.lastSourcePatchCheck = now;
    const changed = this.patches.some((patch) => {
      if (!this.patchMatchesEnvironment(patch)) return false;
      const pluginId = patch.target && patch.target.pluginId ? String(patch.target.pluginId) : "";
      if (!pluginId) return false;
      const version = this.getPluginVersion(pluginId);
      return version !== "unknown" && this.sourceVersionSnapshot.get(pluginId) !== version;
    });
    if (!changed) return;
    this.sourcePatchCheckRunning = true;
    try {
      await this.applySourcePatches();
    } finally {
      this.sourcePatchCheckRunning = false;
    }
  }

  restoreDom() {
    for (const [node, snapshot] of this.textSnapshots) {
      if (node.nodeValue === snapshot.translated) node.nodeValue = snapshot.original;
    }
    for (const [element, attributes] of this.attributeSnapshots) {
      for (const [attribute, snapshot] of attributes) {
        if (element.getAttribute(attribute) !== snapshot.translated) continue;
        if (snapshot.present) element.setAttribute(attribute, snapshot.original);
        else element.removeAttribute(attribute);
      }
    }
    this.textSnapshots.clear();
    this.attributeSnapshots.clear();
  }

  getStyleSettingsPlugin() {
    return this.app.plugins && this.app.plugins.plugins
      ? this.app.plugins.plugins["obsidian-style-settings"]
      : null;
  }

  getStyleSettingsEntries() {
    return this.compiledEntries.filter(({ patch }) => {
      return patch.target && patch.target.pluginId === "obsidian-style-settings";
    });
  }

  translateStructuredString(value) {
    if (value == null || value === "") return value;
    let result = String(value);
    for (const { entry, regex } of this.getStyleSettingsEntries()) {
      if (regex) {
        result = result.replace(regex, entry.target);
      } else if (result === entry.source || normaliseText(result) === normaliseText(entry.source)) {
        result = entry.target;
      }
    }
    return result;
  }

  rememberStructuredValue(object, property) {
    if (!object || typeof object !== "object" || typeof object[property] !== "string") return;
    let snapshots = this.styleSettingsSnapshots.get(object);
    if (!snapshots) {
      snapshots = new Map();
      this.styleSettingsSnapshots.set(object, snapshots);
    }
    const value = object[property];
    const existing = snapshots.get(property);
    const original = existing && value === existing.translated ? existing.original : value;
    const translated = this.translateStructuredString(original);
    if (translated !== original) object[property] = translated;
    snapshots.set(property, { original, translated });
  }

  translateStyleSettingsConfig(settingsList) {
    if (!this.settings.enabled || !Array.isArray(settingsList)) return;
    for (const section of settingsList) {
      this.rememberStructuredValue(section, "name");
      if (!Array.isArray(section.settings)) continue;
      for (const setting of section.settings) {
        this.rememberStructuredValue(setting, "title");
        this.rememberStructuredValue(setting, "description");
        if (!Array.isArray(setting.options)) continue;
        for (let optionIndex = 0; optionIndex < setting.options.length; optionIndex += 1) {
          const option = setting.options[optionIndex];
          if (typeof option === "string") {
            this.rememberStructuredValue(setting.options, String(optionIndex));
          } else {
            this.rememberStructuredValue(option, "label");
          }
        }
      }
    }
  }

  restoreStyleSettingsConfig() {
    for (const [object, snapshots] of this.styleSettingsSnapshots) {
      for (const [property, snapshot] of snapshots) {
        if (object[property] === snapshot.translated) object[property] = snapshot.original;
      }
    }
    this.styleSettingsSnapshots.clear();
  }

  syncStyleSettingsIntegration() {
    const stylePlugin = this.getStyleSettingsPlugin();
    const settingsTab = stylePlugin && stylePlugin.settingsTab;
    if (!stylePlugin || !settingsTab || typeof settingsTab.setSettings !== "function") return;

    if (!this.styleSettingsHooks.has(stylePlugin)) {
      const original = settingsTab.setSettings.bind(settingsTab);
      const plugin = this;
      settingsTab.setSettings = (settingsList, errorList) => {
        if (plugin.settings.enabled) plugin.translateStyleSettingsConfig(settingsList);
        else plugin.restoreStyleSettingsConfig();
        return original(settingsList, errorList);
      };
      this.styleSettingsHooks.set(stylePlugin, original);
    }

    const settingsList = Array.isArray(stylePlugin.settingsList) ? stylePlugin.settingsList : null;
    if (!settingsList) return;
    const state = {
      plugin: stylePlugin,
      list: settingsList,
      enabled: this.settings.enabled,
      revision: this.styleSettingsPatchRevision,
    };
    const previous = this.styleSettingsSyncState;
    if (
      previous && previous.plugin === state.plugin && previous.list === state.list &&
      previous.enabled === state.enabled && previous.revision === state.revision
    ) return;

    settingsTab.setSettings(settingsList, stylePlugin.errorList || []);
    if (this.app.workspace && this.app.workspace.getLeavesOfType) {
      for (const leaf of this.app.workspace.getLeavesOfType("style-settings")) {
        if (leaf.view && typeof leaf.view.setSettings === "function") {
          leaf.view.setSettings(settingsList, stylePlugin.errorList || []);
        }
      }
    }
    this.styleSettingsSyncState = state;
  }

  translateTree(root) {
    if (!root || !this.settings.enabled) return;
    if (root.nodeType === 3) return this.translateTextNode(root);
    if (!isElement(root) || isIgnoredElement(root)) return;
    this.translateElementAttributes(root);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    let node;
    while ((node = walker.nextNode())) nodes.push(node);
    nodes.forEach((textNode) => this.translateTextNode(textNode));
  }

  translateElementAttributes(element) {
    if (!this.settings.translateAttributes || isIgnoredElement(element)) return;
    for (const attribute of TRANSLATABLE_ATTRIBUTES) this.translateAttribute(element, attribute);
  }

  translateAttribute(element, attribute) {
    if (!element || !element.hasAttribute || !element.hasAttribute(attribute)) return;
    const value = element.getAttribute(attribute);
    let snapshots = this.attributeSnapshots.get(element);
    if (!snapshots) {
      snapshots = new Map();
      this.attributeSnapshots.set(element, snapshots);
    }
    const previous = snapshots.get(attribute);
    if (!previous || value !== previous.translated) snapshots.set(attribute, { original: value, translated: value, present: true });
    const translated = this.translateValue(value, element, true, attribute);
    if (translated !== value) {
      element.setAttribute(attribute, translated);
      snapshots.get(attribute).translated = translated;
    }
  }

  translateTextNode(node) {
    if (!node || !node.parentElement || isIgnoredElement(node.parentElement)) return;
    const value = node.nodeValue;
    const previous = this.textSnapshots.get(node);
    if (!previous || value !== previous.translated) this.textSnapshots.set(node, { original: value, translated: value });
    const translated = this.translateValue(value, node.parentElement, false, "");
    if (translated !== value) {
      node.nodeValue = translated;
      this.textSnapshots.get(node).translated = translated;
    }
  }

  translateValue(value, element, isAttribute, attribute) {
    if (!this.settings.enabled || value == null || value === "") return value;
    let result = String(value);
    const exactCandidates = this.exactEntriesBySource.get(normaliseText(result));
    let regexMayMatch = false;
    if (this.regexEntries.length) {
      regexMayMatch = this.regexEntries.some(({ regex }) => {
        if (!regex) return false;
        regex.lastIndex = 0;
        return regex.test(result);
      });
    }

    // Most UI text is not translatable. Use the exact-source index to avoid
    // walking hundreds of unrelated rules for every text node. Fall back to
    // the full ordered list whenever a regex may participate, preserving the
    // original rule ordering semantics.
    const entries = exactCandidates && !regexMayMatch
      ? exactCandidates
      : (exactCandidates || regexMayMatch ? this.compiledEntries : this.runtimeEntries);
    for (const item of entries) {
      const { patch, entry, regex } = item;
      if (isAttribute && entry.attributes === false) continue;
      if (entry.selector) {
        try {
          if (!element.matches(entry.selector) && !element.closest(entry.selector)) continue;
        } catch (_error) {
          continue;
        }
      }
      if (patch.target && patch.target.selector) {
        try {
          if (!element.matches(patch.target.selector) && !element.closest(patch.target.selector)) continue;
        } catch (_error) {
          continue;
        }
      }
      if (regex) result = result.replace(regex, entry.target);
      else if (result === entry.source || normaliseText(result) === normaliseText(entry.source)) {
        // Preserve indentation around a translated text node.
        const leading = result.match(/^\s*/)?.[0] || "";
        const trailing = result.match(/\s*$/)?.[0] || "";
        result = `${leading}${entry.target}${trailing}`;
      }
      if (result !== value && !entry.regex) break;
    }
    return result;
  }

  patchCommands() {
    if (!this.app.commands || !this.app.commands.commands) return;
    const now = Date.now();
    if (this.settings.enabled && now - this.lastCommandPatch < 250) return;
    this.lastCommandPatch = now;
    for (const [id, command] of Object.entries(this.app.commands.commands)) {
      if (!command || typeof command.name !== "string") continue;
      const known = this.originalCommandNames.get(id);
      if (!known || known.ref !== command) this.originalCommandNames.set(id, { ref: command, name: command.name });
      const originalName = this.originalCommandNames.get(id).name;
      if (!this.settings.enabled) {
        command.name = originalName;
        continue;
      }
      command.name = originalName;
      // A command id beginning with plugin-id scopes a patch that declares target.pluginId.
      // Patches without pluginId are intentionally global, which is useful for shared Obsidian UI text.
      for (const patch of this.patches) {
        if (!this.patchMatchesEnvironment(patch)) continue;
        if (patch.target && patch.target.pluginId) {
          const pluginId = String(patch.target.pluginId);
          const belongsToPlugin = id === pluginId || id.startsWith(`${pluginId}:`) || id.startsWith(`${pluginId}-`);
          if (!belongsToPlugin) continue;
        }
        for (const entry of patch.translations) {
          if (entry.regex) {
            const regex = safeRegex(entry.source, entry.flags);
            if (regex) command.name = command.name.replace(regex, entry.target);
          } else if (normaliseText(command.name) === normaliseText(entry.source)) {
            command.name = entry.target;
          }
        }
      }
    }
  }
}

class TranslationPatchSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("translation-patch-settings");

    const activeTheme = this.plugin.getActiveThemeName() || "默认主题";
    const activeLanguage = this.plugin.getActiveLanguageKey();
    const hero = containerEl.createDiv({ cls: "translation-patch-hero" });
    hero.createDiv({ cls: "translation-patch-eyebrow", text: "TRANSLATION PATCH" });
    hero.createEl("h2", { text: "汉化补丁" });
    hero.createEl("p", {
      text: "用独立 JSON 补丁翻译插件和主题界面。切换外观后会自动匹配对应补丁，无需重启 Obsidian。",
    });
    const heroFooter = hero.createDiv({ cls: "translation-patch-hero-footer" });
    const contextPills = heroFooter.createDiv({ cls: "translation-patch-context-pills" });
    const themePill = contextPills.createDiv({ cls: "translation-patch-theme-pill" });
    themePill.createSpan({ cls: "translation-patch-theme-dot" });
    themePill.createSpan({ text: `外观 · ${activeTheme}` });
    const languagePill = contextPills.createDiv({ cls: "translation-patch-theme-pill" });
    languagePill.createSpan({ cls: "translation-patch-language-mark", text: "文" });
    languagePill.createSpan({ text: `语言 · ${this.plugin.getLanguageLabel(activeLanguage)}` });
    const reloadButton = heroFooter.createEl("button", {
      text: "重新加载补丁",
      cls: "mod-cta translation-patch-hero-button",
    });
    reloadButton.setAttr("aria-label", "重新加载汉化补丁");
    reloadButton.addEventListener("click", async () => {
      reloadButton.disabled = true;
      reloadButton.setText("加载中…");
      try {
        await this.plugin.reloadPatches(true);
        this.display();
      } finally {
        reloadButton.disabled = false;
        reloadButton.setText("重新加载补丁");
      }
    });

    const stats = containerEl.createDiv({ cls: "translation-patch-stats", attr: { "aria-label": "汉化补丁状态概览" } });
    this.renderStat(stats, this.plugin.patches.length, "已加载补丁");
    this.renderStat(stats, this.plugin.compiledEntries.length, "翻译规则");
    this.renderStat(stats, this.plugin.sourcePatchReport.applied.length, "源码注入");

    const languageSection = this.createSection(containerEl, "补丁语言", "选择要启用的补丁语言。旧版没有 language 字段的补丁默认按简体中文处理。");
    this.addLanguageSetting(languageSection);

    const coreSection = this.createSection(containerEl, "核心设置", "控制汉化补丁是否生效，以及是否将精确翻译写入插件源码。");
    this.addToggleSetting(coreSection, "启用汉化", "关闭后不会修改界面文字或命令名称。", "enabled", true);
    this.addToggleSetting(coreSection, "注入插件源码（推荐）", "将精确文本替换写入目标插件 main.js，并在需要时自动重载目标插件。首次修改前会自动备份。", "applySourcePatches", true, async (value) => {
      if (value) await this.plugin.applySourcePatches();
      else await this.plugin.restoreSourcePatches(true);
    });

    const automationSection = this.createSection(containerEl, "自动化翻译", "适合会动态更新界面的插件和主题设置页面。", true);
    this.addToggleSetting(automationSection, "翻译提示与辅助文字", "翻译 title、placeholder、aria-label 等属性。", "translateAttributes", false, async () => {
      this.plugin.startObserver();
    });
    this.addToggleSetting(automationSection, "监听动态界面", "插件打开新窗口或更新内容后自动应用补丁。", "observeDom", false, async () => {
      this.plugin.startObserver();
    });

    const toolsSection = this.createSection(containerEl, "工具", "管理补丁文件和源码备份。", true);
    this.addActionSetting(toolsSection, "重新加载补丁", `补丁目录：${this.plugin.patchesFolder}`, "重新加载", true, async () => {
      await this.plugin.reloadPatches(true);
      this.display();
    });
    this.addActionSetting(toolsSection, "恢复源码备份", "撤销本插件对目标插件 main.js 的修改，并自动重载目标插件。", "恢复", false, () => this.plugin.restoreSourcePatches(true));
    this.addActionSetting(toolsSection, "导出补丁模板", "导出一个空白补丁模板，填写后放入 patches 文件夹。", "导出模板", false, () => this.exportTemplate());

    this.renderPatchList(containerEl);
  }

  createSection(containerEl, title, description, collapsible = false) {
    const section = containerEl.createDiv({ cls: `translation-patch-section${collapsible ? " translation-patch-section-collapsible" : ""}` });
    const heading = section.createDiv({ cls: "translation-patch-section-heading" });
    const text = heading.createDiv({ cls: "translation-patch-section-heading-text" });
    text.createEl("h3", { text: title });
    text.createEl("p", { text: description });
    const card = section.createDiv({ cls: "translation-patch-card" });
    if (collapsible) {
      const toggle = heading.createEl("button", { cls: "translation-patch-section-toggle", attr: { type: "button", "aria-expanded": "true" } });
      toggle.createSpan({ cls: "translation-patch-section-chevron" });
      toggle.setAttr("aria-label", `折叠${title}`);
      toggle.addEventListener("click", () => {
        const collapsed = section.hasClass("is-collapsed");
        section.toggleClass("is-collapsed", !collapsed);
        toggle.setAttr("aria-expanded", String(collapsed));
        toggle.setAttr("aria-label", `${collapsed ? "折叠" : "展开"}${title}`);
      });
    }
    return card;
  }

  addToggleSetting(containerEl, name, description, key, primary, afterChange) {
    const setting = new Setting(containerEl)
      .setName(name)
      .setDesc(description)
      .addToggle((toggle) => toggle.setValue(Boolean(this.plugin.settings[key])).onChange(async (value) => {
        this.plugin.settings[key] = value;
        await this.plugin.saveSettings();
        this.plugin.needsFullTranslation = true;
        if (afterChange) await afterChange(value);
        this.plugin.refresh();
        if (key === "enabled" || key === "applySourcePatches") this.display();
      }));
    setting.settingEl.addClass(primary ? "translation-patch-setting-primary" : "translation-patch-setting-secondary");
    return setting;
  }

  addLanguageSetting(containerEl) {
    const setting = new Setting(containerEl)
      .setName("当前语言")
      .setDesc("只会启用匹配此语言的补丁；选择“跟随 Obsidian”时使用 Obsidian 当前界面语言。")
      .addDropdown((dropdown) => {
        for (const [locale, label] of this.plugin.getLanguageOptions()) dropdown.addOption(locale, label);
        dropdown.setValue(this.plugin.settings.language).onChange(async (value) => {
          dropdown.setDisabled(true);
          try {
            await this.plugin.setLanguage(value);
            new Notice(`补丁语言已切换为${this.plugin.getLanguageLabel(this.plugin.getActiveLanguageKey())}`);
            this.display();
          } finally {
            dropdown.setDisabled(false);
          }
        });
      });
    setting.settingEl.addClass("translation-patch-setting-language");
    return setting;
  }

  addActionSetting(containerEl, name, description, buttonText, cta, onClick) {
    const setting = new Setting(containerEl)
      .setName(name)
      .setDesc(description)
      .addButton((button) => {
        button.setButtonText(buttonText);
        if (cta) button.setCta();
        button.onClick(onClick);
        return button;
      });
    setting.settingEl.addClass("translation-patch-setting-action");
    return setting;
  }

  renderStat(containerEl, value, label) {
    const stat = containerEl.createDiv({ cls: "translation-patch-stat" });
    stat.createDiv({ cls: "translation-patch-stat-value", text: String(value) });
    stat.createDiv({ cls: "translation-patch-stat-label", text: label });
  }

  renderPatchList(containerEl) {
    const section = containerEl.createDiv({ cls: "translation-patch-section translation-patch-patches-section" });
    const heading = section.createDiv({ cls: "translation-patch-section-heading" });
    const headingText = heading.createDiv({ cls: "translation-patch-section-heading-text" });
    headingText.createEl("h3", { text: "补丁列表" });
    headingText.createEl("p", { text: "查看当前已加载的插件补丁与主题补丁，以及它们是否匹配当前外观。" });
    heading.setAttr("aria-label", "当前已启用的汉化补丁");
    const list = section.createDiv({ cls: "translation-patch-list" });
    const activeTheme = this.plugin.getActiveThemeName() || "默认主题";
    const activeLanguage = this.plugin.getActiveLanguageKey();
    const allFiles = this.plugin.lastLoadReport.files || [];

    if (!this.plugin.patches.length) {
      list.createDiv({ cls: "translation-patch-empty", text: "当前没有已启用的补丁。" });
      return;
    }

    for (const patch of this.plugin.patches) {
      const target = patch.target || {};
      const pluginId = target.pluginId ? String(target.pluginId) : "全局界面";
      const theme = target.theme || target.cssTheme || "";
      const language = this.plugin.getPatchLanguage(patch);
      const matches = this.plugin.patchMatchesEnvironment(patch);
      const row = list.createDiv({ cls: "translation-patch-list-item" });
      const info = row.createDiv({ cls: "translation-patch-list-info" });
      const title = theme ? `${patch.name}（${theme}）` : patch.name;
      info.createEl("strong", { text: title });
      const metadata = row.createDiv({ cls: "translation-patch-list-meta" });
      metadata.createSpan({
        text: matches ? "已生效" : "未启用",
        cls: `translation-patch-status ${matches ? "translation-patch-status-active" : "translation-patch-status-inactive"}`,
      });
      metadata.createSpan({ text: `目标：${pluginId}`, cls: "translation-patch-list-detail" });
      metadata.createSpan({ text: `语言：${this.plugin.getLanguageLabel(language)}`, cls: "translation-patch-list-detail" });
      metadata.createSpan({ text: `${patch.translations.length} 条规则`, cls: "translation-patch-list-detail" });
      if (patch.source) {
        info.createEl("small", { text: `文件：${patch.source}` });
      }
    }

    const footer = section.createEl("p", { cls: "setting-item-description translation-patch-list-footer" });
    footer.setText(`当前语言为“${this.plugin.getLanguageLabel(activeLanguage)}”，外观为“${activeTheme}”。补丁文件共 ${allFiles.length} 个；切换语言或主题后会自动更新生效状态。`);
  }

  async exportTemplate() {
    const template = {
      schemaVersion: PATCH_SCHEMA_VERSION,
      id: "example-plugin-zh",
      name: "示例插件汉化（请修改）",
      enabled: true,
      language: "zh-CN",
      target: { pluginId: "example-plugin", selector: "", theme: "" },
      translations: [
        { source: "English text", target: "中文文本", regex: false, attributes: true },
      ],
    };
    const modal = new TemplateModal(this.app, JSON.stringify(template, null, 2));
    modal.open();
  }
}

class TemplateModal extends Modal {
  constructor(app, content) {
    super(app);
    this.content = content;
  }

  onOpen() {
    this.titleEl.setText("补丁模板");
    this.contentEl.createEl("p", { text: "复制下面内容，保存为 .json 后放入汉化补丁插件目录的 patches 文件夹。" });
    const pre = this.contentEl.createEl("pre");
    pre.createEl("code", { text: this.content });
    new Setting(this.contentEl).addButton((button) => button.setButtonText("关闭").onClick(() => this.close()));
  }

  onClose() {
    this.contentEl.empty();
  }
}

module.exports = TranslationPatchPlugin;
