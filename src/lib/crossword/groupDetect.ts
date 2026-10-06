// 作る画面の「メンバー名・グループ名での自動判定」。保存の受付係と同じ判定（functions/_shared/crosswordGroups.ts）を、
// こちらは src/data の名簿で動かす。受付係は名簿の写し（functions/_shared/crosswordMembers.ts）を使うので、名簿を直すときは両方を直す。
import { detectGroups as detect, type GroupDetectInput } from "../../../functions/_shared/crosswordGroups";
import { ALL_MEMBERS } from "../../data/members";
import { HELLO_GROUPS } from "../../data/groups";

const ROSTER = {
  members: ALL_MEMBERS.map((m) => ({ name: m.name, group: m.group })),
  groups: HELLO_GROUPS.map((g) => g.name),
};

export const detectGroups = (input: GroupDetectInput): string[] => detect(input, ROSTER);

// 一覧の「グループ」で絞る選択肢
export const GROUP_NAMES: string[] = ROSTER.groups;

// タグにそのグループ名が入っているか。表記ゆれの範囲は自動判定と同じ（NFKC でそろえる・「モーニング娘。'26」は年の前まで合えば拾う）。
// グループの印（group_tags）が無い問題も、一覧のグループで絞る時に拾うため（2026-10-06 決定）
export const tagsHaveGroup = (tags: readonly string[], group: string): boolean =>
  tags.length > 0 && detect({ title: "", clues: tags, answers: [] }, { members: [], groups: [group] }).length > 0;
