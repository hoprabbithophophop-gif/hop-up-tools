#!/usr/bin/env node
/**
 * GAS(gas/)を本番Apps Scriptへ反映する唯一の入口。
 * 生の `clasp push` は .claude/hooks/check-gas-commit.sh で拒否される
 * （CLAUDE.md「GASの反映は必ず npm run gas:push を使う」）。
 *
 * clasp push は差分ではなく「今のgas/フォルダで本番を丸ごと入れ替える」動作なので、
 * 古いブランチ（mainから分岐した各worktree等）から実行すると事故になる。ここでは
 *   1. gas/配下の未コミット差分チェック
 *   2. 本番を一時ディレクトリに clasp pull して、ローカルのgas/と全ファイル突き合わせ
 *   3. 本番にあってローカルに無いファイル（削除される）→ --force-delete が無ければ中止
 *   4. 内容が違うファイル → 本番の中身がこのブランチのgit履歴に存在するか調べ、
 *      「安全（本番は過去のこのブランチの内容の巻き戻し）」か
 *      「危険（本番にこのブランチが持ったことのない内容がある＝上書きすると消える）」かを
 *      ラベル付けして提示。差分がある限り --confirm が無ければ中止
 * を行ってから実際に push する。
 *
 * 使い方:
 *   node scripts/gas-push.mjs --check           実際にはpushせず、差分の確認だけ行う
 *   node scripts/gas-push.mjs --confirm          内容差分があっても続行する
 *   node scripts/gas-push.mjs --confirm --force-delete   本番にしか無いファイルの削除も許可する
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2);
const checkOnly = args.includes('--check');
const confirmed = args.includes('--confirm');
const forceDelete = args.includes('--force-delete');

function run(cmd, opts = {}) {
  return execSync(cmd, { encoding: 'utf8', ...opts });
}

function normalize(bufOrStr) {
  return String(bufOrStr).replace(/\r\n/g, '\n');
}

const repoRoot = run('git rev-parse --show-toplevel').trim();
const gasDir = path.join(repoRoot, 'gas');

// 1) 未コミット差分チェック
const dirty = run('git status --porcelain -- gas/', { cwd: repoRoot }).trim();
if (dirty) {
  console.error('gas/配下に未コミットの変更があります。先に git commit してください:\n' + dirty);
  process.exit(1);
}

// 2) 本番を一時ディレクトリへ取得
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gas-push-check-'));
fs.copyFileSync(path.join(gasDir, '.clasp.json'), path.join(tmpDir, '.clasp.json'));
const claspignore = path.join(gasDir, '.claspignore');
if (fs.existsSync(claspignore)) fs.copyFileSync(claspignore, path.join(tmpDir, '.claspignore'));

try {
  run('clasp pull', { cwd: tmpDir, stdio: 'pipe' });
} catch (e) {
  console.error('本番の取得(clasp pull)に失敗しました。ネットワークやログイン状態を確認してください。');
  console.error('本番の状態が確認できない以上、安全のため push は行いません。');
  console.error(e.message || e);
  fs.rmSync(tmpDir, { recursive: true, force: true });
  process.exit(1);
}

// 3) ファイル一覧の突き合わせ
// clasp push が実際に送るのは .clasp.json の scriptExtensions/htmlExtensions/jsonExtensions
// (+ appsscript.json)だけ。.test.mjs 等のローカル専用ファイルまで対象にすると、
// 本番に無いだけの「新規」誤検出が出て manifest への信頼が薄れるため、ここで絞る。
const claspConfig = JSON.parse(fs.readFileSync(path.join(gasDir, '.clasp.json'), 'utf8'));
const pushExtensions = [
  ...(claspConfig.scriptExtensions || ['.js', '.gs']),
  ...(claspConfig.htmlExtensions || ['.html']),
  ...(claspConfig.jsonExtensions || ['.json']),
];
function isPushedFile(name) {
  if (name === 'appsscript.json') return true;
  return pushExtensions.some((ext) => name.endsWith(ext));
}
const localFiles = fs.readdirSync(gasDir).filter((f) => !f.startsWith('.') && isPushedFile(f) && fs.statSync(path.join(gasDir, f)).isFile());
const prodFiles = fs.readdirSync(tmpDir).filter((f) => !f.startsWith('.') && isPushedFile(f));

const onlyInLocal = localFiles.filter((f) => !prodFiles.includes(f)); // 新規追加（安全）
const onlyInProd = prodFiles.filter((f) => !localFiles.includes(f));  // 本番から消える
const inBoth = localFiles.filter((f) => prodFiles.includes(f));

// 4) 内容差分の方向判定（本番の中身が、このブランチの過去コミットに実在するか）
function fileHistory(relPath) {
  const out = run(`git log --format=%H -- "${relPath}"`, { cwd: repoRoot }).trim();
  return out ? out.split('\n') : [];
}
function contentAtCommit(commit, relPath) {
  try {
    return normalize(run(`git show ${commit}:"${relPath}"`, { cwd: repoRoot }));
  } catch {
    return null; // そのコミット時点でファイルが無い
  }
}
function prodContentIsInHistory(relPath, prodContent) {
  for (const c of fileHistory(relPath)) {
    if (contentAtCommit(c, relPath) === prodContent) return true;
  }
  return false;
}

const changed = [];
for (const f of inBoth) {
  const localContent = normalize(fs.readFileSync(path.join(gasDir, f)));
  const prodContent = normalize(fs.readFileSync(path.join(tmpDir, f)));
  if (localContent === prodContent) continue;
  const safe = prodContentIsInHistory(`gas/${f}`, prodContent);
  changed.push({
    file: f,
    direction: safe ? 'safe' : 'danger',
    localLines: localContent.split('\n').length,
    prodLines: prodContent.split('\n').length,
  });
}

// 5) manifest表示
console.log('=== gas push manifest ===');
if (onlyInLocal.length) console.log('[新規]  ' + onlyInLocal.join(', '));
for (const c of changed) {
  const label = c.direction === 'safe'
    ? '安全（本番は過去のこのブランチの内容＝巻き戻し）'
    : '★危険（本番にこのブランチが持ったことのない内容あり＝上書きすると消える）';
  console.log(`[変更]  ${c.file} — ${label}（本番${c.prodLines}行 → ローカル${c.localLines}行）`);
}
if (onlyInProd.length) console.log('[削除]  ' + onlyInProd.join(', ') + '（本番からこのファイルが消えます）');
if (!onlyInLocal.length && !changed.length && !onlyInProd.length) console.log('差分なし。');

const hasDanger = changed.some((c) => c.direction === 'danger');
const hasChange = changed.length > 0;
const hasDelete = onlyInProd.length > 0;

if (hasDelete && !forceDelete) {
  console.error('\n本番にあってローカルに無いファイルがあります。削除してよければ --force-delete を付けて再実行してください。');
  fs.rmSync(tmpDir, { recursive: true, force: true });
  process.exit(1);
}
if (hasChange && !confirmed) {
  console.error('\n内容の差分があります。上の一覧を確認し、問題なければ --confirm を付けて再実行してください。');
  if (hasDanger) console.error('★危険方向の変更が含まれています。本当にこれで良いか、特によく確認してください。');
  fs.rmSync(tmpDir, { recursive: true, force: true });
  process.exit(1);
}

fs.rmSync(tmpDir, { recursive: true, force: true });

if (checkOnly) {
  console.log('\n--check モードのため、ここで終了します（実際の push はしていません）。');
  process.exit(0);
}

console.log('\npush します...');
run('clasp push', { cwd: gasDir, stdio: 'inherit' });
console.log('push完了。');
