export const VIDEO_ID = "mn1wkO0Ysbw";

export type HiTensionMember = {
  id: string;
  color: string;
};

export type UnitRow = {
  unit: "CHICA#TETSU" | "雨ノ森 川海" | "SeasoningS";
  members: HiTensionMember[];
};

export const UNIT_ROWS: readonly UnitRow[] = [
  {
    unit: "CHICA#TETSU",
    members: [
      { id: "nishida",   color: "#da1884" },
      { id: "eguchi",    color: "#fdda24" },
    ],
  },
  {
    unit: "雨ノ森 川海",
    members: [
      { id: "takase",    color: "#00c7b1" },
      { id: "maeda",     color: "#59cbe8" },
      { id: "okamura",   color: "#F57EB6" },
      { id: "kiyono",    color: "#fc4c02" },
    ],
  },
  {
    unit: "SeasoningS",
    members: [
      { id: "hirai",     color: "#582c83" },
      { id: "kobayashi", color: "#007749" },
      { id: "satoyoshi", color: "#005eb8" },
    ],
  },
] as const;

export const ALL_HI_MEMBERS: HiTensionMember[] = UNIT_ROWS.flatMap(r => r.members);

export function findMember(id: string | null): HiTensionMember | null {
  if (!id) return null;
  return ALL_HI_MEMBERS.find(m => m.id === id) ?? null;
}
