// ハロプロの公式サイトに載っている X・Instagram のアカウント名。
// 出どころ: helloproject.com の各グループのページと /link/ に貼られたリンクの住所を、2026-10-19 に正規表現で機械的に拾った物
// （公式ページの本文は読んでいない。拾い方は本文でなくリンクの住所だけ）。名簿はこの日付の時点の物で、加入・卒業で変わる。
// 線引き（Hop 決定 2026-10-19）: 「公式サイトに載っているか」だけ。番組・フェスの公式アカウントは載せない。
// 載っていないアカウントも止めない。ヒントの札に「公式サイトに載っていないアカウント」と出して通す（YouTube の名札と同じ考え）。
// 使い道: ①ヒントの札の判定（会社・ショップ・メンバー個人も含めた全件） ②作る画面の「公式の投稿を探す」補助（グループ分だけ。並びは共通データのグループ順）。
import { OFFICIAL_BLOGS } from "./officialBlogs";
import { googlePeriodWords, xPeriodWords, type SearchPeriod } from "../lib/crossword/searchPeriod";

export type SocialService = "x" | "ig";

export interface OfficialAccountGroup {
  key: string; // OFFICIAL_BLOGS と同じ key
  label: string;
  /** グループのアカウント（並びの先頭。X はこれだけ） */
  x: string[];
  /** Instagram。先頭がグループ、続きがメンバー個人（公式サイトのグループのページに貼られている分） */
  ig: string[];
}

const label = (key: string) => OFFICIAL_BLOGS.find((g) => g.key === key)?.label ?? key;

export const OFFICIAL_ACCOUNT_GROUPS: OfficialAccountGroup[] = [
  {
    key: "morningmusume",
    label: label("morningmusume"),
    x: ["MorningMusumeMg"],
    ig: ["morningmusume_official", "ako__yumigeta.official", "haruka__inoue.official", "homare__okamura.official", "mei_yamazaki.official", "miki_nonaka.official", "rio_sakurai.official"],
  },
  {
    key: "angerme",
    label: label("angerme"),
    x: ["angerme_upfront"],
    ig: ["angerme_official", "hana_goto.official", "layla_ise.official", "rin_hashisako.official", "rin_kawana.official", "shion_tamenaga.official", "wakana_matsumoto.official", "yuki_hirayama.official", "yukiho_shimoitani.official"],
  },
  {
    key: "juicejuice",
    label: label("juicejuice"),
    x: ["JuiceJuice_uf"],
    ig: ["juice_juice_official", "akari_endo.official", "ichika_arisawa.official", "kisaki_ebata.official", "mifu_kawashima.official", "rei_inoue.official", "riai_matsunaga.official", "risa_irie.official", "ruru_dambara.official", "sakura.ishiyama_official", "yume_kudo.official"],
  },
  {
    key: "tsubaki",
    label: label("tsubaki"),
    x: ["tsubakifac_uf"],
    ig: ["tsubakifactory_official", "ami_tanimoto.official", "mao__akiyama.official", "marine_fukuda.official", "mizuho_ono.official", "runo_yofu.official", "saori_onoda.official", "yuumi__kasai.official"],
  },
  {
    key: "beyooooonds",
    label: label("beyooooonds"),
    x: ["BEYOOOOONDS_"],
    ig: ["beyooooonds_official", "hana_kojima.official", "honoka_kobayashi.official", "kokoro_maeda.official", "minami_okamura.official", "miyo_hirai.official", "momohime_kiyono.official", "saya_eguchi.official", "shiori_nishida.official", "utano_satoyoshi.official"],
  },
  {
    key: "ochanorma",
    label: label("ochanorma"),
    x: ["ocha_norma"],
    ig: ["ocha_norma_official", "kirara_yonemura.official", "madoka_saito.official", "miku_nishizaki.official", "momo_kitahara.official", "nanami_kubota.official", "natsume_nakayama.official", "roko_tsutsui.official", "ruli_hiromoto.official"],
  },
  {
    key: "rosy",
    label: label("rosy"),
    x: ["Rosy_Chronicle"],
    ig: ["rosy_chronicle_official"],
  },
];

// グループのページ以外（/link/）にだけ載っているアカウント。札の判定にだけ使う（探す補助の選択肢には出さない）
const OTHER_X = [
  "ODYSTAFF", "SATOYAMAmovemen", "UpFrontLink", "_gekijyo", "dcfactory_goods", "e_lineup_mall", "halomoba", "hello_audition",
  "hello_shop", "hello_shop_en", "hello_shop_mo", "hello_shop_nago", "hello_shop_osak", "kenshusei_uf", "m_line_music", "minimochan_dayo",
  "odybooks", "uf_contents", "ufgoodsland", "ufi_fc", "upfrontworks",
];
const OTHER_IG = ["dcfactorygoods", "hello_shop_official", "helloproject_stream", "hp_officialfanclub", "minimochan_dapyon", "odybooks"];

// アカウント名の大文字小文字は区別しない（X は Rosy_Chronicle と rosy_chronicle の両方の書き方で載っている）
const ALL: Record<SocialService, Set<string>> = {
  x: new Set([...OFFICIAL_ACCOUNT_GROUPS.flatMap((g) => g.x), ...OTHER_X].map((h) => h.toLowerCase())),
  ig: new Set([...OFFICIAL_ACCOUNT_GROUPS.flatMap((g) => g.ig), ...OTHER_IG].map((h) => h.toLowerCase())),
};

export function isListedAccount(service: SocialService, handle: string): boolean {
  return ALL[service].has(handle.toLowerCase());
}

// X の投稿を探す言葉と住所（新しい順）。言葉は必須。期間（いつごろ）は since:/until: で足す。写して使えるように、言葉そのものも返す
export function officialXSearchQuery(group: OfficialAccountGroup, keyword: string, period: SearchPeriod | null = null): string {
  const from = group.x.map((h) => `from:${h}`).join(" OR ");
  return `${keyword.trim()} (${from})${xPeriodWords(period)}`;
}
export function officialXSearchUrl(group: OfficialAccountGroup, keyword: string, period: SearchPeriod | null = null): string {
  return `https://x.com/search?q=${encodeURIComponent(officialXSearchQuery(group, keyword, period))}&f=live`;
}

// Instagram は自前の検索に期間が無いので Google に頼む（site:instagram.com/アカウント名）。Google が拾っている投稿だけが対象で、拾いは薄い（2026-10-19 確認: beyooooonds_official で 4 ページ）
export function officialIgSearchQuery(handle: string, keyword: string, period: SearchPeriod | null = null): string {
  return `${keyword.trim()} site:instagram.com/${handle}${googlePeriodWords(period)}`;
}
export function officialIgSearchUrl(handle: string, keyword: string, period: SearchPeriod | null = null): string {
  return `https://www.google.com/search?q=${encodeURIComponent(officialIgSearchQuery(handle, keyword, period))}`;
}

export const xAccountUrl = (handle: string) => `https://x.com/${encodeURIComponent(handle)}`;
export const igAccountUrl = (handle: string) => `https://www.instagram.com/${encodeURIComponent(handle)}/`;
