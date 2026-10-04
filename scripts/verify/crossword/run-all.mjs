// クロスワードの確かめの台本を、引数なしで全部まとめて1回で流す。
//
// ■ 検収役の流し方
//   node scripts/verify/crossword/run-all.mjs
// - 引数も環境変数も要らない。行き先と問題の番号は targets.json（base・puzzleId・hiddenPuzzleId・noImagePuzzleId）
// - 写真は 一時置き場/hop-up-tools-verify/crossword/<台本名>/ に置く。作業フォルダには書かない。環境変数 OUT があればそちら
// - 1本ずつ流すときも引数は要らない（node scripts/verify/crossword/check-edge.mjs など）。引数を渡せば引数が勝つ
// - 答えはブラウザに渡らない作りなので、最初に受付係に回を1つ始めてもらい、全部のマスを「1文字見る」で聞いて
//   一時置き場の _cache/ に控える。次からは控えを使う
// - 1本が落ちても次へ進む。台本ごとに OK/NG の数と最後の行を集め、最後に総括を出す。
//   全部 OK なら ALL OK、1つでも NG なら「NG あり」と NG の一覧。NG があれば終了コード 1
// - check-limits は最後に流す（削除の上限を1時間使い切るため）。回を始める上限（300/時）の連投は既定では流さない。
//   流すと1時間この回線から遊べなくなる（Hop の Chrome でも「混み合っています」・run-all の解く台本も軒並み NG）。
//   流すなら node scripts/verify/crossword/check-limits.mjs --start-limit
//
// ■ 台本と紙（docs/definition-of-done.md）の行
// - check-reporter-key: 守り「通報の『別々の3人』は IPv6 を /64 の帯で丸めてから数える」（reporterKey.ts をそのまま動かす。通信しない）
// - check-entry: 一覧「玄関 /crossword はギャラリー・見出しの右端に『作る』」／「作る画面は /crossword/create・解く画面の戻る矢印はギャラリーへ」
//   ／文面「トップページのツール一覧にクロスワードは載せない」「フッターに非公式の一文は無い」／「Xに投稿」の文は「解けた！　題名」＋URL
// - check-fixtures: 守り「隠された問題は URL を直接開いても中身が届かない・非表示の知らせ」「画像を置けなかった問題に無い画像を指す札は出ない」
// - check-maru-mine: 作る「カギの欄の○ボタン」／自分の問題「/crossword/mine の一覧・削除の確かめ・作る画面には入口がいつも出る」
// - check-create-width: 作る画面の入力欄が 390・960・1280px で画面に収まる（紙に専用の行は無い。見た目の崩れの確かめ）
// - check-stage1 --skip-save: 作る「ヒントを選ぶ（ハロプロで台帳に無い YouTube は断る・その他は URL の時刻が欄に入る）」
// - check-play-count: 解く「遊ばれた回数は最初の1文字で1増える・開いただけでは増えない・作った本人の端末では数えない」
// - check-resume: 解く「30分以上空いた続きで『前回の続きがあります』［はじめから］［つづきから］」
// - check-auto-check: 解く「最後の空きマスで答え合わせ・『どこかに間違いがあります。』『まだ埋まっていないマスがあります。』・赤枠と降参は無い」
// - check-edge: 解く「見られなくなりました」「この動画はヒントに使えません。」「非表示になったか、削除されました。」
//   「回の記録が無ければ始め直す」「混み合っています」／作る「https のリンクだけ」
// - check-reveal: 解く「1文字見る・初回だけの確かめ」／ランキング「印（ノーミス・ノーヒント・N文字見た）・回の番号だけを送る」
// - check-own-ranking: ランキング「作った本人の端末では窓を出さない・字の数×1秒より速い回は載せない」
// - check-name-report: ランキング「旗から名前を通報」
// - check-real-score: ランキング「本物のランキングに載り、タイムと印は回の記録から出る」
// - check-iphone: iPhone の大きさと WebKit で、作る・解く・ヒント・1文字見る・クリア・引き継ぎ（CW1-）・プライバシーポリシーを通しで
// - check-limits: 守り「削除の受付係は同じ接続元で1時間20回」「本文を読む前に大きさで断る（play 8192・save 450000 バイト）」
//   ／（--start-limit の時だけ）解く「回を始める上限は同じ接続元で1時間300回」
//
// ■ 保存が要るため検収役では流せない物（保存は人間確認 Turnstile を通る必要があり、機械のブラウザでは通らない）
// - check-stage1 の 1〜4: 組み立ての動き・保存して URL が出る・構築中の動き・タイマーが進む・文字盤の濁点と小さい字・
//   ヒントの YouTube が時刻つきで自動再生しない・開き直しても残る・途中の答え合わせ
//   このうち「途中の答え合わせ」は check-auto-check、「ヒントのプレイヤー」は check-edge・check-iphone でも見ている。
//   残りはほかの台本では見ていない
//
// ■ 本番に残る行とその印
// - crossword_scores（ランキング）: check-real-score が1回につき1行。名前は「検収」＋月日時分（例: 検収10050321）。問題は targets.json の puzzleId
// - crossword_plays（遊んでいる回）: 答えの配置を聞くとき・解く台本のほぼすべて・check-limits --start-limit（空の回が最大300行）。
//   回には名前の欄が無く印を付けられない。問題が puzzleId の回で、何もしていない回は1日、それ以外は30日で片付く。
//   回の番号を出す台本（check-edge・check-reveal・check-real-score）はその番号で見分ける
// - rate_limit_log（上限の数え）: check-limits と各台本の回の始め。1時間で片付く
// - crossword_puzzles（問題）: check-stage1 の 1〜4 を Hop の Chrome で流した時だけ。題名が「検収用」で始まる
// - 遊ばれた回数（touch）・ランキングへの送信（check-real-score 以外）・名前の通報は台本が途中で受け止めて本物には届けない。
//   check-limits の削除の連投は、でたらめな合言葉なので何も消さない
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { SCRIPT_DIR, ROOT, TMP_ROOT, TARGETS, puzzleLayout } from './_lib.mjs';

const results = [];
const t00 = Date.now();
console.log(`== クロスワードの確かめ一式 ／ 行き先 ${TARGETS.base} ／ 問題 ${TARGETS.puzzleId}`);
console.log(`== 写真の置き場: ${TMP_ROOT}\n`);

// 答えの配置を先に1回だけ聞いて控える（各台本はこの控えを使う）
try {
  const l = await puzzleLayout(TARGETS.base, TARGETS.puzzleId);
  console.log(`答えの配置: ${Object.keys(l.cells).length}マス（控え ${l.fetchedAt}）\n`);
} catch (e) {
  console.log(`答えの配置を聞けなかった: ${e.message}（解く台本は落ちる見込み）\n`);
}

function run(name, args = [], paper = '') {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [path.join(SCRIPT_DIR, `${name}.mjs`), ...args], { encoding: 'utf8', cwd: ROOT, timeout: 900000 });
  const out = ((r.stdout || '') + (r.stderr || '')).split(/\r?\n/).map((l) => l.trimEnd()).filter((l) => l && !/ExperimentalWarning|--trace-warnings/.test(l));
  const okN = out.filter((l) => l.startsWith('OK ')).length;
  const ngLines = out.filter((l) => l.startsWith('NG ') && !/^NG \d+件/.test(l));
  const timedOut = r.error?.code === 'ETIMEDOUT';
  const good = r.status === 0 && ngLines.length === 0 && okN > 0;
  const last = timedOut ? '時間切れ（900秒）' : out.at(-1) || '(出力なし)';
  results.push({ name, paper, good, okN, ngN: ngLines.length, ngLines, last, code: r.status, sec: ((Date.now() - t0) / 1000).toFixed(0) });
  console.log(`${good ? 'OK' : 'NG'} ${name}（OK ${okN} ／ NG ${ngLines.length} ／ 終了コード ${r.status} ／ ${results.at(-1).sec}秒）`);
  for (const l of out) console.log('   ' + l);
  console.log('');
}
function skip(name, why) {
  results.push({ name, skipped: true, last: why });
  console.log(`飛ばす ${name}: ${why}\n`);
}

run('check-reporter-key');
run('check-suggest');
run('check-entry');
run('check-fixtures');
run('check-maru-mine');
run('check-create-width');
skip('check-stage1 の 1〜4（作って保存し、その URL で解く）', '保存が要るため検収役では流せない。Hop の Chrome で確認済み');
run('check-stage1', ['--skip-save']);
run('check-play-count');
run('check-resume');
run('check-auto-check');
run('check-edge');
run('check-reveal');
run('check-own-ranking');
run('check-name-report');
run('check-real-score');
run('check-iphone');
run('check-limits'); // 最後（削除の上限を使い切る）。回を始める上限の連投 (b) は既定では飛ばす（台本が理由を1行出す）
results.push({ name: 'check-limits の (b) 回を始める連投', skipped: true, last: '回を始める上限（300/時）は同じ数え方の削除の上限（21回目で429）で確かめている。流すと1時間この回線から遊べなくなるため既定では飛ばす。流すなら node scripts/verify/crossword/check-limits.mjs --start-limit' });

const ng = results.filter((r) => !r.skipped && !r.good);
console.log('==== 総括 ====');
for (const r of results) {
  if (r.skipped) console.log(`飛ばす ${r.name}: ${r.last}`);
  else console.log(`${r.good ? 'OK' : 'NG'} ${r.name}: OK ${r.okN} ／ NG ${r.ngN} ／ 最後の行「${r.last}」`);
}
console.log('');
if (ng.length === 0) console.log('ALL OK');
else {
  console.log(`NG あり（${ng.length}本）`);
  for (const r of ng) {
    console.log(`  ${r.name}（終了コード ${r.code}）`);
    for (const l of r.ngLines) console.log(`    ${l}`);
    if (!r.ngLines.length) console.log(`    最後の行: ${r.last}`);
  }
}
console.log(`\n写真の置き場: ${TMP_ROOT}`);
console.log(`かかった時間: ${((Date.now() - t00) / 60000).toFixed(1)}分`);
process.exit(ng.length ? 1 : 0);
