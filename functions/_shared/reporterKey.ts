/**
 * 通報の「別々の3人」を数えるための、接続元の見分け用の値。
 * IPv6 は利用者が同じ回線の中で自分のアドレスを簡単に変えられるので、先頭の /64（前半の4塊）だけを残す。
 * IPv4 はそのまま。"::" の省略は展開してから切る。
 */
export function reporterKey(ip: string): string {
  const addr = ip.split("%")[0].trim().toLowerCase();
  if (!addr.includes(":")) return addr;

  // IPv4 の形で書かれた IPv6（::ffff:1.2.3.4）は帯に丸めず IPv4 として扱う（丸めると全員が同じ帯になる）
  const mapped = /^(?:0{0,4}:){0,5}(?:ffff:)(\d{1,3}(?:\.\d{1,3}){3})$/.exec(addr);
  if (mapped) return mapped[1];

  let text = addr;
  const v4 = /(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(text);
  if (v4) {
    const [a, b, c, d] = v4.slice(1).map(Number);
    text = text.slice(0, v4.index) + ((a << 8) | b).toString(16) + ":" + ((c << 8) | d).toString(16);
  }

  const halves = text.split("::");
  if (halves.length > 2) return addr; // 読めない形はそのまま（別の値として数えられるだけ）
  const head = halves[0] === "" ? [] : halves[0].split(":");
  const tail = halves.length === 2 && halves[1] !== "" ? halves[1].split(":") : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  if (fill < 0 || (halves.length === 1 && head.length !== 8)) return addr;
  const groups = [...head, ...Array(fill).fill("0"), ...tail];
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return addr;
  return groups
    .slice(0, 4)
    .map((g) => parseInt(g, 16).toString(16))
    .join(":") + "::/64";
}
