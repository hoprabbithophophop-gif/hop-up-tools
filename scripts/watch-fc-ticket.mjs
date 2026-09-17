// 本番の fc-ticket を開き、申込期間バーが出ているかを数える見張り。GitHub Actions から毎日1回動かす。
// バーが0本、または「申込期間データなし」が出ていれば異常として終了コード1で落とす（Actions の失敗通知が飛ぶ）。
// DISCORD_WEBHOOK_URL があれば Discord にも知らせる（無ければ何もしない）。
// 経緯: 2026-09-17、画面の取得が500件で切れて約1か月半バーが欠け、最後の5日は全部消えていたのに誰も気付けなかった。
import { chromium } from '@playwright/test';

const URL = process.env.FC_TICKET_URL || 'https://hop-up-tools.pages.dev/fc-ticket';
const MIN_BARS = Number(process.env.FC_TICKET_MIN_BARS || 1);

async function notify(text) {
  const hook = process.env.DISCORD_WEBHOOK_URL;
  if (!hook) return;
  try {
    await fetch(hook, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: text }) });
  } catch (e) {
    console.log('Discord への通知に失敗:', e && e.message);
  }
}

const browser = await chromium.launch();
let bars = -1, noData = false, pageErrors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.goto(URL + '?watch=' + Date.now(), { waitUntil: 'networkidle', timeout: 60000 });
  await page.getByRole('button', { name: 'Calendar' }).first().click().catch(() => {});
  await page.waitForTimeout(2000);
  bars = await page.locator('.gantt-bar-apply').count();
  const txt = await page.evaluate(() => document.body.innerText);
  noData = txt.includes('申込期間データなし');
  const failed = txt.includes('データ取得に失敗しました');
  console.log(`申込期間バー=${bars} データなし表示=${noData} 取得失敗表示=${failed} ページエラー=${pageErrors.length}`);
  if (bars < MIN_BARS || noData || failed) {
    const msg = `fc-ticket の見張り: 本番のガントに申込期間バーが ${bars} 本（データなし表示=${noData}、取得失敗表示=${failed}）。${URL}`;
    await notify(msg);
    console.error(msg);
    process.exitCode = 1;
  }
} finally {
  await browser.close();
}
