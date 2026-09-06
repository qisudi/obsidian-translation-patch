# Translation-patch JSON format and validation

The current translation-patch plugin reads JSON files directly from its `patches` directory. A file may contain one object or an array of objects. Keep the schema explicit:

```json
{
  "schemaVersion": 1,
  "id": "example-plugin-zh-cn",
  "name": "Example Plugin 简体中文",
  "enabled": true,
  "target": {
    "pluginId": "example-plugin",
    "theme": "",
    "source": true,
    "selector": ""
  },
  "translations": [
    { "source": "Settings", "target": "设置" },
    { "source": "^Delete (.+)$", "target": "删除 $1", "regex": true, "flags": "i" },
    { "source": "Tooltip", "target": "提示", "attributes": true, "selector": ".example-root" }
  ]
}
```

## Field rules

- `schemaVersion`, `id`, `name`, and `translations` are required. `enabled` defaults to true.
- `target.pluginId` scopes command names and documents which plugin owns the UI. Use the exact ID from `manifest.json`.
- `target.theme` (or `themes`) limits a patch to the active theme. Theme matching is case-insensitive.
- `target.source: false` disables source injection for that patch. Use it for theme and Style Settings rules, selector-scoped rules, and any text that is unsafe to replace in bundled JavaScript.
- `target.selector` and a rule's `selector` narrow runtime DOM matching. Prefer a stable plugin root class or data attribute over a generated class name.
- `regex: true` enables a regular expression. Keep expressions anchored and narrow; preserve capture groups in the target. Do not use regex rules for source injection unless the runtime explicitly supports a future safe-source flag.
- `attributes: false` prevents a rule from changing `title`, `placeholder`, `aria-label`, `data-tooltip`, and other translated attributes. It does not disable normal text translation.
- `source` and `target` are strings. Do not use an empty source, and omit a rule when source and target are identical.

## Plugin versus theme files

Put all patch files in the same direct `patches` folder used by the translation-patch plugin. Separate them by responsibility:

- `plugin-id-zh-cn.json`: fixed plugin UI and commands; source injection may remain enabled for verified exact literals.
- `theme-name-style-settings-zh-cn.json`: theme `@settings` titles, descriptions, section names, and option labels; set `target.pluginId` to `obsidian-style-settings`, set `target.theme` to the exact theme name, and set `target.source` to `false`.

The folder is shared; `target.pluginId` and `target.theme` distinguish which rules are active. The loader reads JSON files directly in this folder, not arbitrary nested subdirectories.

## Required validation

Before delivery:

1. Parse JSON and confirm UTF-8 encoding.
2. Confirm required fields and that every translation entry has non-empty string `source` and `target`.
3. Compile every regex with its declared flags. Report invalid expressions instead of silently dropping them.
4. Detect duplicate `(pluginId, theme, selector, source)` rules and conflicting targets.
5. Compare placeholders and markup in source/target. The multiset of `${...}`, `{{...}}`, `%s`/`%d`, numbered `$1` references, HTML tags, Markdown link destinations, and code spans must remain compatible.
6. Reject source-injection rules that have a selector, are regex rules, target generic tokens (`none`, `true`, `false`, common CSS values), or could alter identifiers/URLs.
7. Keep a coverage table: translated, intentionally excluded with a reason, dynamic/unreachable, and needs human review.

