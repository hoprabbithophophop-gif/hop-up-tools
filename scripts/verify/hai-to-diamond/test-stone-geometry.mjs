// 「原石の版」の形（stone/stoneGeometry.ts）を、画面を通さずに単体で確かめる。
// 面の数・向き・平らさ・継ぎ目・原石がダイヤを包むこと・削れる順番・原石とダイヤの間の形の端を見る。
// 使い方: どこからでも `node --experimental-strip-types scripts/verify/hai-to-diamond/test-stone-geometry.mjs`
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const G = await import(pathToFileURL(path.join(ROOT, 'src/pages/hai-to-diamond/stone/stoneGeometry.ts')).href);

let ok = 0, ng = 0;
const check = (name, cond, detail) => { if (cond) ok++; else { ng++; console.log('✗', name, detail ?? ''); } };

const mesh = G.buildStoneMesh(1);
const nV = mesh.fine.length / 3, nF = mesh.faces.length;
const P = (arr, v) => [arr[v * 3], arr[v * 3 + 1], arr[v * 3 + 2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a) => Math.hypot(a[0], a[1], a[2]);

// ─── 面の数 ───
const want = { table: 1, star: 8, bezel: 8, upperGirdle: 16, girdle: 16, lowerGirdle: 16, pavilion: 8, culet: 1 };
const byKind = {};
for (const f of mesh.faces) byKind[f.kind] = (byKind[f.kind] || 0) + 1;
check('面の数は74（腰の帯16を含む）', nF === 74, nF);
for (const [k, n] of Object.entries(want)) check(`${k} の面は ${n} 枚`, byKind[k] === n, byKind[k]);
check('頂点の配列の長さが fine と rough で同じ', mesh.fine.length === mesh.rough.length);

// ─── ダイヤの大きさ・上下 ───
let maxR = 0, minY = Infinity, maxY = -Infinity;
for (let v = 0; v < nV; v++) { const p = P(mesh.fine, v); maxR = Math.max(maxR, len(p)); minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]); }
check('ダイヤは半径およそ1の球に収まる（1.1以下）', maxR <= 1.1 && maxR >= 0.9, maxR.toFixed(3));
const cen = (arr, f) => { const vs = mesh.faces[f].verts; const c = [0, 0, 0]; for (const v of vs) { const p = P(arr, v); c[0] += p[0]; c[1] += p[1]; c[2] += p[2]; } return c.map((x) => x / vs.length); };
const fTable = mesh.faces.findIndex((f) => f.kind === 'table'), fCulet = mesh.faces.findIndex((f) => f.kind === 'culet');
check('テーブルがいちばん上（+y）', Math.abs(cen(mesh.fine, fTable)[1] - maxY) < 1e-5);
check('尖りがいちばん下（-y）', Math.abs(cen(mesh.fine, fCulet)[1] - minY) < 1e-5);

// ─── 向き・平らさ・凸 ───
const body = [0, 0, 0];
for (let v = 0; v < nV; v++) { const p = P(mesh.fine, v); body[0] += p[0] / nV; body[1] += p[1] / nV; body[2] += p[2] / nV; }
let outward = 0, planarWorst = 0, convexWorst = 0, normalLen = 0;
const n = [0, 0, 0], c = [0, 0, 0];
for (let f = 0; f < nF; f++) {
  G.faceNormal(mesh, mesh.fine, f, n);
  G.faceCenter(mesh, mesh.fine, f, c);
  normalLen = Math.max(normalLen, Math.abs(len(n) - 1));
  if (dot(n, sub(c, body)) > 0) outward++;
  for (const v of mesh.faces[f].verts) planarWorst = Math.max(planarWorst, Math.abs(dot(n, sub(P(mesh.fine, v), c))));
  for (let v = 0; v < nV; v++) convexWorst = Math.max(convexWorst, dot(n, sub(P(mesh.fine, v), c)));
}
check('法線は長さ1', normalLen < 1e-5, normalLen);
check('すべての面が外を向いている（表から見て反時計回り）', outward === nF, `${outward}/${nF}`);
check('ダイヤの面はすべて平ら（ずれ 1e-3 未満）', planarWorst < 1e-3, planarWorst.toExponential(2));
check('ダイヤは凸（どの頂点もどの面の外に出ない）', convexWorst < 1e-4, convexWorst.toExponential(2));

// ─── 継ぎ目（すべての縁がちょうど2枚の面で共有され、V−E+F=2）───
const edgeUse = new Map();
for (const f of mesh.faces) for (let i = 0; i < f.verts.length; i++) {
  const a = f.verts[i], b = f.verts[(i + 1) % f.verts.length];
  const k = Math.min(a, b) + ',' + Math.max(a, b);
  const dir = a < b ? 1 : -1;
  const e = edgeUse.get(k) || { n: 0, s: 0 }; e.n++; e.s += dir; edgeUse.set(k, e);
}
check('すべての縁がちょうど2枚の面で共有される', [...edgeUse.values()].every((e) => e.n === 2));
check('隣り合う面の回り方が揃っている（縁を逆向きにたどる）', [...edgeUse.values()].every((e) => e.s === 0));
check('V − E + F = 2（穴の無い閉じた形）', nV - edgeUse.size + nF === 2, `${nV}-${edgeUse.size}+${nF}`);
const ce = G.crackEdges(mesh);
check('ひびの縁は重複なしで全部', ce.length === edgeUse.size && new Set(ce.map(([a, b]) => a + ',' + b)).size === ce.length, ce.length);
check('ひびの縁は同じ配列を返す（取っておいた物）', G.crackEdges(mesh) === ce);

// ─── 原石がダイヤを包む ───
let pushWorst = Infinity;
for (let v = 0; v < nV; v++) pushWorst = Math.min(pushWorst, len(P(mesh.rough, v)) - len(P(mesh.fine, v)));
check('全頂点で 原石の距離 ≥ ダイヤの距離（原点から）', pushWorst >= 0.059, pushWorst.toFixed(4));
let rr = 0;
for (let v = 0; v < nV; v++) rr = Math.max(rr, len(P(mesh.rough, v)));
check('roughRadius は原石の外接半径', Math.abs(rr - mesh.roughRadius) < 1e-5, `${rr} / ${mesh.roughRadius}`);
// 原点から光線を出し、ダイヤの頂点と面の中心が原石の面の内側にあるかを見る（原石は原点から見て星形なので、最初に当たる面で判定できる）
const rayHit = (dir) => {
  let best = Infinity;
  for (const f of mesh.faces) {
    const vs = f.verts, a = P(mesh.rough, vs[0]);
    for (let i = 1; i + 1 < vs.length; i++) {
      const b = P(mesh.rough, vs[i]), cc = P(mesh.rough, vs[i + 1]);
      const e1 = sub(b, a), e2 = sub(cc, a);
      const pv = [dir[1] * e2[2] - dir[2] * e2[1], dir[2] * e2[0] - dir[0] * e2[2], dir[0] * e2[1] - dir[1] * e2[0]];
      const det = dot(e1, pv); if (Math.abs(det) < 1e-12) continue;
      const tv = [-a[0], -a[1], -a[2]];
      const u = dot(tv, pv) / det; if (u < -1e-6 || u > 1 + 1e-6) continue;
      const qv = [tv[1] * e1[2] - tv[2] * e1[1], tv[2] * e1[0] - tv[0] * e1[2], tv[0] * e1[1] - tv[1] * e1[0]];
      const w = dot(dir, qv) / det; if (w < -1e-6 || u + w > 1 + 1e-6) continue;
      const t = dot(e2, qv) / det; if (t > 0 && t < best) best = t;
    }
  }
  return best;
};
const containCount = (m) => {
  const saved = mesh.rough; mesh.rough = m.rough; // rayHit は mesh.rough を見るので一時的に差し替える
  let inside = 0, samples = 0;
  const probe = (p) => { samples++; const l = len(p); const t = rayHit(p.map((x) => x / l)); if (t >= l) inside++; };
  for (let v = 0; v < nV; v++) probe(P(m.fine, v));
  for (let f = 0; f < nF; f++) probe(cen(m.fine, f));
  for (const [a, b] of edgeUse.keys().map((k) => k.split(',').map(Number))) { const pa = P(m.fine, a), pb = P(m.fine, b); probe([(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2, (pa[2] + pb[2]) / 2]); }
  mesh.rough = saved;
  return { inside, samples };
};
const c1 = containCount(mesh);
check('ダイヤの頂点・面の中心・縁の中点がすべて原石の中にある（種1）', c1.inside === c1.samples, `${c1.inside}/${c1.samples}`);
let seedBad = [];
for (let sd = 2; sd <= 21; sd++) { const r = containCount(G.buildStoneMesh(sd)); if (r.inside !== r.samples) seedBad.push(`${sd}:${r.inside}/${r.samples}`); }
check('種を20通り変えても、原石がダイヤを包む', seedBad.length === 0, seedBad.join(' '));

// ─── 削れる順番 ───
const ranks = mesh.faces.map((f) => f.cutRank);
check('cutRank は全面 0..1', ranks.every((r) => Number.isFinite(r) && r >= 0 && r <= 1));
check('cutRank に同じ値が無い（1枚ずつ削れる）', new Set(ranks).size === nF);
const maxOf = (kinds) => Math.max(...mesh.faces.filter((f) => kinds.includes(f.kind)).map((f) => f.cutRank));
const minOf = (kinds) => Math.min(...mesh.faces.filter((f) => kinds.includes(f.kind)).map((f) => f.cutRank));
check('腰の帯と上の腰の三角が先（0〜0.20）', minOf(['girdle', 'upperGirdle']) >= 0 && maxOf(['girdle', 'upperGirdle']) <= 0.2 + 1e-9);
check('主な面（クラウン・パビリオン・下の腰の三角）は 0.22〜0.88', minOf(['bezel', 'star', 'pavilion', 'lowerGirdle']) >= 0.22 - 1e-9 && maxOf(['bezel', 'star', 'pavilion', 'lowerGirdle']) <= 0.88 + 1e-9);
// 下の腰の三角が主な面の組に混ざっている（先頭や末尾にまとまっていない）＝「柄」が出ない順番
const lgSorted = mesh.faces.map((f, i) => i).filter((i) => ['bezel', 'star', 'pavilion', 'lowerGirdle'].includes(mesh.faces[i].kind)).sort((a, b) => ranks[a] - ranks[b]);
const lgPos = lgSorted.map((f, i) => (mesh.faces[f].kind === 'lowerGirdle' ? i : -1)).filter((i) => i >= 0);
check('下の腰の三角は主な面に混ぜて削る', lgPos[0] < 3 && lgPos[lgPos.length - 1] > lgSorted.length - 4, lgPos.join(','));
check('テーブルは 0.9 以降', ranks[fTable] >= 0.9);
check('尖りが最後', ranks[fCulet] === Math.max(...ranks));
// クラウンとパビリオンが交互（パビリオンが後ろにまとまっていない）: 前半にも後半にもパビリオンがある
const mainSorted = mesh.faces.map((f, i) => i).filter((i) => ['bezel', 'star', 'pavilion'].includes(mesh.faces[i].kind)).sort((a, b) => ranks[a] - ranks[b]);
const pavPos = mainSorted.map((f, i) => (mesh.faces[f].kind === 'pavilion' ? i : -1)).filter((i) => i >= 0);
check('クラウンとパビリオンが交互に削れる', pavPos[0] < 3 && pavPos[pavPos.length - 1] > mainSorted.length - 4, pavPos.join(','));
// 同じ種類の中で、続けて削れる2枚が頂点を共有しない（周方向に散っている）
const sharesVertex = (a, b) => mesh.faces[a].verts.some((v) => mesh.faces[b].verts.includes(v));
let adjBad = [];
for (const k of Object.keys(want)) {
  const list = mesh.faces.map((f, i) => i).filter((i) => mesh.faces[i].kind === k).sort((a, b) => ranks[a] - ranks[b]);
  for (let i = 0; i + 1 < list.length; i++) if (sharesVertex(list[i], list[i + 1])) adjBad.push(`${k}:${list[i]}-${list[i + 1]}`);
}
check('同じ種類の中で、続けて削れる面が隣り合わない（頂点も共有しない）', adjBad.length === 0, adjBad.join(' '));
// 全体の並びで続けて削れる2枚が、同じ種類で隣り合うことも無い
const allSorted = mesh.faces.map((f, i) => i).sort((a, b) => ranks[a] - ranks[b]);
let globalBad = 0;
for (let i = 0; i + 1 < allSorted.length; i++) if (mesh.faces[allSorted[i]].kind === mesh.faces[allSorted[i + 1]].kind && sharesVertex(allSorted[i], allSorted[i + 1])) globalBad++;
check('全体の並びでも、続けて削れる同じ種類の面が隣り合わない', globalBad === 0, globalBad);
// 決定的: 同じ種なら同じ形・同じ順番、違う種なら原石が変わる
const again = G.buildStoneMesh(1), other = G.buildStoneMesh(7);
check('同じ種なら同じ原石・同じ順番', again.rough.every((x, i) => x === mesh.rough[i]) && again.faces.every((f, i) => f.cutRank === ranks[i]));
check('違う種なら原石の形が変わる', other.rough.some((x, i) => x !== mesh.rough[i]));
check('違う種でもダイヤの形は同じ', other.fine.every((x, i) => x === mesh.fine[i]));
check('既定の種は 1', G.buildStoneMesh().rough.every((x, i) => x === mesh.rough[i]));

// ─── 原石とダイヤの間の形 ───
const out = new Float32Array(mesh.fine.length);
G.morphVertices(mesh, new Float32Array(nF).fill(0), out);
check('削れ 0 で原石と一致', out.every((x, i) => x === mesh.rough[i]));
G.morphVertices(mesh, new Float32Array(nF).fill(1), out);
check('削れ 1 でダイヤと一致', out.every((x, i) => Math.abs(x - mesh.fine[i]) < 1e-6));
G.morphVertices(mesh, new Float32Array(nF).fill(5), out);
check('削れが 1 を越えてもダイヤの位置で止まる', out.every((x, i) => Math.abs(x - mesh.fine[i]) < 1e-6));
// 1枚だけ削れた時、その面の頂点はダイヤの位置、面に触れていない頂点は原石の位置
const one = new Float32Array(nF); one[fTable] = 1;
G.morphVertices(mesh, one, out);
const tv = new Set(mesh.faces[fTable].verts);
let oneOk = true;
for (let v = 0; v < nV; v++) {
  const want3 = tv.has(v) ? P(mesh.fine, v) : P(mesh.rough, v);
  if (len(sub(P(out, v), want3)) > 1e-6) oneOk = false;
}
check('頂点の削れ量は共有する面の最大値（1枚だけ削った時）', oneOk);
const half = new Float32Array(nF).fill(0.5);
G.morphVertices(mesh, half, out);
check('削れ 0.5 で原石とダイヤのちょうど間', out.every((x, i) => Math.abs(x - (mesh.rough[i] + mesh.fine[i]) / 2) < 1e-6));
// 速さの目安（毎コマ呼ぶ）
const cutT = new Float32Array(nF).map((_, i) => (i % 7) / 7);
const t0 = performance.now();
for (let i = 0; i < 10000; i++) G.morphVertices(mesh, cutT, out);
const us = ((performance.now() - t0) / 10000) * 1000;
check('morphVertices は1回 50µs 未満', us < 50, us.toFixed(2) + 'µs');

console.log(`面 ${nF} ／ 頂点 ${nV} ／ 縁 ${edgeUse.size} ／ 原石の外接半径 ${mesh.roughRadius.toFixed(3)} ／ ダイヤの外接半径 ${maxR.toFixed(3)}`);
console.log(`確かめ ${ok + ng}件 ／ 合 ${ok} ／ 否 ${ng}`);
process.exit(ng ? 1 : 0);
