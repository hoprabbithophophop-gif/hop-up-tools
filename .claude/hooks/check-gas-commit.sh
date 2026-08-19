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
  else
    echo '{}'
  fi
else
  echo '{}'
fi
