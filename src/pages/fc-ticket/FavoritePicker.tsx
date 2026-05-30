import { useMemo, useState } from "react";
import { ALL_MEMBERS } from "@/data/members";
import { OG_MEMBERS, OG_GROUP_LABEL } from "@/data/ogMembers";
import { isLight } from "@/lib/colorUtils";
import type { Member } from "@/types/profile";

export interface Favorites {
  members: string[];
  groups: string[];
}

type PickMember = Member & { formerGroup?: string; hasEvents?: boolean };

// 推しグループの選択肢: 現役7グループ ＋ OG枠
const GROUP_OPTIONS: string[] = [
  "モーニング娘。'26",
  "アンジュルム",
  "Juice=Juice",
  "つばきファクトリー",
  "BEYOOOOONDS",
  "OCHA NORMA",
  "ロージークロニクル",
  OG_GROUP_LABEL,
];

// 現役（ALL_MEMBERS）→ OG（hasEvents 順は ogMembers.ts 側で整列済み）
const PICK_MEMBERS: PickMember[] = [...ALL_MEMBERS, ...OG_MEMBERS];

const chipBase =
  "px-2 py-0.5 text-[0.6875rem] font-bold tracking-wide cursor-pointer transition-colors border";

export default function FavoritePicker({
  favorites,
  onChange,
}: {
  favorites: Favorites;
  onChange: (next: Favorites) => void;
}) {
  const [search, setSearch] = useState("");
  const [showList, setShowList] = useState(false);

  const memberSet = useMemo(() => new Set(favorites.members), [favorites.members]);
  const groupSet = useMemo(() => new Set(favorites.groups), [favorites.groups]);

  const filtered = useMemo(() => {
    if (!search) return [];
    return PICK_MEMBERS.filter(
      (m) =>
        !memberSet.has(m.name) &&
        (m.name.includes(search) ||
          m.group.includes(search) ||
          (m.formerGroup?.includes(search) ?? false) ||
          (m.nicks?.some((n) => n.includes(search)) ?? false)),
    ).slice(0, 12);
  }, [search, memberSet]);

  function toggleGroup(g: string) {
    const next = new Set(groupSet);
    if (next.has(g)) next.delete(g);
    else next.add(g);
    onChange({ ...favorites, groups: [...next] });
  }

  function addMember(name: string) {
    if (memberSet.has(name)) return;
    onChange({ ...favorites, members: [...favorites.members, name] });
    setSearch("");
    setShowList(false);
  }

  function removeMember(name: string) {
    onChange({ ...favorites, members: favorites.members.filter((n) => n !== name) });
  }

  const rightLabel = (m: PickMember) =>
    m.group === OG_GROUP_LABEL ? `OG・${m.formerGroup ?? ""}` : m.group;

  return (
    <section className="mb-8">
      <div className="flex items-baseline justify-between border-b border-outline-variant/30 pb-2 mb-4">
        <h3 className="text-[0.6875rem] font-bold uppercase tracking-widest">メンバー・グループの登録</h3>
        <span className="text-[0.6875rem] text-outline">
          {favorites.members.length + favorites.groups.length}件
        </span>
      </div>

      <p className="text-sm text-on-surface-variant mb-4">
        メンバー・グループを登録すると、出演予定にあらかじめチェックが付きます。参加されない公演はチェックを外してください（チェックの付いた予定のみ配信されます）。一覧にない公演は、カレンダー画面の「気になる」に追加すると、ここに表示されます。
      </p>

      {/* グループチップ */}
      <div className="flex gap-1 flex-wrap mb-4">
        {GROUP_OPTIONS.map((g) => (
          <button
            key={g}
            onClick={() => toggleGroup(g)}
            className={`${chipBase} ${
              groupSet.has(g)
                ? "bg-primary text-on-primary-fixed border-primary"
                : "bg-transparent text-outline border-outline-variant hover:border-primary hover:text-primary"
            }`}
          >
            {g}
          </button>
        ))}
      </div>

      {/* メンバー検索 */}
      <div className="relative">
        <input
          className="w-full px-3 py-2 text-sm bg-transparent border border-outline-variant outline-none focus:border-primary"
          placeholder="メンバー名で検索（OG・卒業メンバーを含む）"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setShowList(true);
          }}
          onFocus={() => setShowList(true)}
        />
        {showList && search.length > 0 && filtered.length > 0 && (
          <div className="absolute top-full left-0 right-0 z-50 mt-px max-h-52 overflow-y-auto bg-surface border border-outline-variant">
            {filtered.map((m) => (
              <button
                key={m.name}
                onClick={() => addMember(m.name)}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left border-b border-outline-variant/30 last:border-b-0 hover:bg-surface-variant/40 cursor-pointer"
              >
                <span
                  className="w-3.5 h-3.5 flex-shrink-0"
                  style={{
                    background: m.color,
                    border: isLight(m.color) ? "1.5px solid #ccc" : "none",
                  }}
                />
                <span className="font-bold">{m.name}</span>
                {m.hasEvents && (
                  <span className="text-[0.625rem] font-bold text-primary">●</span>
                )}
                <span className="text-[0.6875rem] text-outline ml-auto">{rightLabel(m)}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 登録済みメンバー */}
      {favorites.members.length > 0 && (
        <div className="flex gap-1 flex-wrap mt-3">
          {favorites.members.map((name) => (
            <button
              key={name}
              onClick={() => removeMember(name)}
              className={`${chipBase} bg-primary text-on-primary-fixed border-primary`}
              title="タップで解除"
            >
              {name} ×
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
