import { ImageResponse } from "@vercel/og";
import { NextRequest } from "next/server";
import { decompressFromEncodedURIComponent } from "lz-string";

export const runtime = "edge";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const raw = searchParams.get("d");

  let name = "ハロヲタ";
  let mainColor = "#E5457D";
  let freeLabels: string[] = [];

  if (raw) {
    try {
      const decoded = JSON.parse(decompressFromEncodedURIComponent(raw) ?? "");
      name = decoded.name || name;
      mainColor = decoded.oshiMembers?.[0]?.color || mainColor;
      freeLabels = (decoded.freeItems || []).map((f: { label: string }) => f.label);
    } catch (e) {}
  }

  const positions = [
    { x: 60,  y: 80  }, { x: 320, y: 40  }, { x: 620, y: 95  },
    { x: 850, y: 55  }, { x: 1050,y: 88  }, { x: 130, y: 520 },
    { x: 430, y: 560 }, { x: 720, y: 530 }, { x: 970, y: 550 },
    { x: 210, y: 290 }, { x: 920, y: 275 },
  ];

  return new ImageResponse(
    (
      <div style={{
        width: "1200px", height: "630px",
        background: "#fffbf7",
        display: "flex", alignItems: "center", justifyContent: "center",
        position: "relative", overflow: "hidden",
        fontFamily: "sans-serif",
      }}>
        <div style={{
          position: "absolute", top: 0, left: 0, right: 0, height: "10px",
          background: mainColor, display: "flex",
        }} />

        {freeLabels.slice(0, positions.length).map((label, i) => (
          <div key={i} style={{
            position: "absolute",
            left: `${positions[i].x}px`,
            top: `${positions[i].y}px`,
            fontSize: "22px", fontWeight: 700,
            color: `${mainColor}22`,
            display: "flex", whiteSpace: "nowrap",
          }}>
            {label}
          </div>
        ))}

        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "16px", zIndex: 1 }}>
          <div style={{ fontSize: "100px", fontWeight: 900, color: mainColor, lineHeight: 1, display: "flex" }}>
            {name}
          </div>
          <div style={{ fontSize: "40px", fontWeight: 700, color: "#aaa", display: "flex" }}>
            のプロフィール帳
          </div>
        </div>

        <div style={{
          position: "absolute", bottom: "16px", right: "24px",
          fontSize: "18px", color: "#ccc", display: "flex",
        }}>
          ハロプロ プロフ帳メーカー
        </div>
      </div>
    ),
    { width: 1200, height: 630 }
  );
}
