/**
 * hello-groups.js
 * ハロプログループ定義・グループタグ判定ロジック
 *
 * youtube-scraper.js / 将来の追加スクレイパーから共有で参照される。
 * GASのファイルはすべて同一グローバルスコープで実行されるため、
 * このファイルの変数・関数は他ファイルから直接参照できる。
 */

// ===== メンバー同期対象グループページ =====
var GROUP_PAGES = [
  { group: 'モーニング娘。',    url: 'https://www.helloproject.com/morningmusume/' },
  { group: 'アンジュルム',      url: 'https://www.helloproject.com/angerme/' },
  { group: 'Juice=Juice',       url: 'https://www.helloproject.com/juicejuice/' },
  { group: 'つばきファクトリー', url: 'https://www.helloproject.com/tsubakifactory/' },
  { group: 'BEYOOOOONDS',       url: 'https://www.helloproject.com/beyooooonds/' },
  { group: 'OCHA NORMA',        url: 'https://www.helloproject.com/ochanorma/' },
  { group: 'ロージークロニクル', url: 'https://www.helloproject.com/rosychronicle/' },
  { group: 'ハロプロ研修生',    url: 'https://www.helloproject.com/helloprokenshusei/' },
  { group: 'ハロプロ研修生',    url: 'https://www.helloproject.com/helloprokenshuseihokkaido/' },
];

// ===== 現役グループ（is_active_content 判定用） =====
// GROUP_PAGES と同期させること（活動終了グループは含めない）
var ACTIVE_GROUPS = [
  'モーニング娘。', 'アンジュルム', 'Juice=Juice', 'つばきファクトリー',
  'BEYOOOOONDS', 'OCHA NORMA', 'ロージークロニクル', 'ハロプロ研修生',
];

// ===== チャンネル → グループ 直接マッピング =====
// グループ専用チャンネルはタグを決め打ち（説明欄の誤マッチを防ぐ）
var CHANNEL_GROUP_MAP = {
  'UCoKXb95K5h3sME3c9OCBaeA': ['モーニング娘。'],
  'UCXTsCXNGHmePgo3a47hnsAA': ['つばきファクトリー'],
  'UCaAqTsMF-VcHxaLpjDGOtcg': ['ロージークロニクル'],
  'UCDwcZ85zjLKD-3-jqlv1wQQ': ['アンジュルム'],
  'UC6FadPgGviUcq6VQ0CEJqdQ': ['Juice=Juice'],
  'UCE5GP4BHm2EJx4xyxBVSLlg': ['BEYOOOOONDS'],
  'UCEbxO0RPlOQIVWrDaeepvuA': ['OCHA NORMA'],
  'UCrFu9o-a6yWxsWP0AtDVycw': ['ハロプロ研修生'],
  'UCfbSi3j0UCiS3YX-jrEg7_Q': ['つばきファクトリー'],  // happyに過ごそうよ
  'UCBWz3v7TuibgAIZXWf8pPhQ': ['BEYOOOOONDS'],          // ビヨーンズの伸びしろ
  'UCt3f_Tu1lNua1xLQZu2Td-w': ['こぶしファクトリー'],  // こぶしファクトリー
  'UCWBTV02MVmyLqNPWRGDrl6A': ['Berryz工房'],           // Berryz工房
  'UCcS2E_TVMSwbN4Q5eH7F_oA': ['℃-ute'],               // ℃-ute
  'UCoxHJjctNXq1UgGk1vx3LUw': ['カントリー・ガールズ'], // カントリー・ガールズ
  'UCQuNrURlzPsbJZD17icx7Gw': ['Buono!'],               // Buono!
  // ↓ 複数グループ混在チャンネル → タイトルキーワード判定
  // UCnoYhOtV0IXZ6lv2R-ZnB_Q: ハロ！ステ
  // UCjXGuJZhvCwBSl7dwUJDJdg: アップフロントチャンネル
  // UCFBY6EJFIwCQCl-DiYYNKlg: OMAKE CHANNEL
  // UC3oHasOAxRUwX0HpEhnWsQg: UFfanclub
  // UCNnIuuP67kGgWngvaPzSdOQ: UF Goods Land
};

// ===== グループタグ判定キーワード =====
// 専用チャンネル: CHANNEL_GROUP_MAP で決め打ち（このテーブルは使われない）
// 混在・外部チャンネル: タイトル + 概要欄（URLより前のみ）をチェック
// ※メンバー名は卒業・加入で変わるので定期的に要確認
// ※2026年4月時点
var GROUP_KEYWORDS = {
  'モーニング娘。': [
    'モーニング娘', 'Morning Musume', 'モー娘',
    '野中美希', '小田さくら', '牧野真莉愛', '岡村ほまれ', '山﨑愛生',
    '櫻井梨央', '井上春華', '弓桁朱琴',
  ],
  'アンジュルム': [
    'アンジュルム', 'ANGERME',
    '伊勢鈴蘭', '為永幸音', '橋迫鈴', '川名凜', '松本わかな',
    '平山遊季', '下井谷幸穂', '後藤花', '長野桃羽',
  ],
  'Juice=Juice': [
    'Juice=Juice', 'J=J',
    '段原瑠々', '井上玲音', '工藤由愛', '松永里愛', '有澤一華',
    '入江里咲', '江端妃咲', '石山咲良', '遠藤彩加里', '川嶋美楓', '林仁愛',
  ],
  'つばきファクトリー': [
    'つばきファクトリー', 'Tsubaki Factory',
    '谷本安美', '小野瑞歩', '小野田紗栞', '秋山眞緒', '河西結心',
    '福田真琳', '豫風瑠乃', '石井泉羽', '村田結生', '土居楓奏', '西村乙輝',
  ],
  'BEYOOOOONDS': [
    'BEYOOOOONDS',
    '西田汐里', '江口紗耶', '高瀬くるみ', '前田こころ', '岡村美波',
    '清野桃々姫', '平井美葉', '小林萌花', '里吉うたの',
  ],
  'OCHA NORMA': [
    'OCHA NORMA',
    '斉藤円香', '広本瑠璃', '米村姫良々', '窪田七海', '中山夏月姫',
    '西﨑美空', '北原もも', '筒井澪心',
  ],
  'ロージークロニクル': [
    'ロージークロニクル', 'Rosy Chronicle',
    '橋田歩果', '吉田姫杷', '小野田華凜', '村越彩菜', '植村葉純',
    '松原ユリヤ', '島川波菜', '上村麗菜', '相馬優芽',
  ],
  'ハロプロ研修生': ['ハロプロ研修生', '研修生'],

  // 活動終了グループ（ハロステ等の過去動画タグ付け用）
  'こぶしファクトリー': ['こぶしファクトリー', 'Kobushi Factory'],
  'Berryz工房':        ['Berryz工房', 'Berryz Kobo'],
  '℃-ute':            ['℃-ute', 'C-ute'],
  'カントリー・ガールズ': ['カントリー・ガールズ', 'Country Girls'],
  'スマイレージ':       ['スマイレージ', 'S/mileage'],
  'Buono!':            ['Buono!', 'ボーノ'],
};

// ===== グループタグ判定 =====
// 専用チャンネル → CHANNEL_GROUP_MAP で決め打ち
// 混在・外部チャンネル → タイトル + 概要欄（URLより前のみ）でキーワード判定
//
// 【設計メモ: なぜURLで概要欄を打ち切るか】
// YouTubeの概要欄は「本文 → 関連リンク/SNS」の構造が慣例。
// フェスや番組の概要欄では「出演全組のリンク一覧」がURL形式で並ぶことが多く、
// そこに含まれるグループ名・メンバー名が実際には出演しない動画でも
// キーワードにヒットしてしまう（CENTRAL2026、神速49秒グランプリ等で確認済み）。
// URLより前のテキストに限定することで、本文の記述だけを判定対象にできる。
function detectGroups(channelId, title, description) {
  if (CHANNEL_GROUP_MAP[channelId]) {
    return CHANNEL_GROUP_MAP[channelId];
  }

  var descHead = _extractContentHead(description);
  var text = title + ' ' + descHead;

  var tags = [];
  Object.keys(GROUP_KEYWORDS).forEach(function(group) {
    var keywords = GROUP_KEYWORDS[group];
    for (var i = 0; i < keywords.length; i++) {
      if (text.indexOf(keywords[i]) !== -1) {
        tags.push(group);
        break;
      }
    }
  });
  return tags;
}

// URLより前のテキストを抽出（概要欄のリンクセクションを除外）
// 最大500文字で打ち切り（GAS実行時間・メモリ対策）
function _extractContentHead(description) {
  if (!description) return '';
  var urlIdx = description.indexOf('https://');
  if (urlIdx === -1) urlIdx = description.indexOf('http://');
  var head = urlIdx > 0 ? description.substring(0, urlIdx) : description;
  return head.substring(0, 500).trim();
}

// ===== 現役コンテンツ判定 =====
// group_tags に現役グループが1つ以上含まれていれば true
function isActiveContent(groupTags) {
  for (var i = 0; i < groupTags.length; i++) {
    if (ACTIVE_GROUPS.indexOf(groupTags[i]) !== -1) return true;
  }
  return false;
}
