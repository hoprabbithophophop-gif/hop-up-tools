/**
 * Hello! Project 公式サイト スケジュールスクレイパー
 * （helloproject.com の各グループ /event/ ページから公演日程を取得）
 *
 * GAS トリガーで定期実行（1日1回推奨）
 *
 * スクリプトプロパティに以下を設定：
 *   SUPABASE_URL         - Supabase プロジェクト URL
 *   SUPABASE_SERVICE_KEY - Supabase service_role キー
 *
 * 書き込み先（/schedule ツール用）:
 *   schedule_parent_events  … ツアー/イベント（親）
 *   schedule_child_events   … 各公演（子）
 *   schedule_venues         … 会場マスタ
 */

const HP_BASE = 'https://helloproject.com';

// グループ slug → DB上の group_name 表記
const HP_GROUPS = {
  morningmusume: 'モーニング娘。\'26',
  angerme: 'アンジュルム',
  juicejuice: 'Juice=Juice',
  tsubakifactory: 'つばきファクトリー',
  beyooooonds: 'BEYOOOOONDS',
  ochanorma: 'OCHA NORMA',
  rosychronicle: 'ロージークロニクル',
  helloprokenshusei: 'ハロプロ研修生',
};

/** エントリポイント（GAS トリガーはここを指定） */
function HPmain() {
  const props = PropertiesService.getScriptProperties();
  const supabaseUrl = props.getProperty('SUPABASE_URL');
  const supabaseKey = props.getProperty('SUPABASE_SERVICE_KEY');
  if (!supabaseUrl || !supabaseKey) {
    throw new Error('スクリプトプロパティに SUPABASE_URL と SUPABASE_SERVICE_KEY を設定してください');
  }

  let parentOk = 0, childOk = 0, errCount = 0;
  const seenHashes = {}; // 合同公演（同一hashが複数グループに出る）を1回だけ処理する

  for (const slug of Object.keys(HP_GROUPS)) {
    let hashes;
    try {
      hashes = fetchEventHashes(slug);
      Logger.log(slug + ': イベント ' + hashes.length + '件');
    } catch (e) {
      Logger.log('ERROR(一覧) ' + slug + ' - ' + e.message);
      errCount++;
      continue;
    }

    for (const hash of hashes) {
      if (seenHashes[hash]) continue; // 既に別グループで処理済み
      seenHashes[hash] = true;
      try {
        const ev = fetchEvent(hash, HP_GROUPS[slug]);
        if (!ev || ev.shows.length === 0) {
          // 公演日程テーブルが無いイベント（情報のみ等）はスキップ
          continue;
        }
        upsertEventToSupabase(supabaseUrl, supabaseKey, ev);
        parentOk++;
        childOk += ev.shows.length;
        Logger.log('OK: ' + ev.title + ' (' + ev.shows.length + '公演)');
        Utilities.sleep(1200);
      } catch (e) {
        Logger.log('ERROR(詳細) ' + hash + ' - ' + e.message);
        errCount++;
      }
    }
  }

  Logger.log('完了: 親=' + parentOk + ' 公演=' + childOk + ' エラー=' + errCount);
}

// ─── 取得 ──────────────────────────────────────────────

/** グループのイベント一覧ページから event hash を集める */
function fetchEventHashes(slug) {
  const url = HP_BASE + '/' + slug + '/event/';
  const html = fetchText(url);
  const set = {};
  const re = /\/event\/([a-f0-9]{32,})\/?/g;
  let m;
  while ((m = re.exec(html))) set[m[1]] = true;
  return Object.keys(set);
}

/** イベント詳細ページを取得してパースする */
function fetchEvent(hash, groupName) {
  const url = HP_BASE + '/event/' + hash + '/';
  const html = fetchText(url);
  return parseEventHtml(html, hash, groupName, url);
}

/** UTF-8 でHTML取得 */
function fetchText(url) {
  const res = UrlFetchApp.fetch(url, {
    muteHttpExceptions: true,
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; hop-up-tools/1.0)' },
  });
  const code = res.getResponseCode();
  if (code >= 400) throw new Error('HTTP ' + code + ' ' + url);
  return res.getContentText('UTF-8');
}

// ─── パース（純粋関数：ローカルでも検証可能） ──────────────

/** HTMLエンティティをデコード */
function hpDecode(s) {
  return String(s)
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, '\'')
    .replace(/&#39;/g, '\'')
    .replace(/&rsquo;|&lsquo;/g, '\'')
    .replace(/&amp;/g, '&')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&nbsp;/g, ' ');
}

/** タグを除去してテキスト化 */
function stripTags(s) {
  return hpDecode(String(s).replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

/**
 * イベント詳細HTMLをパースして {hash, group_name, title, range, shows[], venues{}} を返す。
 * 公演日程テーブル(ScheduleTable)が無ければ shows=[] を返す。
 */
function parseEventHtml(html, hash, groupName, url) {
  const h = hpDecode(html);

  // タイトル
  const titleM = h.match(/NewsHeader__title[^>]*>([\s\S]*?)<\/h1>/);
  const title = titleM ? stripTags(titleM[1]) : '';

  // 期間（年確定用）例: "2026.4.11 - 2026.6.6"
  const rangeM = h.match(/NewsHeader__date[^>]*>([\s\S]*?)<\/[^>]+>/);
  const range = rangeM ? stripTags(rangeM[1]) : '';
  const years = (range.match(/20\d\d/g) || []).map(Number);
  const startYear = years[0] || null;

  const shows = parseScheduleTable(h, startYear);

  return {
    hash: hash,
    group_name: groupName,
    title: title,
    range: range,
    detail_url: url,
    shows: shows,
  };
}

/**
 * ScheduleTable の tbody をパースして公演配列を返す。
 * 各 <tr> = 1公演。rowspan により省略される 日付/会場 は直前の値を引き継ぐ。
 * 戻り値: [{date:'YYYY-MM-DD', open_time:'HH:MM', start_time:'HH:MM',
 *           venue:'会場名', prefecture:'東京', venue_url:'...', ended:bool}]
 */
function parseScheduleTable(h, startYear) {
  const ti = h.indexOf('ScheduleTable__row');
  if (ti < 0) return [];
  const tbodyM = h.match(/<tbody>([\s\S]*?)<\/tbody>/);
  if (!tbodyM) return [];
  const body = tbodyM[1];

  const rows = body.match(/<tr[\s\S]*?<\/tr>/g) || [];
  const shows = [];

  let curDate = null;       // {y, mo, d}
  let curEnded = false;     // 日付セルの「終了」表示（rowspanで同日公演に引き継ぐ）
  let curVenue = null;      // {name, prefecture, url}
  let prevMonth = null;
  let year = startYear;

  for (const tr of rows) {
    // 日付セル（<td ... row-day ...> 〜 </td>）
    const dayCellM = tr.match(/<td[^>]*row-day[^>]*>([\s\S]*?)<\/td>/);
    if (dayCellM) {
      const dayM = dayCellM[1].match(/(\d{1,2})\s*\/\s*(\d{1,2})/);
      if (dayM) {
        const mo = Number(dayM[1]);
        const d = Number(dayM[2]);
        // 年跨ぎ補正：月が前行より小さくなったら翌年へ
        if (prevMonth !== null && mo < prevMonth && year) year += 1;
        prevMonth = mo;
        curDate = { y: year, mo: mo, d: d };
        curEnded = /終了/.test(dayCellM[1]);
      }
    }

    // 会場セル（<td ... row-venue ...> 〜 </td> の中身だけ取る）
    const venM = tr.match(/<td[^>]*row-venue[^>]*>([\s\S]*?)<\/td>/);
    if (venM) {
      const cell = venM[1];
      const urlM = cell.match(/href="([^"]+)"/);
      const txt = stripTags(cell);
      // 末尾の（都道府県）を分離
      const prefM = txt.match(/[（(]\s*([^（）()]{2,8})\s*[）)]\s*$/);
      const prefecture = prefM ? prefM[1].trim() : null;
      const name = txt.replace(/[（(]\s*[^（）()]{2,8}\s*[）)]\s*$/, '').trim();
      if (name) curVenue = { name: name, prefecture: prefecture, url: urlM ? urlM[1] : null };
    }

    // 時刻セル（開場 / 開演）
    const timeM = tr.match(/<td[^>]*row-time[^>]*>([\s\S]*?)<\/td>/);
    if (!timeM) continue; // 時刻が無い行は公演行ではない
    const times = (timeM[1].match(/(\d{1,2}):(\d{2})/g) || []);
    if (times.length === 0) continue;
    const openTime = times[0] || null;
    const startTime = times[1] || times[0]; // 2つ目=開演、無ければ1つ目

    if (!curDate || !curDate.y) continue; // 年・日付が取れない行はスキップ

    const ended = curEnded;
    const dateStr = curDate.y + '-' + pad2(curDate.mo) + '-' + pad2(curDate.d);

    shows.push({
      date: dateStr,
      open_time: openTime,
      start_time: startTime,
      venue: curVenue ? curVenue.name : null,
      prefecture: curVenue ? curVenue.prefecture : null,
      venue_url: curVenue ? curVenue.url : null,
      ended: ended,
    });
  }

  return shows;
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

// ─── Supabase 書き込み ─────────────────────────────────

function upsertEventToSupabase(supabaseUrl, supabaseKey, ev) {
  const headers = {
    'apikey': supabaseKey,
    'Authorization': 'Bearer ' + supabaseKey,
    'Content-Type': 'application/json',
    'Prefer': 'resolution=merge-duplicates,return=representation',
  };

  // 1) 親イベント UPSERT（external_id=hash がユニーク）
  // event_category は仕様の語彙に合わせる（tour / release_event / fc_event / other）
  const releaseDate = ev.shows.length ? ev.shows[0].date : null;
  const category = /ツアー|tour/i.test(ev.title) ? 'tour' : 'other';
  const parentRows = sbUpsert(supabaseUrl, headers,
    'schedule_parent_events?on_conflict=external_id', [{
      group_name: ev.group_name,
      title: ev.title,
      release_date: releaseDate,
      event_category: category,
      detail_url: ev.detail_url,
      external_id: ev.hash,
      source: 'helloproject',
    }]);
  const parentId = parentRows && parentRows[0] && parentRows[0].id;
  if (!parentId) throw new Error('親IDが取得できず: ' + ev.title);

  // 2) 会場マスタ UPSERT（name がユニーク）→ name→id を作る
  const venueId = {};
  const uniqVenues = {};
  for (const s of ev.shows) {
    if (s.venue && !uniqVenues[s.venue]) {
      uniqVenues[s.venue] = { name: s.venue, prefecture: s.prefecture, official_url: s.venue_url };
    }
  }
  for (const name of Object.keys(uniqVenues)) {
    const rows = sbUpsert(supabaseUrl, headers,
      'schedule_venues?on_conflict=name', [uniqVenues[name]]);
    if (rows && rows[0]) venueId[name] = rows[0].id;
  }

  // 3) 各公演 UPSERT（external_id=hash:date:start がユニーク）
  // 同一POST内で external_id が重複すると merge-duplicates が失敗するため除去
  const seenEid = {};
  const childRows = [];
  for (const s of ev.shows) {
    const eid = ev.hash + ':' + s.date + ':' + (s.start_time || '');
    if (seenEid[eid]) continue;
    seenEid[eid] = true;
    childRows.push({
      parent_event_id: parentId,
      venue_id: s.venue ? (venueId[s.venue] || null) : null,
      event_format: 'concert',
      event_date: s.date,
      event_open_time: s.open_time || null,
      event_start_time: s.start_time || null,
      target_members: [],
      external_id: eid,
      source: 'helloproject',
    });
  }
  if (childRows.length) {
    sbUpsert(supabaseUrl, headers, 'schedule_child_events?on_conflict=external_id', childRows);
  }
}

/** Supabase REST upsert 共通。返り値=representation配列 */
function sbUpsert(supabaseUrl, headers, pathWithQuery, rows) {
  const res = UrlFetchApp.fetch(supabaseUrl + '/rest/v1/' + pathWithQuery, {
    method: 'post',
    headers: headers,
    payload: JSON.stringify(rows),
    muteHttpExceptions: true,
  });
  const code = res.getResponseCode();
  const body = res.getContentText();
  if (code >= 400) {
    Logger.log('UPSERT エラー ' + code + ' [' + pathWithQuery + ']: ' + body);
    throw new Error('UPSERT ' + code);
  }
  try { return JSON.parse(body); } catch (e) { return null; }
}

// ─── ローカル/Node 検証用エクスポート ──────────────────
// （GAS では module が無いので無視される）
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { parseEventHtml: parseEventHtml, parseScheduleTable: parseScheduleTable, hpDecode: hpDecode, stripTags: stripTags };
}
