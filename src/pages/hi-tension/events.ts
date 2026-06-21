// スペシャル回（お祝い等）の定義と判定。
//
// 設計方針：スペシャル回の「定義」（色・名前・期間・対象メンバー）はこのフロント静的configが
// 単一の真実源。DBに刻むのは which-event を表す文字列 special_event_key だけ（無料枠でDB読みを
// 増やさないため）。回が頻繁に増えるようになったらDBテーブル化を検討する。
//
// kind: "birthday"=個人企画(各メンバー1回・公平)／"group"=グループ企画(横アリ等・個人を贔屓しない)。

const SHARE_URL = "https://hop-up-tools.pages.dev/hi-tension";

export type SpecialEventKind = "birthday" | "group";

export type SpecialEvent = {
  /** DBの hi_sessions.special_event_key に保存される一意キー。 */
  key: string;
  /** 入口の副題などに出すフル表記。 */
  title: string;
  /** 💗チップ・回リストに出す短い表記。 */
  shortTitle: string;
  /** 設定シート下の「ハート列」に出す、メンカラ寄せの絵文字（💗/💚/🩵）。 */
  heart: string;
  /** この回のテーマカラー（✋/数字/ボタン/EndCardの着色）。 */
  color: string;
  /** 対象メンバーID（data.ts の id）。 */
  targetMemberId: string;
  kind: SpecialEventKind;
  /** 開催期間（JSTオフセット付きISO）。start<=now<end で自動ON（その日の主役表示）。 */
  start: string;
  end: string;
  /** 💗リンクから参加できる最終期限（JSTオフセット付きISO・排他）。省略=ずっと参加可。 */
  joinableUntil?: string;
  /** EndCard上部の祝い文（空なら出さない）。 */
  endCardCongrats: string;
  /** Xシェアの本文（タグ・URL込み。文面はhop指定、勝手に足さない）。 */
  shareText: (count: number) => string;
  /** その回専用の動画（省略=通常の練習動画）。新メンが映る等で差し替える時に指定。 */
  videoId?: string;
  /** 専用動画のトリム開始秒（省略=0）。 */
  videoStart?: number;
  /** 専用動画のトリム終了秒（到達でその回を終了＝EndCard）。 */
  videoEnd?: number;
  /** スペシャル回の入口ボタン文言（省略=既定）。回ごとに変える時に指定。 */
  enterLabel?: string;
  /** 回の終了後、EndCard上のプレイヤーで流す動画（加入発表の歓迎シーン等）。表示専用・記録しない。 */
  endingVideoId?: string;
  endingVideoStart?: number;
  endingVideoEnd?: number;
};

export const SPECIAL_EVENTS: readonly SpecialEvent[] = [
  {
    key: "nishida_bd_2026",
    title: "西田汐里さんバースデースペシャル",
    shortTitle: "西田汐里さん💗",
    heart: "💗",
    color: "#da1884",
    targetMemberId: "nishida",
    kind: "birthday",
    start: "2026-06-07T00:00:00+09:00",
    end: "2026-06-08T00:00:00+09:00",
    // バースデーメッセージカードの締切（翌月15日）に合わせ、7/15いっぱいまで参加可。
    joinableUntil: "2026-07-16T00:00:00+09:00",
    endCardCongrats: "西田汐里さん お誕生日おめでとう🎂💗",
    shareText: (count: number) =>
      `西田汐里さん お誕生日おめでとう🎂💗\nハイ！テンション✋ practice ver. で ${count}回 手を挙げてお祝いしました🖐️\n#ハイテンションPractice\n${SHARE_URL}`,
  },
  {
    key: "otsubo_bd_2026",
    title: "大坪茉乃さんバースデースペシャル",
    shortTitle: "大坪茉乃さん💚",
    heart: "💚",
    color: "#d0df00",
    targetMemberId: "otsubo",
    kind: "birthday",
    start: "2026-06-21T00:00:00+09:00",
    end: "2026-06-23T00:00:00+09:00",
    // バースデーメッセージカードの締切（翌月15日）に合わせ、7/15いっぱいまで参加可。
    joinableUntil: "2026-07-16T00:00:00+09:00",
    endCardCongrats: "大坪茉乃さん お誕生日おめでとう🎂💚",
    shareText: (count: number) =>
      `大坪茉乃さん お誕生日おめでとう🎂💚\nハイ！テンション✋ practice ver. で ${count}回 手を挙げてお祝いしました🖐️\n#ハイテンションPractice\n${SHARE_URL}`,
    // 大坪さんは新メンバーで本来のハイ！テンション動画に映らないため、本人が映るハロステ
    // （ハイ！テンション→新メンお披露目）にトリム差し替え。0:55.9〜5:03.1・ループなし・✋自由タップ。
    videoId: "Jp0gynDq-5w",
    videoStart: 55.9,
    videoEnd: 303.1,
    enterLabel: "ウェルカム（ウェルカム！）",
    // 終了後、加入発表の歓迎シーン（メンバーが「ようこそー！」）をEndCard上で1回だけ流す。
    endingVideoId: "atBnm5ZZZ8Y",
    endingVideoStart: 188,
    endingVideoEnd: 258,
  },
  {
    key: "maeda_bd_2026",
    title: "前田こころさんバースデースペシャル",
    shortTitle: "前田こころさん🩵",
    heart: "🩵",
    color: "#59cbe8",
    targetMemberId: "maeda",
    kind: "birthday",
    start: "2026-06-23T00:00:00+09:00",
    end: "2026-06-24T00:00:00+09:00",
    // バースデーメッセージカードの締切（翌月15日）に合わせ、7/15いっぱいまで参加可。
    joinableUntil: "2026-07-16T00:00:00+09:00",
    endCardCongrats: "前田こころさん お誕生日おめでとう🎂🩵",
    shareText: (count: number) =>
      `前田こころさん お誕生日おめでとう🎂🩵\nハイ！テンション✋ practice ver. で ${count}回 手を挙げてお祝いしました🖐️\n#ハイテンションPractice\n${SHARE_URL}`,
  },
];

export function getEvent(key: string | null | undefined): SpecialEvent | null {
  if (!key) return null;
  return SPECIAL_EVENTS.find((e) => e.key === key) ?? null;
}

/**
 * 設定シート下端の「ハート列」に出す回：誕生日が終わっていて（now>=end）まだ参加期限内（now<joinableUntil）の回。
 * 開催中のその日の主役は end>now なので含まれない＝主役は通常入口に出て、ここには「過ぎた回」だけ並ぶ。
 * 配列順（古い順）で返す → 並びは 💗→💚→🩵 になる。
 */
export function getPastJoinableEvents(now: Date = new Date()): SpecialEvent[] {
  const t = now.getTime();
  return SPECIAL_EVENTS.filter(
    (e) => t >= Date.parse(e.end) && (!e.joinableUntil || t < Date.parse(e.joinableUntil)),
  );
}

// ―― プレビュー（本番に無害・付けた本人のタブだけ効く）――
//   ?special=<key>  → そのスペシャル回を強制ON
//   ?special=off    → 強制OFF（開催中でも素の通常表示を確認）
//   旧 ?nishida / ?nishida=off は当面エイリアスとして残す（既存の共有リンク互換）。
const PREVIEW_KEY = "hi_special_preview"; // sessionStorage: スペシャル回キー
const PREVIEW_OFF = "hi_special_force_off"; // sessionStorage: "1" で強制OFF

type Preview = { key?: string; off?: boolean } | null;

function readPreview(): Preview {
  try {
    const params = new URLSearchParams(window.location.search);
    // 新パラメータ ?special=
    if (params.has("special")) {
      const v = params.get("special");
      if (v === "off" || v === "0" || v === "false") {
        sessionStorage.setItem(PREVIEW_OFF, "1");
        sessionStorage.removeItem(PREVIEW_KEY);
        return { off: true };
      }
      const key = v && getEvent(v) ? v : SPECIAL_EVENTS[0]?.key;
      if (key) {
        sessionStorage.removeItem(PREVIEW_OFF);
        sessionStorage.setItem(PREVIEW_KEY, key);
        return { key };
      }
    }
    // 旧エイリアス ?nishida（=nishida_bd_2026）
    if (params.has("nishida")) {
      const v = params.get("nishida");
      if (v === "off" || v === "0" || v === "false") {
        sessionStorage.setItem(PREVIEW_OFF, "1");
        sessionStorage.removeItem(PREVIEW_KEY);
        return { off: true };
      }
      sessionStorage.removeItem(PREVIEW_OFF);
      sessionStorage.setItem(PREVIEW_KEY, "nishida_bd_2026");
      return { key: "nishida_bd_2026" };
    }
    // URLに無ければ sessionStorage の記憶（遷移後も維持）
    if (sessionStorage.getItem(PREVIEW_OFF) === "1") return { off: true };
    const stored = sessionStorage.getItem(PREVIEW_KEY);
    if (stored && getEvent(stored)) return { key: stored };
  } catch {
    /* SSR/権限なし等は無視 */
  }
  return null;
}

/** プレビュー（?special / ?nishida）が効いているか。効いていれば保存済みの表示選択より優先する。 */
export function hasPreviewOverride(): boolean {
  return readPreview() !== null;
}

/**
 * 今アクティブな（=開催中 or プレビューで強制ONの）スペシャル回キーを返す。
 * 無ければ null（通常練習）。プレビュー > 開催期間 の優先順。
 */
export function getActiveSpecialEventKey(now: Date = new Date()): string | null {
  const preview = readPreview();
  if (preview) {
    if (preview.off) return null;
    if (preview.key) return preview.key;
  }
  const t = now.getTime();
  for (const e of SPECIAL_EVENTS) {
    if (t >= Date.parse(e.start) && t < Date.parse(e.end)) return e.key;
  }
  return null;
}

/** その回が今 💗 から参加できるか（start <= now < joinableUntil）。joinableUntil 省略は無期限。 */
export function isEventKeyJoinable(key: string | null | undefined, now: Date = new Date()): boolean {
  const e = getEvent(key);
  if (!e) return false;
  const t = now.getTime();
  if (t < Date.parse(e.start)) return false;
  if (e.joinableUntil && t >= Date.parse(e.joinableUntil)) return false;
  return true;
}

/** 💗リンクで参加できる回（並びの先頭）のキー。無ければ null（リンクを出さない）。 */
export function getJoinableEventKey(now: Date = new Date()): string | null {
  for (const e of SPECIAL_EVENTS) {
    if (isEventKeyJoinable(e.key, now)) return e.key;
  }
  return null;
}

/** その回が今 💗 から「閲覧」できるか（start <= now）。期限後も閲覧専用で残す。 */
export function isEventKeyViewable(key: string | null | undefined, now: Date = new Date()): boolean {
  const e = getEvent(key);
  if (!e) return false;
  return now.getTime() >= Date.parse(e.start);
}

/** 💗リンクで入れる回（並びの先頭・開始済み）のキー。期限切れでも閲覧専用で入れる。無ければ null。 */
export function getViewableEventKey(now: Date = new Date()): string | null {
  for (const e of SPECIAL_EVENTS) {
    if (isEventKeyViewable(e.key, now)) return e.key;
  }
  return null;
}

// ―― ユーザーの表示選択（どのモードを見ているか）の永続化 ――
// 通常⇔スペシャル回を自由に行き来でき、リロード後も最後の選択を覚える。
const CHOICE_KEY = "hi_special_choice"; // localStorage: スペシャル回キー or "none"

/** 保存済みの表示選択。undefined=未設定 / null=通常を明示選択 / string=回キー。 */
export function readStoredChoice(): string | null | undefined {
  try {
    const v = localStorage.getItem(CHOICE_KEY);
    if (v === null) return undefined; // 未設定
    if (v === "none") return null;    // 通常を明示
    if (getEvent(v)) return v;        // 回キー
  } catch {
    /* 権限なし等は無視 */
  }
  return undefined;
}

export function writeSpecialChoice(key: string | null): void {
  try {
    localStorage.setItem(CHOICE_KEY, key ?? "none");
  } catch {
    /* 権限なし等は無視 */
  }
}
