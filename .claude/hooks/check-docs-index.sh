#!/bin/bash
# docsの案内板(docs/README.md)の鮮度チェック（Stop hook・非ブロック）
#
# 何をするか:
#   作業が終わったタイミングで docs/ を見て、案内板より後に更新された .md があれば
#   「案内板が古くなっている」と画面に一言出すだけ。作業は止めない。
#
# なぜ必要か:
#   案内板の更新は「気づいて直す」運用に頼っていて、忘れると案内板だけ古くなる。
#   その見落としを人の記憶ではなく仕組み側で拾うための見張り。
#
# 直し方: このメッセージが出たら「案内板を直して」と言えば、Claudeが更新する。
# 止め方: .claude/settings.json の Stop フックからこの行を消す（/hooks でも確認できる）。

set -uo pipefail

ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
INDEX="$ROOT/docs/README.md"

# 案内板そのものが無ければ何もしない（このプロジェクト以外で誤爆させない）
[ -f "$INDEX" ] || exit 0

# 案内板より新しい .md を探す（案内板自身は除く）
STALE=$(find "$ROOT/docs" -name '*.md' -newer "$INDEX" -not -path "$INDEX" 2>/dev/null \
  | sed "s|^$ROOT/||" \
  | head -10)

[ -z "$STALE" ] && exit 0

COUNT=$(printf '%s\n' "$STALE" | grep -c .)
LIST=$(printf '%s\n' "$STALE" | sed 's/^/・/' | tr '\n' ' ')

# JSONの文字列として安全になるよう最低限のエスケープ
LIST=${LIST//\\/\\\\}
LIST=${LIST//\"/\\\"}

printf '{"systemMessage":"docs/README.md（案内板）より新しい文書が %s 件あります: %s\\n案内板が古いままかもしれません。直す場合は「案内板を直して」と伝えてください。"}\n' \
  "$COUNT" "$LIST"

exit 0
