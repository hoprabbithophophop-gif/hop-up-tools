// 会場名 → 座標を、厳格なルールで探す（GAS の会場見張り venue-watch.js から呼ぶ）。
//
// GAS からは User-Agent を名乗れず、Wikidata は「名乗らない問い合わせ」を1分10件の枠に落とす。
// ここ（Edge Function）なら正しく名乗れるので、会場名で探す部分だけをここに置いた（2026-09-28）。
// GAS の venue-watch.js は、まず会場の公式サイトの住所から座標を出し、出なかった時だけここに聞く。
//
// 探し方:
//  1. Wikidata: 会場名（無ければ「 大ホール」等を外した名前）とラベルが完全一致する項目のうち、
//     座標(P625)があり、所在地(P131)をたどった都道府県が公演の都道府県と一致するものだけ採用
//  2. 無ければ null（＝座標なしのまま。間違ったピンは配らない）
//
// 呼べるのは service_role の鍵だけ（公開用の鍵で叩かれて、こちらの名前で外部 API を大量に呼ばれないように）。

const USER_AGENT = "hop-up-tools-geocoder/1.0 (https://hop-up-tools.pages.dev; https://x.com/hop_rabbit_hop)";

const PREFS = [
  "北海道", "青森", "岩手", "宮城", "秋田", "山形", "福島", "茨城", "栃木", "群馬", "埼玉", "千葉", "東京", "神奈川",
  "新潟", "富山", "石川", "福井", "山梨", "長野", "岐阜", "静岡", "愛知", "三重", "滋賀", "京都", "大阪", "兵庫", "奈良", "和歌山",
  "鳥取", "島根", "岡山", "広島", "山口", "徳島", "香川", "愛媛", "高知", "福岡", "佐賀", "長崎", "熊本", "大分", "宮崎", "鹿児島", "沖縄",
];

/** 「東京都」「東京」→「東京」。都道府県でなければ空文字 */
function prefKey(pref: string): string {
  const p = String(pref || "").trim();
  const key = p === "北海道" ? p : p.replace(/[都府県]$/, "");
  return PREFS.includes(key) ? key : "";
}

/** 照合用。全角半角・空白・大文字小文字の違いを無視する */
function matchKey(s: string): string {
  return String(s).normalize("NFKC").replace(/[\s　]/g, "").toLowerCase();
}

/** 「市川市文化会館 大ホール」→「市川市文化会館」。空白の後ろのホール名が無ければ null */
function baseName(name: string): string | null {
  const m = String(name).match(/^(.+?)[\s　]+\S*(ホール|劇場|ステージ)$/);
  return m ? m[1].trim() : null;
}

type Hit = { lat: number; lon: number; label: string; source: "wikidata" };

async function wikidata(name: string, pref: string): Promise<Hit | null> {
  const queries = [name];
  const b = baseName(name);
  if (b) queries.push(b);
  for (const q of queries) {
    const url = "https://www.wikidata.org/w/api.php?action=wbsearchentities&format=json&type=item&limit=5&language=ja&uselang=ja&search=" +
      encodeURIComponent(q);
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
    if (!res.ok) { console.warn(`wikidata search ${res.status}: ${q}`); continue; }
    const ids: string[] = ((await res.json()).search ?? [])
      .filter((r: { label?: string; match?: { text?: string } }) =>
        matchKey(r.label ?? "") === matchKey(q) || matchKey(r.match?.text ?? "") === matchKey(q))
      .map((r: { id: string }) => r.id);
    for (const id of ids) {
      // 座標と、所在地をたどって行き着く都道府県（日本の都道府県 Q50337 の項目）を1回で取る
      const sparql = `SELECT ?coord ?prefLabel WHERE {
        wd:${id} wdt:P625 ?coord .
        OPTIONAL { wd:${id} wdt:P131* ?pref . ?pref wdt:P31 wd:Q50337 . }
        SERVICE wikibase:label { bd:serviceParam wikibase:language "ja". }
      } LIMIT 5`;
      const sRes = await fetch("https://query.wikidata.org/sparql?format=json&query=" + encodeURIComponent(sparql), {
        headers: { "User-Agent": USER_AGENT, Accept: "application/sparql-results+json" },
      });
      if (!sRes.ok) { console.warn(`wikidata sparql ${sRes.status}: ${id}`); continue; }
      const rows = (await sRes.json()).results?.bindings ?? [];
      for (const r of rows) {
        const got = prefKey(r.prefLabel?.value ?? "");
        if (got !== pref) { console.log(`wikidata pref mismatch: ${q} ${id} (${got || "不明"})`); continue; }
        const m = String(r.coord?.value ?? "").match(/Point\(([-\d.]+) ([-\d.]+)\)/);
        if (!m) continue;
        return { lat: Number(m[2]), lon: Number(m[1]), label: `${q}（Wikidata ${id}）`, source: "wikidata" };
      }
    }
  }
  return null;
}

/** Authorization の鍵が service_role か（署名の検証は verify_jwt に任せ、ここでは役割だけ見る） */
function isServiceRole(req: Request): boolean {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  try {
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return payload.role === "service_role";
  } catch {
    return false;
  }
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!isServiceRole(req)) return json({ error: "forbidden" }, 403);
  let body: { name?: unknown; pref?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const pref = prefKey(typeof body.pref === "string" ? body.pref : "");
  if (!name || name.length > 100) return json({ error: "invalid_name" }, 400);
  if (!pref) return json({ hit: null, reason: "unknown_pref" }); // 都道府県が分からない会場は確かめようがないので採用しない

  const hit = await wikidata(name, pref);
  return json({ hit });
});
