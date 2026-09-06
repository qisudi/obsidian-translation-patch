# Extraction and translation checklist

Use this reference after the repository and locale discovery steps in `SKILL.md`.

## Where to search

Search both authored and distributed code. Start with `manifest.json`, then inspect `src/`, `main.ts`/`main.js`, settings tabs, modals, views, components, templates, locale loaders, and the built `main.js`/assets shipped in releases. For themes, inspect every CSS `@settings` block and any generated Style Settings YAML/JSON. Search language files for the requested locale before treating English literals as missing translations.

Useful search terms include:

```text
addCommand        name:
new Notice        Notice(
setName           setDesc          setHeading
setText           setButtonText    setTooltip
setPlaceholder    placeholder      aria-label
aria-description  title            alt
createEl          createDiv        createSpan
innerText         textContent      innerHTML
confirm           prompt           error
@settings         title            description
options           label            default
```

Also inspect framework equivalents such as React/Svelte/Vue template text, translation calls, component props, and strings returned by render functions. Search the final bundle when a build step concatenates or transforms text.

## What counts as user-facing

Include a literal when it is passed to an Obsidian UI API, inserted into visible DOM/HTML, used for accessibility, shown in a notice/modal/error/empty state, registered as a command or setting, or loaded into a Style Settings schema. Include both the base text and variable variants when the UI can show both.

Usually exclude identifiers, property keys, CSS selectors, class names, plugin IDs, URLs, file paths, query language syntax, code snippets shown as code, debug logs, stack traces, comments, tests, changelogs, and documentation that never renders in Obsidian. A log or error is included only when the plugin presents it in a notice, modal, status view, or settings page.

## Classification heuristics

- **Exact literal:** a complete stable phrase. Use a plain rule and prefer source injection only when it cannot match code identifiers or generic tokens.
- **Variable phrase:** a stable sentence with a value, count, file name, or user input. Use an anchored regex only for the variable portion, preserving captures.
- **Attribute:** text used as `title`, `placeholder`, `aria-*`, `alt`, or a tooltip. Keep `attributes` enabled unless changing the attribute would be misleading.
- **Selector-scoped:** a generic word whose meaning depends on a particular view. Add a stable selector and keep it runtime-only.
- **Style Settings/theme:** a string originating in theme CSS/YAML and rendered by `obsidian-style-settings`. Put it in a theme-specific patch with `target.source: false`; do not rewrite the theme CSS.

## Translation quality checks

Use the requested language and locale variant. Prefer existing official locale wording and a consistent glossary for repeated concepts such as settings, query, view, field, theme, export, import, refresh, and enable/disable. Preserve:

- interpolation (`${name}`, `{{count}}`, `%s`, `%d`, `{0}`) and regex captures (`$1`);
- HTML/Markdown structure, links, code spans, keyboard shortcuts, and intentional punctuation;
- leading/trailing whitespace and line breaks when they affect layout;
- product names, plugin names, API names, file extensions, and query syntax unless the repository's official locale translates them.

When context is insufficient, leave the source in the review table rather than inventing a misleading translation. Flag terms that may need the user's preferred glossary.

## Coverage report

For each extraction pass, retain enough provenance to reproduce the rule: repository path, line or nearby symbol, source version/commit, and whether it came from authored source, a built bundle, or a theme settings block. Summarize counts for:

- translated exact rules;
- translated regex/variable rules;
- attribute and selector-scoped rules;
- theme/Style Settings rules;
- intentionally excluded strings with reasons;
- dynamic, network-provided, Canvas/image/Shadow DOM, or otherwise unverified strings;
- ambiguous strings requiring review.

