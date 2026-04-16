import React, { useState } from 'react';

export interface FilterState {
  group: string;
  member: string;
  type: string;
  channel: string;
  year: number;
  sort: 'desc' | 'asc';
}

interface Props {
  state: FilterState;
  onChange: (next: Partial<FilterState>) => void;
  membersByGroup: Record<string, string[]>;
}

const GROUP_FILTERS = [
  'モーニング娘。',
  'アンジュルム',
  'Juice=Juice',
  'つばきファクトリー',
  'BEYOOOOONDS',
  'OCHA NORMA',
  'ロージークロニクル',
  'ハロプロ研修生',
];

const TYPE_FILTERS = [
  { key: 'mv',      label: 'MV' },
  { key: 'live',    label: 'LIVE' },
  { key: 'variety', label: 'VARIETY' },
  { key: 'other',   label: 'OTHER' },
];

const CHANNEL_FILTERS = [
  'ハロ！ステ',
  'アップフロントチャンネル',
  'モーニング娘。',
  'アンジュルム',
  'Juice=Juice',
  'つばきファクトリー',
  'BEYOOOOONDS',
  'OCHA NORMA',
  'ロージークロニクル',
  'ハロプロ研修生',
  'OMAKE CHANNEL',
  'UFfanclub',
  'UF Goods Land',
  'M-line Music',
  'アプカミ',
  'THE FIRST TAKE',
  'ヤンマガch',
  'ハロプロちょっと面白い話',
];

const CURRENT_YEAR = new Date().getFullYear();
const YEAR_FILTERS: number[] = Array.from(
  { length: CURRENT_YEAR - 2011 },
  (_, i) => CURRENT_YEAR - i
);

type TabKey = 'group' | 'type' | 'channel' | 'year' | 'sort';

function Chip({
  label,
  active,
  onClick,
  mono,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  mono?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`text-[0.6875rem] font-bold transition-colors cursor-pointer pb-0.5 shrink-0 ${
        mono ? 'tabular-nums' : ''
      } ${active ? 'text-primary border-b-2 border-primary' : 'text-outline hover:text-on-surface'}`}
    >
      {label}
    </button>
  );
}

export function FilterPanel({ state, onChange, membersByGroup }: Props) {
  const [activeTab, setActiveTab] = useState<TabKey | null>(null);
  const toggleTab = (key: TabKey) => setActiveTab(prev => (prev === key ? null : key));

  const memberList = state.group
    ? (membersByGroup[state.group] ?? [])
    : [];

  // アクティブフィルター数（ALL判定用）
  const hasFilter =
    state.group || state.member || state.type || state.channel || state.year > 0;

  const tabs: { key: TabKey; label: string; badge?: string }[] = [
    {
      key: 'group',
      label: 'GROUP',
      badge: state.member || state.group || undefined,
    },
    {
      key: 'type',
      label: 'TYPE',
      badge: state.type ? state.type.toUpperCase() : undefined,
    },
    {
      key: 'channel',
      label: 'CH',
      badge: state.channel ? '●' : undefined,
    },
    {
      key: 'year',
      label: 'YEAR',
      badge: state.year > 0 ? String(state.year) : undefined,
    },
    {
      key: 'sort',
      label: 'SORT',
      badge: state.sort === 'desc' ? '↓' : '↑',
    },
  ];

  const panelContent: Record<TabKey, React.ReactNode> = {
    group: (
      <>
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {GROUP_FILTERS.map(g => (
            <Chip
              key={g}
              label={g}
              active={state.group === g}
              onClick={() => {
                const next = state.group === g ? '' : g;
                onChange({
                  group: next,
                  member: next && state.member
                    ? (membersByGroup[next] ?? []).includes(state.member) ? state.member : ''
                    : state.member,
                });
              }}
            />
          ))}
        </div>
        {memberList.length > 0 && (
          <div className="flex flex-wrap gap-x-4 gap-y-2 pt-2 mt-2 border-t border-outline-variant/20">
            {memberList.map(name => (
              <Chip
                key={name}
                label={name}
                active={state.member === name}
                onClick={() => onChange({ member: state.member === name ? '' : name })}
              />
            ))}
          </div>
        )}
      </>
    ),
    type: (
      <div className="flex flex-wrap gap-x-4 gap-y-2">
        {TYPE_FILTERS.map(t => (
          <Chip
            key={t.key}
            label={t.label}
            active={state.type === t.key}
            onClick={() => onChange({ type: state.type === t.key ? '' : t.key })}
          />
        ))}
      </div>
    ),
    channel: (
      <div className="flex flex-wrap gap-x-4 gap-y-2">
        {CHANNEL_FILTERS.map(c => (
          <Chip
            key={c}
            label={c}
            active={state.channel === c}
            onClick={() => onChange({ channel: state.channel === c ? '' : c })}
          />
        ))}
      </div>
    ),
    year: (
      <div className="flex flex-wrap gap-x-4 gap-y-2">
        {YEAR_FILTERS.map(y => (
          <Chip
            key={y}
            label={String(y)}
            active={state.year === y}
            onClick={() => onChange({ year: state.year === y ? 0 : y })}
            mono
          />
        ))}
      </div>
    ),
    sort: (
      <div className="flex gap-4">
        <Chip
          label="NEW"
          active={state.sort === 'desc'}
          onClick={() => onChange({ sort: 'desc' })}
        />
        <Chip
          label="OLD"
          active={state.sort === 'asc'}
          onClick={() => onChange({ sort: 'asc' })}
        />
      </div>
    ),
  };

  return (
    <div>
      {/* タブ行 */}
      <div className="flex items-center gap-1 flex-wrap border-b border-outline-variant/20">
        {/* ALL リセット */}
        <button
          onClick={() =>
            onChange({ group: '', member: '', type: '', channel: '', year: 0 })
          }
          className={`text-[0.6875rem] font-bold uppercase tracking-widest shrink-0 py-2 px-2 cursor-pointer transition-colors ${
            !hasFilter
              ? 'text-on-surface border-b-2 border-primary'
              : 'text-outline hover:text-on-surface'
          }`}
        >
          ALL
        </button>

        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => toggleTab(t.key)}
            className={`flex items-center gap-1.5 shrink-0 py-2 px-2 cursor-pointer transition-colors group ${
              activeTab === t.key
                ? 'text-on-surface border-b-2 border-primary'
                : 'text-outline hover:text-on-surface'
            }`}
          >
            <span className="text-[0.6875rem] font-bold uppercase tracking-widest">
              {t.label}
            </span>
            {t.badge && (
              <span className="text-[0.6rem] font-bold text-primary bg-primary/10 px-1 leading-4">
                {t.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ドロップダウンパネル */}
      {activeTab && (
        <div className="py-3 px-2 border-b border-outline-variant/20 bg-surface-container-low">
          {panelContent[activeTab]}
        </div>
      )}
    </div>
  );
}
