---
name: obsidian-translation-patch
description: Generate safe, complete Obsidian translation-patch JSON files from a plugin or theme repository, checking existing locales, extracting user-facing strings, translating to the requested language, validating placeholders and rules, and optionally installing the result into a vault.
---

# Obsidian translation patch generation

Use this skill when a user wants an Obsidian plugin or theme translated without editing the target project directly. The deliverable is one or more JSON files understood by the user's `translation-patch` plugin, plus an auditable extraction/coverage report. Keep the target repository unchanged unless the user separately asks for a source-language contribution.

## First interaction

Ask for the target language before doing repository work. Ask for the locale/variant when it matters (for example, `简体中文 zh-CN`, `繁體中文 zh-TW`, `日本語 ja-JP`). If the user already specified a language and variant, do not ask again. The user may provide a GitHub URL, repository name, or local source path in the same message; if not, ask for it after the language is known.

Do not silently choose between Simplified and Traditional Chinese, regional terminology, or a formal/informal register. Existing repository locale files take precedence over personal wording preferences, but missing strings still need to be translated.

## Workflow

1. **Resolve the target.** Identify the GitHub repository, plugin ID, display name, current version, and whether the target is an Obsidian plugin or a theme. Read `manifest.json`, package metadata, README, and build/locale configuration. If a repository name is ambiguous, search for the official repository and show the resolved URL before proceeding. If network access is unavailable, ask the user for a ZIP or local source instead of guessing.

2. **Check existing localization first.** Search the repository for locale directories and files (`lang`, `locale`, `locales`, `i18n`, `translations`, `.json`, `.po`, `.yaml`, `.ts`, `.js`) and language tags such as `zh-CN`, `zh_TW`, `ja`, or the requested locale. Read the matching locale as the terminology source of truth. Record which strings are already translated, which are missing, and whether the project loads translations at runtime. Do not replace a repository's official locale with a patch unless the user explicitly wants that.

3. **Acquire source safely.** Prefer reading GitHub raw files/API or an existing local checkout. Otherwise clone a shallow copy into a temporary directory; never clone over the user's vault or working repository. Inspect source and built assets when the distributed `main.js` contains strings that source files do not. Note the commit/tag/version used so a future patch can be regenerated after a major update.

4. **Extract user-visible text.** Search source, compiled JavaScript, UI components, settings schemas, and theme `@settings` blocks. Include text that can appear in:

   - command registrations and command palette names;
   - settings names, descriptions, headings, option labels, validation errors, and default-value explanations;
   - notices, modal titles/content, confirmation dialogs, status messages, empty states, tooltips, placeholders, `aria-*`, `title`, and `alt` attributes;
   - HTML/template/component text and strings inserted into the DOM at runtime;
   - theme-provided Style Settings titles, descriptions, option labels, and section names.

   Exclude identifiers, variable/function names, CSS selectors, URLs, file paths, debug-only logs, stack traces, source comments, tests, changelogs, and documentation that is not rendered inside Obsidian. Treat a string as user-facing when it is passed to a UI API, inserted into visible DOM/HTML, used as an accessibility label, or displayed by a plugin/theme setting schema. Read [extraction-and-translation.md](references/extraction-and-translation.md) for the complete checklist and false-positive rules.

5. **Classify each candidate.** Preserve interpolation and markup exactly. Mark whether a rule is:

   - an exact literal (preferred; safe for source injection);
   - a variable-pattern string requiring a narrowly scoped regular expression;
   - an attribute-only string;
   - selector-scoped runtime text; or
   - a Style Settings/theme string that must remain runtime-only (`target.source: false`).

   Never translate a token merely because it is English. For example, code identifiers, API names, query syntax, CSS values, and plugin IDs must remain unchanged unless the text is visibly presented to users.

6. **Translate consistently.** Use the requested language and the repository's existing glossary/locale terminology. Preserve `%s`, `${name}`, `{{count}}`, ICU placeholders, Markdown links, HTML tags, keyboard shortcuts, quote style where meaningful, and leading/trailing whitespace. Translate complete UI phrases rather than isolated words when context is available. For ambiguous or context-poor strings, keep the source as a review item instead of inventing a confident translation.

7. **Build the patch.** Follow [patch-format.md](references/patch-format.md). Use the exact plugin ID in `target.pluginId`; use `target.theme` for theme-specific rules. Keep plugin-fixed strings and theme-specific Style Settings strings in separate patch files even though both files live in the translation plugin's `patches` directory. Use exact rules by default, narrow selectors for generic text, and regex only for verified variable portions. Mark theme/Style Settings patches with `target.source: false` so CSS or theme code is not rewritten. Do not embed unrelated plugins' translations.

8. **Validate before delivery.** Parse every JSON file as UTF-8; validate the schema; compile every regex; detect duplicate/conflicting rules; and verify that source and target preserve all placeholders and markup. Check that every extracted candidate is either translated, intentionally excluded with a reason, or listed for review. If source injection is enabled, confirm that every source rule is an exact literal and does not target a selector-scoped or generic token. Read [patch-format.md](references/patch-format.md) for the validation invariants.

9. **Install only when requested.** If the user gives a vault path and asks for installation, copy the patch into `<vault>/.obsidian/plugins/translation-patch/patches/` (or the configured patch directory), preserving existing files and creating a backup before replacing a same-named file. Do not delete other patches. Report the exact installed path and tell the user to run “重新加载汉化补丁”; if `main.js`/`styles.css` or the manifest changed, tell them to disable/re-enable the translation plugin as well.

10. **Report provenance and coverage.** Provide the repository URL, version/commit, requested locale, files inspected, existing locale used (if any), number of extracted/translated/review items, patch file paths, and any known limitations such as Canvas, images, Shadow DOM, or strings generated only after a network response. Mention whether the patch is safe for desktop and mobile based on the target plugin and the translation-patch runtime.

## Operational boundaries

- Do not modify the target plugin's source or theme CSS as a substitute for producing a patch.
- Do not send repository contents or user vault data to an external translation service unless the user explicitly asks and authorizes that transfer.
- Do not claim full coverage from a single search. Inspect both source and distributed assets, then report dynamic or inaccessible text separately.
- A small upstream update can reuse the patch when source literals and UI structure are unchanged; regenerate and re-audit after a major update, renamed strings, changed settings schema, or changed theme `@settings` blocks.

## Using this with other agents

This skill has no required Codex, MCP, or vendor-specific dependency. An agent that supports skill folders can install the whole `obsidian-translation-patch` directory and load `SKILL.md`; map GitHub access, cloning, file reading, and JSON validation to that agent's available tools. The single-file [obsidian-translation-patch-agent.txt](obsidian-translation-patch-agent.txt) is a self-contained portable version: send its contents as an instruction to an agent that cannot install a skill, or save it under that agent's preferred skills/prompts directory. The portable file intentionally repeats the essential schema and safety rules so it does not depend on the two reference files.
