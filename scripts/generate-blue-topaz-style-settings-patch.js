const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const sourcePath = process.argv[2] || path.join(root, "blue-topaz-settings.yaml");
const outputPath = process.argv[3] || path.join(root, "patches", "blue-topaz-style-settings-zh.json");
const sourceInput = fs.readFileSync(sourcePath, "utf8");
const source = path.extname(sourcePath).toLowerCase() === ".css"
  ? [...sourceInput.matchAll(/\/\*!?\s*@settings\s*\r?\n([\s\S]+?)\*\//g)]
      .map((match) => match[1])
      .join("\n")
  : sourceInput;
// Regeneration is intentionally based on the current theme CSS only. This prevents an old
// generated translation from masking changes made by the theme or carrying a stale typo forward.
const exact = new Map();

const replacements = [
  ["Attention！Due to obsidian's policy of not being able to use online or local vault images, However, the option to customise the settings and fill in the url is currently supported.", "注意！由于 Obsidian 的政策，主题无法使用在线或本地仓库图片；目前可以通过填写 URL 自定义设置。"],
  ["Customise", "自定义"], ["customise", "自定义"], ["custom", "自定义"],
  ["General settings", "常规设置"], ["Color scheme", "配色方案"], ["Color palette", "配色方案"],
  ["Background images", "背景图片"], ["Workplace background image", "工作区背景图片"],
  ["Note page background image", "笔记页面背景图片"], ["Notebook-liked background", "笔记本风格背景"],
  ["Notebook-liked", "笔记本风格"], ["Images of command palette", "命令面板图片"],
  ["File explorer background", "文件浏览器背景"], ["Layout", "布局"], ["Bubble settings", "气泡设置"],
  ["Detail settings", "详细设置"], ["Color settings", "颜色设置"], ["Background colors", "背景颜色"],
  ["Theme colors", "主题颜色"], ["Other colors", "其他颜色"], ["Graph-view colors", "关系图谱颜色"],
  ["Typography", "排版"], ["Font family", "字体系列"], ["Font size", "字体大小"], ["Headers", "标题"],
  ["Other typography settings", "其他排版设置"], ["file in split pane", "文件（分栏）"],
  ["Inline title", "文内标题"], ["Element styles", "元素样式"], ["Dividing line", "分隔线"],
  ["Unordered list", "无序列表"], ["Ordered list", "有序列表"], ["Indentation lines", "缩进线"],
  ["Colorful folder", "彩色文件夹"], ["Blockquote", "引用块"], ["Exported PDF style", "导出 PDF 样式"],
  ["Embeds", "嵌入"], ["Table", "表格"], ["Cloze style", "完形填空样式"], ["Links", "链接"],
  ["Cursor", "光标"], ["Checkbox", "复选框"], ["Icons", "图标"], ["Images", "图片"], ["Tags", "标签"],
  ["Setting, Menu, Option panes", "设置、菜单和选项窗格"], ["Titlebar style", "标题栏样式"], ["Outline", "大纲"],
  ["Prompt", "提示框"], ["Stack tabs", "堆叠标签页"], ["Tab stack", "标签页堆叠"], ["Highlights", "高亮"], ["Popover", "弹出窗口"],
  ["For Plugins", "插件相关"], ["Admonition", "Admonition"], ["Callout", "标注框"], ["Calendar", "日历"],
  ["Checklist plugin", "Checklist 插件"], ["Kanban", "看板"], ["Buttons", "按钮"], ["Dialogue", "Dialogue"],
  ["Chatview", "Chatview"], ["Dataview", "Dataview"], ["Thino", "Thino"],
  ["Active line", "当前行"], ["Inactive line", "非当前行"], ["Line color", "线条颜色"], ["line color", "线条颜色"],
  ["Main color", "主题色"], ["Low contrast color", "浅色"], ["Deep color", "深色"], ["Theme color", "主题色"],
  ["Background", "背景"], ["background", "背景"], ["Side split container", "侧边分栏"], ["Side split", "侧边分栏"],
  ["Light mode", "浅色模式"], ["Dark mode", "深色模式"], ["Blur radius", "模糊半径"], ["Brightness", "亮度"],
  ["Saturation", "饱和度"], ["Opacity", "不透明度"], ["Waves color", "波浪颜色"], ["Random background", "随机背景"],
  ["Choose image set", "选择图片组"], ["Custom image", "自定义图片"], ["Custom theme", "自定义主题"], ["Notebook background", "笔记本背景"],
  ["Grid notebook", "网格笔记本"], ["Dotted notebook", "点阵笔记本"], ["Stripe notebook", "条纹笔记本"],
  ["Attention", "注意"], ["Activate", "启用"], ["Enable", "启用"], ["Disable", "禁用"], ["Toggle", "切换"],
  ["Editing", "编辑模式"], ["Reading", "阅读模式"], ["Editing mode", "编辑模式"], ["Reading mode", "阅读模式"],
  ["all", "全部"], ["All", "全部"], ["Active", "活动"], ["Inactive", "非活动"], ["Primary", "主要"],
  ["Secondary", "次要"], ["Current", "当前"], ["Horizontal", "水平"], ["Vertical", "垂直"], ["Maximum", "最大"],
  ["Minimum", "最小"], ["Display", "显示"], ["Content", "内容"], ["Page", "页面"], ["File explorer", "文件浏览器"],
  ["Search", "搜索"], ["Result", "结果"], ["Results", "结果"], ["Position", "位置"], ["Alignment", "对齐"],
  ["Spacing", "间距"], ["Weight", "字重"], ["Family", "系列"], ["Shape", "形状"], ["Padding", "内边距"],
  ["Radius", "圆角"], ["Border", "边框"], ["Shadow", "阴影"], ["Option", "选项"], ["Pane", "窗格"], ["Panes", "窗格"],
  ["Before", "之前"], ["After", "之后"],
  ["auto hide", "自动隐藏"], ["header", "头部"], ["color", "颜色"], ["Color", "颜色"], ["image", "图片"], ["Image", "图片"],
  ["style", "样式"], ["Style", "样式"], ["settings", "设置"], ["Settings", "设置"], ["options", "选项"], ["Options", "选项"],
  ["Font", "字体"], ["font", "字体"], ["size", "大小"], ["Size", "大小"], ["width", "宽度"], ["Width", "宽度"],
  ["height", "高度"], ["Height", "高度"], ["line", "行"], ["Line", "行"], ["Table", "表格"], ["table", "表格"],
  ["folder", "文件夹"], ["Folder", "文件夹"], ["File", "文件"], ["file", "文件"], ["title", "标题"], ["Title", "标题"],
  ["text", "文字"], ["Text", "文字"], ["number", "数字"], ["Number", "数字"], ["Left", "左侧"], ["Right", "右侧"],
  ["Center", "居中"], ["Centre", "居中"], ["Top", "顶部"], ["Bottom", "底部"], ["Default", "默认"], ["Custom", "自定义"],
  ["Normal", "正常"], ["None", "无"], ["Hidden", "隐藏"], ["Visible", "显示"], ["Fast", "快速"], ["Static", "静态"], ["Dynamic", "动态"],
  ["Wrapped", "换行"], ["Non-wrapped", "不换行"], ["Outlined", "描边"], ["Rounded", "圆角"], ["Transparent", "透明"],
  ["Solid", "实线"], ["Dashed", "虚线"], ["Dotted", "点线"], ["Double", "双线"], ["On", "开启"], ["Off", "关闭"],
  ["Add", "添加"], ["Remove", "移除"], ["Hide", "隐藏"], ["Show", "显示"], ["Use", "使用"], ["Support", "支持"],
];

const replacementsSorted = replacements.sort((a, b) => b[0].length - a[0].length);

const exactFallbacks = new Map([
  ["Blue Topaz Default", "Blue Topaz 默认"],
  ["Blue Topaz Theme", "Blue Topaz 主题"],
  ["🥑Blue Topaz Theme", "🥑Blue Topaz 主题"],
  ["Topaz Community", "Topaz 社区"],
  ["Custom Text", "自定义文本"],
  ["Custom text", "自定义文本"],
  ["All image-1", "全部图片-1"],
  ["Active line color (Editing)", "当前行颜色（编辑模式）"],
  ["Flamingo (@Mouth on Cloud & @Rainbell)", "火烈鸟（@Mouth on Cloud 与 @Rainbell）"],
  ["Honey milk (@LillianWho)", "蜂蜜牛奶（@LillianWho）"],
  ["Lilac (@awyugan)", "丁香紫（@awyugan）"],
  ["Autumn (@LillianWho)", "秋季（@LillianWho）"],
  ["Simplicity (@Cuman)", "简约（@Cuman）"],
  ["Hovering (adapted from @subframe7536's css snippet)", "悬停（改编自 @subframe7536 的 CSS 代码片段）"],
  ["Bracket 2 (1.1.1)", "括号 2（1.1.1）"],
  ["Inspired from the CSS snippet by KillyMXI (https://gist.github.com/KillyMXI/cbef8edff6dd55d9e6ea4df66567e9b1)", "灵感来自 KillyMXI 的 CSS 代码片段（https://gist.github.com/KillyMXI/cbef8edff6dd55d9e6ea4df66567e9b1）"],
  ["Cat (GIF)", "猫（GIF）"],
  ["Rainbow tag alt (No influence on emojis)", "彩虹标签备用（不影响表情符号）"],
  ["Translucent (only for setting panel)", "半透明（仅用于设置面板）"],
  ["❗cssclass：inline-list❗ To make the list show in a horizontal row. Meanwhile, it makes the list show inline which can be used with inline images (like ![[xxx.jpg|inlineR]])", "❗cssclass：inline-list❗ 使列表以水平行显示，同时改为行内列表，可配合行内图片使用（例如 ![[xxx.jpg|inlineR]]）。"],
  ["2.3.15.1 Customised colorful tag", "2.3.15.1 自定义彩色标签"],
  ["2.3.2.1.1 Options for 'Blue Topaz Default'", "2.3.2.1.1 “Blue Topaz 默认”选项"],
  ["2.3.2.1.2 Options for 'Custom'", "2.3.2.1.2 “自定义”选项"],
  ["2.3.21 Tabs", "2.3.21 标签页"], ["3.11 Quiet outline", "3.11 Quiet outline"],
  ["3.6 Dataview", "3.6 Dataview"], ["3.6.1 Dataview list", "3.6.1 Dataview 列表"],
  ["3.7 Dialogue & Chatview", "3.7 Dialogue 与 Chatview"], ["3.9 ✏️Thino", "3.9 ✏️Thino"],
  ["=↓😺 Created by Topaz Community 🐵↓=", "=↓😺 由 Topaz 社区创建 🐵↓="],
  ["Adapted from @Quorafind's Thino Plugin", "改编自 @Quorafind 的 Thino 插件"],
  ["Adding things after", "在后方添加内容"], ["Adding things before", "在前方添加内容"],
  ["Animating waves", "动态波浪"], ["auto", "自动"], ["Avocado", "牛油果"], ["Blow Up Modal", "放大模态窗口"],
  ["Blue Mountain", "蓝山"], ["Bracket 1", "括号 1"], ["Bracket 3", "括号 3"], ["Bubble", "气泡"],
  ["Bubble padding", "气泡内边距"], ["Bubble radius", "气泡圆角"], ["Bubble, hide to left", "气泡，隐藏到左侧"],
  ["Canvas card size for \"Zoom to selection\"", "白板卡片大小（“缩放到所选内容”）"], ["Chat", "聊天"],
  ["Clear", "清除"], ["Customised colorful tag", "自定义彩色标签"], ["Dark sky", "暗色天空"],
  ["Fancy prompt 1", "精美提示框 1"], ["Fixed", "固定"], ["folder colorful  with  \"0-9\" or  \"A-Z\"", "文件夹按“0-9”或“A-Z”着色"],
  ["Frosted Glass", "磨砂玻璃"], ["Gradient", "渐变"], ["Green", "绿色"], ["Grid notebook line color for 'Grid 2'", "“网格 2”笔记本线条颜色"],
  ["Gruvbox Dark", "Gruvbox 深色"], ["h1 bg", "H1 背景"], ["In the sky", "天空中"], ["Invert colors", "反转颜色"],
  ["Jumping Mario", "跳跃马里奥"], ["Make it austere", "简洁模式"], ["Mixed orientation", "混合方向"], ["Monochrome", "单色"],
  ["Night sky", "夜空"], ["No rounded corners", "无圆角"], ["Note", "笔记"], ["Obsidian default", "Obsidian 默认"],
  ["Pac-man", "吃豆人"], ["Pill", "胶囊"], ["Pink", "粉色"], ["Plain", "普通"], ["Plant", "植物"],
  ["Pop-swirl", "波纹旋转"], ["Quick Scale Down", "快速缩小"], ["Rainbow tag", "彩虹标签"], ["Rectangle", "矩形"],
  ["Reversal", "反转"], ["Road Runner In", "Road Runner 进入"], ["Road Runner Out", "Road Runner 退出"], ["Shade", "阴影"],
  ["Shapes", "形状"], ["Slide Up Large", "大幅上滑"], ["Solarized Light", "Solarized 浅色"],
  ["solid, double, dotted, dashed, groove, ridge", "实线、双线、点线、虚线、凹槽线、脊线"],
  ["Speech Bubble 1", "对话气泡 1"], ["Speech Bubble 2", "对话气泡 2"], ["Star the theme", "收藏主题"],
  ["Switch on the above button to activate", "打开上方开关即可启用"], ["Tab-liked", "标签页风格"],
  ["Tag stacked pane with", "标签页堆叠窗格："], ["Tag-1", "标签-1"], ["Tag-2", "标签-2"], ["Tag-3", "标签-3"],
  ["Tag-4", "标签-4"], ["Tag-5", "标签-5"], ["Traditional", "传统"],
  ["type 'light, normal, bold, bolder; or 100-900'", "输入 light、normal、bold、bolder，或 100-900"],
  ["typy normal or italic", "输入 normal 或 italic"], ["Underline", "下划线"], ["Unfold In", "向内展开"],
  ["Wall", "壁纸"], ["Warm", "暖色"], ["Waves", "波浪"], ["Wechat", "微信"], ["with icons", "带图标"],
  ["with Numbers", "带数字"], ["With quotation mark", "带引号"], ["without icons", "不带图标"],
  ["Hovering", "悬停"], ["adapted from", "改编自"], ["Bracket", "括号"], ["Inspired from", "灵感来自"],
  ["Cat", "猫"], ["Rainbow tag alt", "彩虹标签备用"], ["No influence on emojis", "不影响表情符号"],
  ["Translucent", "半透明"], ["only for setting panel", "仅用于设置面板"], ["To make the list show in a horizontal row.", "使列表以水平行显示。"],
  ["Topaz-Nord", "Topaz-Nord"],
  ["Dataview", "Dataview"],
  ["Mermaid", "Mermaid"],
  ["Codebox", "Codebox"],
  ["Thino", "Thino"],
]);

function replaceSafe(value, sourceText, targetText) {
  if (!sourceText) return value;
  const escaped = sourceText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (/^[A-Za-z0-9][A-Za-z0-9 _-]*[A-Za-z0-9]$/.test(sourceText)) {
    return value.replace(new RegExp(`(?<![A-Za-z0-9])${escaped}(?![A-Za-z0-9])`, "g"), targetText);
  }
  return value.replaceAll(sourceText, targetText);
}

function cleanValue(value) {
  const text = String(value || "").trim();
  const quoted = text.match(/^(['"])([\s\S]*)\1$/);
  return (quoted ? quoted[2] : text).trim();
}

function fallback(value, useExact = true) {
  const original = cleanValue(value);
  if (!original) return original;
  if (useExact && exactFallbacks.has(original)) return exactFallbacks.get(original);
  if (useExact && exact.has(original)) return exact.get(original);
  let result = original;
  for (const [sourceText, targetText] of replacementsSorted) {
    result = replaceSafe(result, sourceText, targetText);
  }
  result = result
    .replace(/^(\d+(?:\.\d+)*)\s+Header\s+(\d+)$/i, "$1 标题 $2")
    .replace(/^(\d+(?:\.\d+)*)\s+(.+)$/, "$1 $2")
    .replace(/^Toggle\s+/, "切换")
    .replace(/^Disable\s+/, "禁用")
    .replace(/^Enable\s+/, "启用")
    .replace(/\(Editing\)/gi, "（编辑模式）")
    .replace(/\(Reading\)/gi, "（阅读模式）")
    .replace(/\(Light mode\)/gi, "（浅色模式）")
    .replace(/\(Dark mode\)/gi, "（深色模式）")
    .replace(/\s+\(([^()]*)\)/g, "（$1）")
    .replace(/\s+/g, " ")
    .trim();
  return result;
}

function translatedSibling(lines, index, indent, key) {
  const wanted = `${key}.zh:`;
  for (let cursor = index + 1; cursor < Math.min(lines.length, index + 4); cursor += 1) {
    const line = lines[cursor];
    if (!line.trim()) continue;
    const currentIndent = (line.match(/^\s*/) || [""])[0].length;
    if (currentIndent < indent) break;
    if (currentIndent === indent && line.trimStart().startsWith(`${wanted}`)) {
      return cleanValue(line.trimStart().slice(wanted.length));
    }
    if (currentIndent === indent && /^(title|description|label|id|type|name):/.test(line.trim())) break;
  }
  return "";
}

const lines = source.split(/\r?\n/);
const translations = new Map();
const add = (sourceText, targetText) => {
  const from = cleanValue(sourceText);
  const to = cleanValue(targetText);
  if (!from || !to || from === to) return;
  if (!translations.has(from)) translations.set(from, to);
};

for (let index = 0; index < lines.length; index += 1) {
  const match = lines[index].match(/^(\s*)(name|title|description|label):\s*(.*?)\s*$/);
  if (!match) continue;
  const indent = match[1].length;
  const key = match[2];
  const sourceText = cleanValue(match[3]);
  const localised = translatedSibling(lines, index, indent, key);
  add(sourceText, localised ? fallback(localised, false) : fallback(sourceText));
}

for (const [sourceText, targetText] of exact) add(sourceText, targetText);

const patch = {
  schemaVersion: 1,
  id: "blue-topaz-style-settings-zh",
  name: "Blue Topaz 主题 Style Settings 中文补丁",
  language: "zh-CN",
  enabled: true,
  target: {
    pluginId: "obsidian-style-settings",
    theme: "Blue Topaz",
    source: false,
  },
  translations: [...translations.entries()].map(([sourceText, targetText]) => ({
    source: sourceText,
    target: targetText,
  })),
};

fs.writeFileSync(outputPath, `${JSON.stringify(patch, null, 2)}\n`, "utf8");
console.log(`Generated ${patch.translations.length} rules at ${outputPath}`);
