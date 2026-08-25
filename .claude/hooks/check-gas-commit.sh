#!/usr/bin/env bash
# clasp push の前に gas/ 配下の未コミット差分をブロックする安全網。
# 2026-08-19: debugTestMarkFlow をgit commitせずclasp pushだけでGASに直接置き、
# 確認後に無断で完全削除して記録が消えた事故を受けて追加（feedback_delete_functions_via_git.md）。
# GAS作業はgitを経由せずclasp pushで直接本番に反映できてしまうため、ここで一段止める。
# jqがこの環境に無いため、JSON解析・コマンド判定はnodeで行う。
#
# 判定は「コマンド文字列に clasp push という文字列が含まれるか」ではなく、
# &&/;/|/改行で区切った各セグメントの先頭が実際に clasp push の実行であるかを見る。
# 単純な部分一致だと、コミットメッセージの説明文（例:「clasp pushの前にcommitする」）
# の中の地の文にまで反応して誤爆する（2026-08-19に実際に発生・修正）。
input=$(cat)
is_push=$(printf '%s' "$input" | node -e "
  let s = '';
  process.stdin.on('data', d => s += d);
  process.stdin.on('end', () => {
    let cmd = '';
    try { cmd = JSON.parse(s).tool_input?.command || ''; } catch (e) {}
    const segments = cmd.split(/&&|\|\||\n|;|\|/).map(x => x.trim());
    const hit = segments.some(seg => /^(npx\s+|npm\s+exec\s+)?clasp\s+push(\s|--force|\$)/.test(seg));
    process.stdout.write(hit ? '1' : '');
  });
")

if [ -n "$is_push" ]; then
  repo_root=$(git rev-parse --show-toplevel 2>/dev/null)
  if [ -z "$repo_root" ]; then
    echo '{}'
    exit 0
  fi
  dirty=$(git -C "$repo_root" status --porcelain -- gas/ 2>/dev/null)
  if [ -n "$dirty" ]; then
    reason="gas/配下に未コミットの変更があります。clasp pushの前にgit commitしてください（消す/直す前提でも、まず今の状態を1コミットとして残す）。差分:
$dirty"
    REASON="$reason" node -e "
      process.stdout.write(JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: process.env.REASON,
        },
      }));
    "
    exit 0
  fi

  # gas/配下はgit的にはクリーン。次に、本番に既にあるファイルがこのワークツリーの
  # gas/から欠けていないか確認する。clasp push は差分ではなく「今のgas/フォルダで
  # 本番を丸ごと入れ替える」動作なので、古いブランチ（mainから分岐した各worktree等）
  # から誤ってpushすると、本番からファイルが消える。
  # 2026-08-26に発覚：mainや複数のfeatureブランチのgas/にはvenue-watch.js等の
  # 重要ファイルが存在しないことが判明（作業がずっとこのブランチで進み、mainに合流
  # していなかった）。本番の実体と都度突き合わせて防ぐ。
  tmpdir=$(mktemp -d 2>/dev/null)
  if [ -n "$tmpdir" ] && [ -f "$repo_root/gas/.clasp.json" ]; then
    cp "$repo_root/gas/.clasp.json" "$tmpdir/.clasp.json" 2>/dev/null
    cp "$repo_root/gas/.claspignore" "$tmpdir/.claspignore" 2>/dev/null
    (cd "$tmpdir" && clasp pull >/dev/null 2>&1)
    pull_ok=$?
    if [ $pull_ok -eq 0 ]; then
      missing=$(node -e "
        const fs = require('fs');
        const path = require('path');
        const prodDir = process.argv[1];
        const localDir = process.argv[2];
        const prodFiles = fs.readdirSync(prodDir).filter((f) => !f.startsWith('.'));
        const missing = prodFiles.filter((f) => !fs.existsSync(path.join(localDir, f)));
        process.stdout.write(missing.join(', '));
      " "$tmpdir" "$repo_root/gas")
      if [ -n "$missing" ]; then
        reason="本番のGASには存在するのに、このワークツリーの gas/ に無いファイルがあります: $missing
このまま clasp push すると、clasp push は差分ではなく全ファイル入れ替えなので、本番からこれらのファイルが削除されます。
このブランチ（worktree）は古い状態から分岐している可能性が高いです。最新のGASコードがあるブランチから作業し直すか、
先にそれらのファイルをこのブランチに持ってきてください。"
        REASON="$reason" node -e "
          process.stdout.write(JSON.stringify({
            hookSpecificOutput: {
              hookEventName: 'PreToolUse',
              permissionDecision: 'deny',
              permissionDecisionReason: process.env.REASON,
            },
          }));
        "
        rm -rf "$tmpdir" 2>/dev/null
        exit 0
      fi
    fi
    # pullが失敗した場合（ネットワーク不調等）は、事故防止より作業継続を優先し
    # ブロックしない（フェイルオープン）。gitのクリーンチェックは既に通っている。
    rm -rf "$tmpdir" 2>/dev/null
  fi
  echo '{}'
else
  echo '{}'
fi
