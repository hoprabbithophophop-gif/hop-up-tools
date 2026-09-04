#!/usr/bin/env node
/**
 * GAS(gas/)を本番Apps Scriptへ反映する入口（呼び出し用の薄い取次ぎ）。
 *
 * 中身の本体は、このリポジトリの中ではなく ~/.claude/scripts/gas-push.mjs にある。
 *
 * なぜ外に置いたか:
 *   このファイルがリポジトリの中にあると、ブランチごとに中身が分かれる。そのため
 *   安全確認を足しても、それを持たない枝で作業している間はまったく効かない。
 *   2026-09-04 に実際の状態を数えたところ、作業フォルダ13個・ブランチ28個のうち、
 *   この仕組みを持っていたのは1つだけだった。ユーザー設定側（どの枝にも属さない場所）に
 *   置けば、どの枝・どの作業フォルダで作業していても同じ確認が走る。
 *   本体を移す前の最後の版は commit 2fa5073。中身の変遷はそこまでのgit履歴に残っている。
 *
 * 使い方（今までどおり）:
 *   npm run gas:push -- --check                     差分の確認だけ（送信しない）
 *   npm run gas:push -- --confirm                   内容差分があっても続行する
 *   npm run gas:push -- --confirm --force-delete    本番にしか無いファイルの削除も許可
 *
 * gas:push が用意されていない枝では、本体を直に呼ぶ:
 *   node ~/.claude/scripts/gas-push.mjs --check
 *
 * 生の `clasp push` は ~/.claude/hooks/check-gas-push.sh が拒否する。
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';

const target = path.join(homedir(), '.claude', 'scripts', 'gas-push.mjs');

if (!fs.existsSync(target)) {
  console.error('反映の本体が見つかりません: ' + target);
  console.error('このパソコンの ~/.claude/scripts/ に gas-push.mjs を置いてください。');
  console.error('（本体を移す前の版は、このリポジトリの commit 2fa5073 の scripts/gas-push.mjs にあります）');
  process.exit(1);
}

const res = spawnSync(process.execPath, [target, ...process.argv.slice(2)], { stdio: 'inherit' });
process.exit(res.status === null ? 1 : res.status);
