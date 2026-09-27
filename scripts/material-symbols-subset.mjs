// Material Symbols のアイコンフォントを、コードで使っているアイコンだけに絞って読み込むための仕組み。
// vite.config.ts の materialSymbolsSubset() から呼ばれ、index.html に読み込み用の <link> を差し込む。
//
// アイコン名の拾い方（src 配下の .tsx / .ts を TypeScript の構文解析で読む）:
//   1. className に material-symbols-outlined を含む要素の子の文字（例: <span ...>close</span>）
//   2. 同じ子の {...} の中の文字列（例: {isPlaying ? 'pause' : 'play_arrow'}）
//   3. 子が {icon} のときは、src 全体の icon="..." / icon: "..." をアイコン名として拾う
// これ以外の書き方（{name} など）で名前を渡している箇所があると、ビルドを止めて場所を知らせる。
// 一覧に無いアイコンは表示されなくなるため、拾い漏れを黙って通さないための止め。
//
// 単体で実行すると拾ったアイコン名と読み込み先URLを表示する: node scripts/material-symbols-subset.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const CLASS_NAME = "material-symbols-outlined";
const ICON_PROP = "icon";
const NAME_RE = /^[a-z0-9_]+$/;

function listSourceFiles(dir) {
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...listSourceFiles(p));
    else if (/\.(tsx|ts)$/.test(ent.name) && !ent.name.endsWith(".d.ts")) out.push(p);
  }
  return out;
}

function hasIconClass(openingElement) {
  for (const attr of openingElement.attributes.properties) {
    if (!ts.isJsxAttribute(attr) || attr.name.getText() !== "className" || !attr.initializer) continue;
    if (attr.initializer.getText().includes(CLASS_NAME)) return true;
  }
  return false;
}

function collectStrings(node, into) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) into.push(node.text);
  ts.forEachChild(node, (c) => collectStrings(c, into));
}

function collectIdentifiers(node, into) {
  // 条件式の条件部分（a ? b : c の a）は名前ではないので見ない
  if (ts.isConditionalExpression(node)) {
    collectIdentifiers(node.whenTrue, into);
    collectIdentifiers(node.whenFalse, into);
    return;
  }
  if (ts.isIdentifier(node)) { into.push(node.text); return; }
  if (ts.isPropertyAccessExpression(node) || ts.isCallExpression(node) || ts.isElementAccessExpression(node)) {
    into.push(node.getText());
    return;
  }
  ts.forEachChild(node, (c) => collectIdentifiers(c, into));
}

export function collectIconNames(srcDir) {
  const names = new Set();
  const problems = [];
  let usesIconProp = false;
  const iconPropNames = new Set();

  for (const file of listSourceFiles(srcDir)) {
    const text = fs.readFileSync(file, "utf8");
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const where = (n) => `${path.relative(process.cwd(), file)}:${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1}`;

    const visit = (node) => {
      // icon="..." / icon={'...'} / icon: "..."
      if (ts.isJsxAttribute(node) && node.name.getText() === ICON_PROP && node.initializer) {
        const strs = [];
        collectStrings(node.initializer, strs);
        strs.forEach((s) => NAME_RE.test(s) && iconPropNames.add(s));
      }
      if (ts.isPropertyAssignment(node) && node.name.getText() === ICON_PROP && (ts.isStringLiteral(node.initializer) || ts.isNoSubstitutionTemplateLiteral(node.initializer))) {
        if (NAME_RE.test(node.initializer.text)) iconPropNames.add(node.initializer.text);
      }

      if (ts.isJsxElement(node) && hasIconClass(node.openingElement)) {
        for (const child of node.children) {
          if (ts.isJsxText(child)) {
            const t = child.getText().trim();
            if (!t) continue;
            if (NAME_RE.test(t)) names.add(t);
            else problems.push(`${where(child)} アイコン名として読めない文字: "${t}"`);
          } else if (ts.isJsxExpression(child) && child.expression) {
            const strs = [];
            collectStrings(child.expression, strs);
            strs.forEach((s) => NAME_RE.test(s) && names.add(s));
            const ids = [];
            collectIdentifiers(child.expression, ids);
            for (const id of ids) {
              if (id === ICON_PROP) usesIconProp = true;
              else problems.push(`${where(child)} アイコン名を {${id}} で渡している。icon="..." か icon: "..." の形にするか、この仕組みに書き方を足す`);
            }
          } else {
            problems.push(`${where(child)} アイコンの中に想定外の要素がある`);
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }

  if (usesIconProp) iconPropNames.forEach((n) => names.add(n));
  if (problems.length) {
    throw new Error(`[material-symbols-subset] アイコン名を拾えない箇所があります:\n  ${problems.join("\n  ")}`);
  }
  if (!names.size) throw new Error("[material-symbols-subset] アイコンが1つも見つかりません");
  return [...names].sort();
}

// 太さ400・大きさ24・GRAD 0 に固定（index.html の font-variation-settings と揃える）。
// 塗り(FILL)は 0 と 1 の両方を使っているので幅を残す。
export function buildFontUrl(names) {
  return "https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@24,400,0..1,0"
    + `&icon_names=${names.join(",")}&display=block`;
}

export function materialSymbolsSubset({ srcDir }) {
  return {
    name: "material-symbols-subset",
    transformIndexHtml() {
      const url = buildFontUrl(collectIconNames(srcDir));
      return [{ tag: "link", attrs: { rel: "stylesheet", href: url }, injectTo: "head" }];
    },
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const names = collectIconNames(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src"));
  console.log(`${names.length} icons: ${names.join(" ")}`);
  console.log(buildFontUrl(names));
}
