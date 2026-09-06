const fs = require("fs");

function isWordCharacter(value) {
  return value != null && /[A-Za-z0-9_$]/.test(value);
}

function replaceSourceLiteral(code, source, target) {
  let result = "";
  let cursor = 0;
  while (cursor < code.length) {
    const index = code.indexOf(source, cursor);
    if (index < 0) return result + code.slice(cursor);
    const before = index > 0 ? code[index - 1] : "";
    const after = code[index + source.length] || "";
    const bounded = !isWordCharacter(source[0]) || !isWordCharacter(before);
    const boundedEnd = !isWordCharacter(source[source.length - 1]) || !isWordCharacter(after);
    result += code.slice(cursor, index);
    result += bounded && boundedEnd ? target : source;
    cursor = index + source.length;
  }
  return result;
}

const [sourcePath, patchPath, outputPath] = process.argv.slice(2);
const patch = JSON.parse(fs.readFileSync(patchPath, "utf8"));
let code = fs.readFileSync(sourcePath, "utf8");
for (const entry of patch.translations
  .filter((item) => !item.regex && !item.selector && item.source !== item.target)
  .sort((a, b) => b.source.length - a.source.length)) {
  code = replaceSourceLiteral(code, entry.source, entry.target);
}
new Function(code);
fs.writeFileSync(outputPath, code, "utf8");
console.log(`Validated translated bundle (${code.length} characters).`);
