# 汉化补丁（Obsidian 插件）

这是一个补丁运行器。它会读取插件目录 `patches` 下的独立 JSON 文件，将规则应用到目标插件源码（推荐模式），并同时处理 Obsidian 当前界面的文字、提示属性和命令名称。源码补丁会在首次修改前自动备份；插件运行期间检测到目标插件版本变化时，会自动再次注入，因此第三方插件小版本更新通常不需要重新找字符串。

## 安装（桌面端和移动端）

1. 在你的仓库 `.obsidian/plugins/translation-patch/` 中放入 `manifest.json` 和 `main.js`。
2. 在 Obsidian 的“第三方插件”设置中启用“汉化补丁”。
3. 在同一目录新建 `patches` 文件夹，把补丁 JSON 文件放进去。
4. 打开本插件设置，点击“重新加载”。

插件没有使用 Node、网络或桌面专属 API，`isDesktopOnly` 为 `false`，因此可在桌面端和移动端使用。

## 补丁格式

```json
{
  "schemaVersion": 1,
  "id": "some-plugin-zh",
  "name": "Some Plugin 汉化",
  "enabled": true,
  "target": {
    "pluginId": "some-plugin",
    "selector": ".some-plugin-root",
    "theme": "Minimal"
  },
  "translations": [
    { "source": "Settings", "target": "设置" },
    { "source": "^Delete (.+)$", "target": "删除 $1", "regex": true, "flags": "i" },
    { "source": "Refresh", "target": "刷新", "attributes": false }
  ]
}
```

`target.selector` 和每条规则的 `selector` 都是可选的 CSS 选择器，用于避免误翻译其他插件。`target.pluginId` 会按命令 ID（通常为 `pluginId:command`）限制命令名称的翻译；界面元素若无法通过 DOM 归属判断，请使用 selector。

`target.theme` 可指定主题名称（也可用 `themes` 数组指定多个主题）。主题补丁只会在对应主题启用时加载；切换主题后会自动恢复旧主题文字并加载新主题规则。这个能力主要用于 Style Settings：插件自身固定文字放在插件补丁中，各主题写入 `@settings` 的标题、说明和选项则放在独立主题补丁中。

对于 Style Settings 主题补丁，请同时设置 `target.pluginId` 为 `obsidian-style-settings`、`target.theme` 为主题名称和 `target.source` 为 `false`。插件会在 Style Settings 完成 CSS/YAML 解析、渲染设置面板之前翻译内部配置对象，因此主题提供的标题、说明和下拉选项都能生效；不需要改写主题 CSS。

设置页底部的“补丁列表”会显示所有已启用的补丁、目标插件/主题、规则数量和当前生效状态；主题不匹配的补丁会保留在列表中但标记为“未启用”，方便确认切换主题后的加载结果。

设置页使用 Obsidian 原生颜色变量，并针对窄屏重新排列卡片、按钮和补丁状态信息；桌面端与移动端会随系统明暗主题自动适配。内容区域会随设置面板宽度伸展，不会固定在窄列中。

插件会按需进行全量界面扫描：启动、重新加载补丁、切换主题时在空闲时扫描一次，平时只处理新增或变化的节点；精确文本使用索引快速查找，动态观察器按动画帧批量处理。这样可以明显减少低性能设备上的重复计算和启动卡顿。

普通规则只替换完整文本，正则规则可替换文本中的一部分。源码注入模式只应用精确规则，并按较长文本优先、单词边界保护的方式修改字符串，避免破坏变量名；正则规则仍用于运行时 DOM。默认还会处理 `title`、`placeholder`、`aria-label`、`data-tooltip` 等辅助属性，并自动监听动态创建的元素。

源码补丁默认开启。在插件设置中关闭它会恢复本插件保存的源码备份；也可以单独点击“恢复源码备份”。点击“重新加载补丁”时会从原始备份重新生成译文，因此修改译文后无需重启 Obsidian；应用源码补丁后，目标插件会自动重载。如果目标插件当时未启用，则下次启用时生效。

关闭“启用汉化”时，插件会尽量把仍未被第三方插件改写的文字和命令恢复为原文；重新打开相关视图也会自然恢复。

## 注意事项

- 运行时规则发生在界面渲染后；启用“注入插件源码”时，精确规则也会写入目标插件的 `main.js`，修改前自动备份。主题补丁应设置 `"source": false`，不会修改主题 CSS。
- 如果某个插件把文字绘制在 Canvas、图片或 Shadow DOM 内，普通 DOM 补丁无法覆盖，需要针对该插件编写专用适配规则。
- 补丁文件格式错误时会被跳过，并在“重新加载”时提示跳过数量。
