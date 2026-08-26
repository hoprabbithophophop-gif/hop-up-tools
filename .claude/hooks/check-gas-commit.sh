#!/usr/bin/env bash
# 生の `clasp push` を拒否し、安全チェック付きラッパー(npm run gas:push)へ誘導する。
#
# 2026-08-19: debugTestMarkFlow をgit commitせずclasp pushだけでGASに直接置き、
# 確認後に無断で完全削除して記録が消えた事故を受けて追加（feedback_delete_functions_via_git.md）。
# 2026-08-26: 「欠けているファイルがあれば止める」だけの版を作ったが、それだと
#   - mainにもある古い版の中身でpush → ファイル数は揃っているので通ってしまう
#   - 生の clasp push を直接叩けば正規表現をすり抜けられる余地が残る
# という指摘を受け、実チェック（未コミット差分・本番との内容突き合わせ・危険方向の
# 判定）は scripts/gas-push.mjs に集約し、このフックは「生の clasp push を無条件で
# 拒否してラッパーに誘導する」役割だけに絞った（二重実装を避けるため）。
# jqがこの環境に無いため、JSON解析・コマンド判定はnodeで行う。
#
# 判定は「コマンド文字列に clasp push という文字列が含まれるか」ではなく、
# &&/;/|/改行で区切った各セグメントの先頭が実際に clasp push の実行であるかを見る。
# 単純な部分一致だと、コミットメッセージの説明文（例:「clasp pushの前にcommitする」）
# の中の地の文にまで反応して誤爆する（2026-08-19に実際に発生・修正）。
# 残る抜け道（環境変数を挟む、bash -c 経由等）はこの正規表現では防げない既知の限界。
# 主たる安全網は scripts/gas-push.mjs 側なので、ここで過度に複雑化はしない。
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
  node -e "
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: '生の clasp push は禁止です。npm run gas:push --check でまず差分を確認し、問題なければ npm run gas:push -- --confirm（必要なら --force-delete も）を使ってください。未コミット差分チェック・本番との内容突き合わせ・危険方向の判定はすべてそちらで行われます。',
      },
    }));
  "
else
  echo '{}'
fi
