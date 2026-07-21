// 公演（イベント）単位グルーピング — フロント側MVP（案A）
//
// 実体は ./icsCore に移した（サーバー側の購読ICS組み立てでも同じ判定が必要なため）。
// このファイルは既存の import パスを壊さないための再エクスポートだけを行う。
export { eventGroupKey, eventTwinKey, dedupeEventTwins } from "./icsCore";
