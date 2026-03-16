"use client";

import { useMemo } from "react";
import type { OshiMember } from "@/types/profile";
import { isLight, darken } from "@/lib/colorUtils";

interface BrainPreviewProps {
  members: OshiMember[];
}

interface Cell extends OshiMember {
  x: number;
  y: number;
  w: number;
  h: number;
  fontSize: number;
  lineH: number;
  lines: string[];
}

export default function BrainPreview({ members }: BrainPreviewProps) {
  const cells = useMemo<Cell[]>(() => {
    if (!members?.length) return [];
    const total = members.reduce((s, m) => s + (m.percent || 0), 0);
    if (!total) return [];

    const cx = 155, cy = 175, rx = 112, ry = 122;

    // 中心点が楕円内にあるか（4隅チェックをやめて中心のみ）
    const isCenterIn = (x: number, y: number, w: number, h: number) => {
      const dx = (x + w / 2 - cx) / rx;
      const dy = (y + h / 2 - cy) / ry;
      return dx * dx + dy * dy <= 0.92;
    };

    const res: Cell[] = [];
    const placed: { x: number; y: number; w: number; h: number }[] = [];
    const sorted = [...members]
      .filter((m) => (m.percent || 0) > 0)
      .sort((a, b) => (b.percent || 0) - (a.percent || 0));

    for (const member of sorted) {
      const pct = member.percent || 0;
      const ratio = pct / Math.max(total, 1);
      const isOverflow = pct > 100;

      // 200%付近でフォント2倍。通常は最大60px、overflow時は最大120px
      const maxFs = isOverflow ? 120 : 60;
      const fs = Math.max(14, Math.min(maxFs,
        14 + 56 * Math.sqrt(ratio) * (isOverflow ? 3.0 : 1.8)
      ));

      const labelFull = member.callName || member.name;
      const charW = fs * 0.85;
      const lineH = fs * 1.2;

      // 楕円の幅の75%より長ければ2行に折り返す
      const maxLineW = rx * 1.5;
      let lines: string[];
      if (charW * labelFull.length > maxLineW && labelFull.length >= 3) {
        const mid = Math.ceil(labelFull.length / 2);
        lines = [labelFull.slice(0, mid), labelFull.slice(mid)];
      } else {
        lines = [labelFull];
      }

      const tW = Math.max(...lines.map((l) => l.length * charW)) + 12;
      const tH = lines.length * lineH + 8;

      let best: { x: number; y: number } | null = null;
      let bd = Infinity;

      const noOverlap = (x: number, y: number) =>
        !placed.some(
          (p) => !(x + tW < p.x - 1 || x > p.x + p.w + 1 || y + tH < p.y - 1 || y > p.y + p.h + 1)
        );

      // ランダム配置（中心点が楕円内ならOK）
      for (let a = 0; a < 1500; a++) {
        const ang = Math.random() * Math.PI * 2;
        const r = Math.random();
        const spread = isOverflow ? 0.55 : 0.82;
        const x = cx + Math.cos(ang) * rx * r * spread - tW / 2;
        const y = cy + Math.sin(ang) * ry * r * spread - tH / 2;
        if (!isCenterIn(x, y, tW, tH)) continue;
        if (!noOverlap(x, y)) continue;
        const d = Math.sqrt((x + tW / 2 - cx) ** 2 + (y + tH / 2 - cy) ** 2);
        if (d < bd) { bd = d; best = { x, y }; }
      }

      // フォールバック: グリッドスキャン（必ず見つかる）
      if (!best) {
        outer: for (let gy = 50; gy <= 300; gy += 6) {
          for (let gx = 40; gx <= 270; gx += 6) {
            const x = gx - tW / 2;
            const y = gy - tH / 2;
            if (!isCenterIn(x, y, tW, tH)) continue;
            if (!noOverlap(x, y)) continue;
            best = { x, y };
            break outer;
          }
        }
      }

      if (best) {
        placed.push({ x: best.x, y: best.y, w: tW, h: tH });
        res.push({ ...member, x: best.x, y: best.y, w: tW, h: tH, fontSize: fs, lineH, lines });
      }
    }

    return res;
  }, [members]);

  return (
    <svg
      viewBox="0 0 310 340"
      xmlns="http://www.w3.org/2000/svg"
      style={{ width: "100%", height: "100%", overflow: "visible" }}
    >
      {/* 首 */}
      <ellipse cx="155" cy="310" rx="42" ry="25" fill="none" stroke="#e0d8ee" strokeWidth="1.5" opacity=".25" />
      <line x1="125" y1="290" x2="120" y2="310" stroke="#e0d8ee" strokeWidth="1.5" opacity=".25" />
      <line x1="185" y1="290" x2="190" y2="310" stroke="#e0d8ee" strokeWidth="1.5" opacity=".25" />
      {/* 脳シルエット */}
      <ellipse cx="155" cy="175" rx="116" ry="126" fill="#faf8ff" stroke="#d8d0e8" strokeWidth="2" />
      <path d="M95 135 Q125 120 155 128 Q185 120 215 135" fill="none" stroke="#ece4f6" strokeWidth="1.2" />
      <path d="M82 175 Q118 160 155 168 Q192 160 228 175" fill="none" stroke="#ece4f6" strokeWidth="1.2" />
      <path d="M88 212 Q122 198 155 206 Q188 198 222 212" fill="none" stroke="#ece4f6" strokeWidth="1.2" />

      {cells.map((c, i) => {
        const lt = isLight(c.color);
        const sc = darken(c.color, 0.45);
        const textY = c.y + c.h / 2 - ((c.lines.length - 1) * c.lineH) / 2 + c.fontSize * 0.35;
        return (
          <g key={i}>
            <rect
              x={c.x} y={c.y} width={c.w} height={c.h} rx="5"
              fill={`${c.color}10`} stroke={`${c.color}28`} strokeWidth="1"
            />
            {/* 明るい色の縁取りシャドウ */}
            {lt && (
              <text
                textAnchor="middle" fontSize={c.fontSize} fontWeight="800"
                stroke={sc} strokeWidth="3" strokeLinejoin="round"
                fill={sc} opacity=".25" fontFamily="'Zen Maru Gothic',sans-serif"
              >
                {c.lines.map((line, li) => (
                  <tspan key={li} x={c.x + c.w / 2} y={textY + li * c.lineH}>{line}</tspan>
                ))}
              </text>
            )}
            {/* メインテキスト（複数行対応） */}
            <text
              textAnchor="middle" fontSize={c.fontSize} fontWeight="800"
              fill={c.color} fontFamily="'Zen Maru Gothic',sans-serif"
            >
              {c.lines.map((line, li) => (
                <tspan key={li} x={c.x + c.w / 2} y={textY + li * c.lineH}>{line}</tspan>
              ))}
            </text>
            {/* パーセント表示 */}
            <text
              x={c.x + c.w - 2} y={c.y + 10}
              textAnchor="end" fontSize="8"
              fill={lt ? sc : c.color} opacity=".55"
              fontFamily="'Zen Maru Gothic',sans-serif" fontWeight="600"
            >
              {c.percent}%
            </text>
          </g>
        );
      })}
      {!cells.length && (
        <text x="155" y="178" textAnchor="middle" fontSize="12" fill="#ccc" fontFamily="'Zen Maru Gothic',sans-serif">
          推しメンを追加してね
        </text>
      )}
    </svg>
  );
}
