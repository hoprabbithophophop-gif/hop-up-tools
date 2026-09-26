// 原石の版の「曲の区切りと削れ具合」（stoneTimeline.ts）を、画面を使わずに確かめる。
// 使い方: node --experimental-strip-types scripts/verify/hai-to-diamond/test-stone-timeline.mjs
import { SECTIONS, COMPLETE_TIME, RAIN_TIME, cutFractionAt, sectionAt, sectionProgress, isCompleteAt } from '../../../src/pages/hai-to-diamond/stone/stoneTimeline.ts';

let n = 0, ng = 0;
const check = (name, ok, got) => { n++; if (!ok) ng++; console.log(`${ok ? '合' : '否'} ${name}${ok ? '' : ' ／ 実際 ' + String(got)}`); };

// 区切りの終わりは Hop 指定の時刻どおり（依頼文 2026-09-26）
const ends = { intro: 27, headChorus: 42, prelude: 56, verseA: 86, verseB: 102, chorus: 132, interlude: 147, verseA2: 162, verseB2: 178, rap: 193, epiano: 208, finalChorus: 253, outro: 270 };
for (const [k, e] of Object.entries(ends)) check(`区切り ${k} の終わりは ${e} 秒`, SECTIONS.find((s) => s.key === k)?.end === e, SECTIONS.find((s) => s.key === k)?.end);
check('最後の区切りは歓声で終わりが無い', SECTIONS[SECTIONS.length - 1].key === 'cheers' && SECTIONS[SECTIONS.length - 1].end === Infinity);

// 削れ具合は時刻に対して減らない（純関数・単調）
let prev = -1, mono = true, bad = null;
for (let t = 0; t <= 300; t += 0.05) { const c = cutFractionAt(t); if (c < prev - 1e-9) { mono = false; bad = t; break; } prev = c; }
check('削れ具合は時刻が進んで減らない', mono, bad);
check('0秒で 0', cutFractionAt(0) === 0, cutFractionAt(0));
check('前奏の終わり（56秒）でまだ 0', cutFractionAt(55.99) === 0, cutFractionAt(55.99));
for (const s of SECTIONS) if (Number.isFinite(s.end)) check(`区切り ${s.key} の終わりの直前で cutEnd=${s.cutEnd} に届く`, Math.abs(cutFractionAt(s.end - 1e-6) - s.cutEnd) < 1e-3, cutFractionAt(s.end - 1e-6));
check('完成の瞬間で 1', cutFractionAt(COMPLETE_TIME) === 1, cutFractionAt(COMPLETE_TIME));
check('完成の直前は 1 未満', cutFractionAt(COMPLETE_TIME - 0.5) < 1, cutFractionAt(COMPLETE_TIME - 0.5));
check('完成の瞬間は大サビの頭から数秒後', COMPLETE_TIME > 208 && COMPLETE_TIME <= 215, COMPLETE_TIME);
check('降り注ぎは 4:30', RAIN_TIME === 270, RAIN_TIME);
check('isCompleteAt', !isCompleteAt(COMPLETE_TIME - 0.01) && isCompleteAt(COMPLETE_TIME));

// ラップは階段（1拍ごとに増える・拍の途中では変わらない）
const rapStart = 178;
const a = cutFractionAt(rapStart + 0.2), b = cutFractionAt(rapStart + 0.8), c = cutFractionAt(rapStart + 1.2);
check('ラップは拍の途中で変わらない', a === b, [a, b]);
check('ラップは次の拍で増える', c > b, [b, c]);
const steps = new Set(); for (let t = rapStart; t < 193; t += 0.01) steps.add(cutFractionAt(t).toFixed(6));
check('ラップの段の数は 15', steps.size === 15, steps.size);
const est = new Set(); for (let t = 193; t < 208; t += 0.01) est.add(cutFractionAt(t).toFixed(6));
check('エレピの段の数は 15', est.size === 15, est.size);

check('sectionAt(100) は verseB', sectionAt(100).key === 'verseB', sectionAt(100).key);
check('sectionProgress は区切りの中で 0→1', sectionProgress(86.0001) < 0.01 && sectionProgress(101.99) > 0.99, [sectionProgress(86.0001), sectionProgress(101.99)]);
check('歓声パートの進みは 10 秒で 1', sectionProgress(280) === 1, sectionProgress(280));

console.log(`確かめ ${n}件 ／ 合 ${n - ng} ／ 否 ${ng}`);
process.exit(ng ? 1 : 0);
