# Translation-patch JSON format and validation

The current translation-patch plugin reads JSON files directly from its `patches` directory. A file may contain one object or an array of objects. Keep the schema explicit:

```json
{
  "schemaVersion": 1,
  "id": "example-plugin-zh-cn",
  "name": "Example Plugin 简体中文",
  "language": "zh-CN",
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
- `language` (or `locale`) selects the patch language. Use BCP-47-style codes such as `zh-CN`, `zh-TW`, `en`, `ja`, or `pt-BR`. Legacy patches without this field are treated as `zh-CN`; a clear filename suffix such as `plugin-ja.json` is also recognized.
- `target.pluginId` scopes command names and documents which plugin owns the UI. Use the exact ID from `manifest.json`.
- `target.theme` (or `themes`) limits a patch to the active theme. Theme matching is case-insensitive.
- `target.source: false` disables source injection for that patch. Use it for theme and Style Settings rules, selector-scoped rules, and any text that is unsafe to replace in bundled JavaScript.
- `target.selector` and a rule's `selector` narrow runtime DOM matching. Prefer a stable plugin root class or data attribute over a generated class name.
- `injectSource: false` on a single rule opts that rule out of source injection while keeping it active in the running UI. Use it for text that is unsafe or pointless to rewrite in the bundle (multiple occurrences, values that only make sense at runtime). Omitting the field keeps the default: every exact, non-selector rule participates in source injection.
- `regex: true` enables a regular expression. Keep expressions anchored and narrow; preserve capture groups in the target. Do not use regex rules for source injection unless the runtime explicitly supports a future safe-source flag.
- `attributes: false` prevents a rule from changing `title`, `placeholder`, `aria-label`, `data-tooltip`, and other translated attributes. It does not disable normal text translation.
- `source` and `target` are strings. Do not use an empty source, and omit a rule when source and target are identical. Never write `"source": false` — that field holds the search text; the per-rule switch is `injectSource`.

## Source injection and escaping

Version 0.4.0 and later inject only inside string and template literals, and only through a lexer that refuses to touch a bundle it cannot scan. Keep these rules in mind when authoring:

- **Write natural text.** A rule whose source is `临近`, `Here's`, or contains a real newline will match `\u4E34\u8FD1`, `Here\'s`, and `\n` in an ASCII-only bundle. The escape-aware pass runs only when the byte-for-byte pass found nothing in that literal, so older byte-variant rules keep winning where they exist.
- **Do not pre-escape targets for new patches.** The plugin escapes the delimiter quote, real line breaks, and `${` in template literals, and leaves existing backslash sequences untouched. Writing `\\u5173\\u95ed` still works, but writing `关闭` is simpler and produces the same result.
- **A target that still breaks the literal is dropped, not written.** Trailing lone backslashes, or a target that closes the literal, are rejected per occurrence and reported as a diagnostic. Fix the rule instead of relying on the fallback.
- **Avoid targets that end in a backslash** unless you really mean a literal `\`; the engine doubles it so the literal stays closed, which may surprise you when the rendered text is compared.
- **The dual-variant technique is legacy.** Before 0.4.0 an author had to ship a "bundle byte variant" rule plus a "natural text variant" for the same phrase. With 0.4.0 one natural-text rule covers both; keeping the pair is still safe (the byte variant simply matches first).

## Third-party bundled library strings

Plugins often bundle UI libraries whose strings never pass through the plugin's own i18n layer. They are still user-visible and still live in `main.js` as exact literals, so an ordinary exact rule can translate them:

- Grid.js: `No matching records found`, `Loading...`, `An error happened while fetching the data`
- DataTables: `No data available in table`, `Showing _START_ to _END_ of _TOTAL_ entries` (this one is a template — use a narrow regex or leave it alone)
- moment / dayjs locale data: month and weekday names, `Invalid date`, relative-time patterns
- Toast/notification helpers: `Copied to clipboard`, `Something went wrong`

Extraction guidance: grep the published bundle, not only the source tree. These strings usually appear exactly once per bundle, so they are safe to inject; still confirm the count before adding the rule, and prefer a `selector` if the same English phrase is also used by the plugin itself with a different meaning.

## Language gating

`patch.language` is matched against the plugin's **patch language** setting, not against the target plugin's own locale:

- The setting has an `auto` mode that follows Obsidian's configured UI language; otherwise it is the locale chosen in the dropdown.
- A `zh-CN` patch does not load while the patch language is `auto` and Obsidian runs in English. Users switching to Chinese must either switch Obsidian's language or pick `简体中文` explicitly.
- A bare language tag (`en`) also matches its regional variants (`en-US`, `en-GB`); a regional tag (`zh-CN`) does not match another region (`zh-TW`).
- Theme patches are gated twice: by language and by `target.theme` (case-insensitive match against the active theme name).
- When writing a patch for a language the plugin already ships a locale for, check that locale first: an existing key with a stale English value needs a runtime correction rule, and a wrong existing translation is a legitimate `injectSource: false` candidate if the same text appears more than once in the bundle.

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
8. **Run the bundled validator against the real bundle** when the author can supply `main.js`:

   ```bash
   node scripts/validate-source-patch.js path/to/main.js path/to/patch.json
   ```

   A non-zero exit code means at least one rule matched nothing or the injected bundle stopped parsing. Explain every zero-hit rule before delivery: renamed upstream, not in the bundle, code-only occurrence, or rejected target.
9. **For plugins still on 0.3.x** (no literal-aware injection), additionally reject source-injection targets that contain a real newline or the delimiter quote of the matched context — the old runtime wrote them verbatim and could break `main.js`. Prefer telling the user to update the plugin instead of hand-escaping.
10. **Cross-check source and published bundle.** A string can exist in `src/` but be rewritten or renamed at build time, and bundled third-party strings exist only in the bundle. Extraction is not complete until both have been inspected.
11. **Compare against the official locale when one exists.** Record keys that are missing from the official locale (add them to the patch) and keys whose official value is stale English or a mistranslation (add a runtime correction rule; use `injectSource: false` if the same text appears multiple times in the bundle).
