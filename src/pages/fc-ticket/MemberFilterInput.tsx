import { useMemo, useState } from "react";
import { ALL_MEMBERS } from "@/data/members";
import { OG_MEMBERS, OG_GROUP_LABEL } from "@/data/ogMembers";
import { isLight } from "@/lib/colorUtils";

// 現役 ＋ OG・卒業メンバー
const POOL = [...ALL_MEMBERS, ...OG_MEMBERS];

// ガント用のメンバー絞り込み（単一選択）。選択中は外せるチップ表示。
export default function MemberFilterInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (name: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);

  const filtered = useMemo(() => {
    if (!search) return [];
    return POOL.filter(
      (m) =>
        m.name.includes(search) ||
        m.group.includes(search) ||
        ((m as { formerGroup?: string }).formerGroup?.includes(search) ?? false) ||
        (m.nicks?.some((n) => n.includes(search)) ?? false),
    ).slice(0, 10);
  }, [search]);

  if (value) {
    return (
      <button
        onClick={() => onChange("")}
        className="px-2 py-0.5 text-[0.625rem] font-bold tracking-wide border bg-primary text-on-primary-fixed border-primary cursor-pointer"
        title="メンバー絞り込みを解除"
      >
        {value} ×
      </button>
    );
  }

  return (
    <div className="relative">
      <input
        className="w-32 px-2 py-0.5 text-[0.625rem] bg-transparent border border-outline-variant outline-none focus:border-primary"
        placeholder="メンバーで絞る"
        value={search}
        onChange={(e) => {
          setSearch(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
      />
      {open && search.length > 0 && filtered.length > 0 && (
        <div className="absolute top-full left-0 z-50 mt-px w-56 max-h-52 overflow-y-auto bg-surface border border-outline-variant">
          {filtered.map((m) => (
            <button
              key={m.name}
              onClick={() => {
                onChange(m.name);
                setSearch("");
                setOpen(false);
              }}
              className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-left border-b border-outline-variant/30 last:border-b-0 hover:bg-surface-variant/40 cursor-pointer"
            >
              <span
                className="w-3 h-3 flex-shrink-0"
                style={{ background: m.color, border: isLight(m.color) ? "1.5px solid #ccc" : "none" }}
              />
              <span className="font-bold">{m.name}</span>
              <span className="text-[0.625rem] text-outline ml-auto">
                {m.group === OG_GROUP_LABEL ? "OG" : m.group}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
