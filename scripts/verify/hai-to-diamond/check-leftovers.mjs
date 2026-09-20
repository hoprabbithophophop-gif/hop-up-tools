// 検収や確かめの「動かしたままの取り残し」が無いかを見る。読むだけで、何も止めない。
// 使い方: node scripts/verify/hai-to-diamond/check-leftovers.mjs        … 人が読む形で出す。残りがあれば終了の番号 1
//         node scripts/verify/hai-to-diamond/check-leftovers.mjs --json … 機械が読む形で出す（verify-all が前後で比べるのに使う）
// 見る物: 検収役（検問所が呼ぶ別の Claude）／確かめの台本と開発サーバー／確かめ用のブラウザ／開いたままの口／検問所の記録の最後。
// 自分自身と、自分を呼び出した親の列（verify-all や検収役）は取り残しに数えない。
// 頭にパソコンの起動時刻を出す。再起動の直後は何も残っていなくて当たり前なので、その時の「無し」を証拠にしないため
// （2026-09-21 に、再起動の3分後に見て「取り残しは無い」と報告する間違いがあった）。
// Windows 専用。ほかの環境では何も見ずに終わる。
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const JSON_OUT = process.argv.includes('--json');
const PORTS = [5199, 5198, 5191, 5173, 5174, 4173];

if (process.platform !== 'win32') {
  if (JSON_OUT) console.log(JSON.stringify({ skipped: true, leftovers: [] }));
  else console.log('Windows 専用の確かめなので見送った');
  process.exit(0);
}

const ps = (cmd) => execFileSync('powershell', ['-NoProfile', '-Command',
  '[Console]::OutputEncoding=[Text.Encoding]::UTF8; ' + cmd], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const arr = (s) => { const t = s.trim(); if (!t) return []; const j = JSON.parse(t); return Array.isArray(j) ? j : [j]; };

const procs = arr(ps('Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,ExecutablePath,CommandLine,WorkingSetSize,@{n=\'Start\';e={$_.CreationDate.ToString(\'MM/dd HH:mm\')}} | ConvertTo-Json -Compress'));
const listens = arr(ps(`Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalPort -in ${PORTS.join(',')} } | Select-Object LocalPort,OwningProcess | ConvertTo-Json -Compress`));
const sys = arr(ps('$o=Get-CimInstance Win32_OperatingSystem; [pscustomobject]@{Boot=$o.LastBootUpTime.ToString(\'MM/dd HH:mm\');Now=(Get-Date -Format \'MM/dd HH:mm\');BootMin=[int]((Get-Date)-$o.LastBootUpTime).TotalMinutes;FreeGB=[math]::Round($o.FreePhysicalMemory/1MB,1)} | ConvertTo-Json -Compress'))[0];

// 自分と、自分の親の列、自分が呼んだ子は数えない
const byPid = new Map(procs.map((p) => [p.ProcessId, p]));
const mine = new Set();
for (let pid = process.pid, n = 0; pid && byPid.has(pid) && n < 40; pid = byPid.get(pid).ParentProcessId, n++) mine.add(pid);
let grew = true;
while (grew) { grew = false; for (const p of procs) if (p.ParentProcessId === process.pid && !mine.has(p.ProcessId)) { mine.add(p.ProcessId); grew = true; } }

const kindOf = (p) => {
  const c = p.CommandLine || '';
  if (/dod-inspector/.test(c)) return '検収役';
  if (/ms-playwright/i.test(p.ExecutablePath || '')) return '確かめ用のブラウザ';
  if (/^node(\.exe)?$/i.test(p.Name) && /scripts[\\/](verify|hai-to-diamond)[\\/]|\.tmp\.mjs|[\\/]vite[\\/]bin|verify-all/.test(c)) return '確かめの台本か開発サーバー';
  return null;
};
const leftovers = [];
for (const p of procs) {
  if (mine.has(p.ProcessId)) continue;
  const kind = kindOf(p);
  if (!kind) continue;
  leftovers.push({ kind, pid: p.ProcessId, start: p.Start, mb: Math.round((p.WorkingSetSize || 0) / 1048576), what: (p.CommandLine || p.Name).replace(/\s+/g, ' ').slice(0, 110) });
}
for (const l of listens) {
  if (mine.has(l.OwningProcess)) continue;
  leftovers.push({ kind: '開いたままの口', pid: l.OwningProcess, start: byPid.get(l.OwningProcess)?.Start ?? '?', mb: 0, what: `${l.LocalPort}番` });
}

// 検問所の記録の最後。検収役が走り終えると「recursion guard」の行が出る
let gate = '記録が無い';
const logPath = path.join(os.homedir(), '.claude', 'hooks', 'dod-gatekeeper.log');
if (existsSync(logPath)) {
  const lines = readFileSync(logPath, 'utf8').trim().split(/\r?\n/);
  const last = (re) => { for (let i = lines.length - 1; i >= 0; i--) if (re.test(lines[i])) return lines[i]; return null; };
  const decl = last(/hasDeclaration=true/);
  const done = last(/recursion guard|verdict (PASS|FAIL)/);
  const stamp = (l) => (l ? l.slice(1, 20).replace('T', ' ') + 'Z' : '無し');
  gate = `最後の完了宣言 ${stamp(decl)} ／ 検収役が終わった最後の印 ${stamp(done)}`;
  if (decl && (!done || done < decl)) gate += ' ／ 注意: 最後の完了宣言より後に、検収役が終わった印が無い';
}

if (JSON_OUT) {
  console.log(JSON.stringify({ sys, leftovers, gate }));
  process.exit(0);
}

console.log(`パソコンの起動 ${sys.Boot} ／ 今 ${sys.Now} ／ 空き ${sys.FreeGB}GB`);
if (sys.BootMin < 30) console.log(`注意: 起動から ${sys.BootMin} 分しか経っていない。再起動で消えただけかもしれないので、今の「無し」は証拠にならない`);
// 取り残しとは別に、長く開いたままのアプリが溜めている重さも出す。
// 2026-09-21 に端末が固まった時、起動から2日たった端末で Chrome が約6.7GB・Claude が約3.4GB を持っていた
// （再起動の直後は同じ使い方で約2.1GB・約0.4GB）。確かめや検収はその上に乗る
const heavy = ['chrome.exe', 'claude.exe', 'node.exe', 'Antigravity IDE.exe'].map((n) => {
  const g = procs.filter((p) => p.Name === n);
  return `${n.replace('.exe', '')} ${g.length}個 ${(g.reduce((a, b) => a + (b.WorkingSetSize || 0), 0) / 1073741824).toFixed(1)}GB`;
});
console.log(`開いたままのアプリの重さ: ${heavy.join(' ／ ')} ／ 起動から ${Math.floor(sys.BootMin / 60)}時間${sys.BootMin % 60}分`);
if (sys.FreeGB < 4) console.log(`注意: 空きが ${sys.FreeGB}GB しかない。ブラウザを立てる確かめや検収は、空きを作ってからにする`);
const kinds = ['検収役', '確かめの台本か開発サーバー', '確かめ用のブラウザ', '開いたままの口'];
for (const k of kinds) {
  const xs = leftovers.filter((l) => l.kind === k);
  if (!xs.length) { console.log(`${k}: 無し`); continue; }
  const mb = xs.reduce((a, b) => a + b.mb, 0);
  console.log(`${k}: ${xs.length}個${mb ? ` 合計${mb}MB` : ''}`);
  for (const x of xs.slice(0, 6)) console.log(`   ${x.start}から pid${x.pid} ${x.what}`);
  if (xs.length > 6) console.log(`   ほか ${xs.length - 6}個`);
}
console.log(`検問所の記録: ${gate}`);
console.log(leftovers.length ? `\n取り残し ${leftovers.length}個。止めるかどうかは人が決める（この台本は何も止めない）` : '\n取り残しは無い');
process.exit(leftovers.length ? 1 : 0);
