import React, { useMemo } from "react";
import { Motion } from "./Motion";
import { C } from "../style";

/**
 * ClearEffect Component (Retro Stamp Ver.) — HarmonyPalette からの移植
 *
 * 懸賞ハガキに押される「承認スタンプ」をイメージした演出
 * SVGフィルターを使用して動的に「インクのかすれ」や「紙の凹凸」を表現する
 * 動き: ばね stiffness 300 / damping 20 / mass 1.5（framer-motion と同じ式で計算）
 */

export const ClearEffect: React.FC = () => {
  // スタンプの色（朱色）。DESIGN.md の例外として HarmonyPalette と同じ色
  const stampColor = C.stamp;
  // 埃の大きさと飛ぶ先（HarmonyPalette は描画のたびに乱数。ここでは出た時に1回だけ決める）
  const dust = useMemo(
    () =>
      [...Array(8)].map(() => ({
        w: Math.random() * 6 + 2,
        h: Math.random() * 6 + 2,
        x: (Math.random() - 0.5) * 300,
        y: (Math.random() - 0.5) * 300,
      })),
    []
  );

  return (
    <div className="absolute inset-0 z-50 flex justify-center items-center pointer-events-none">
      <svg className="absolute w-0 h-0">
        <defs>
          <filter id="stamp-roughness">
            <feTurbulence type="fractalNoise" baseFrequency="0.05" numOctaves="2" result="noise" />
            <feDisplacementMap in="SourceGraphic" in2="noise" scale="3" />
          </filter>
        </defs>
      </svg>

      <Motion
        initial={{ scale: 3, opacity: 0, rotate: -30 }}
        animate={{ scale: 1, opacity: 1, rotate: -5 }}
        transition={{ type: "spring", stiffness: 300, damping: 20, mass: 1.5 }}
        className="relative z-10 p-6 border-8"
        style={{
          borderColor: stampColor,
          color: stampColor,
          filter: "url(#stamp-roughness)",
          maskImage: "linear-gradient(rgba(0,0,0,0.9), rgba(0,0,0,0.9))",
        }}
      >
        <div className="text-center">
          <div className="border-t-2 border-dashed mb-2 opacity-50" style={{ borderColor: stampColor }} />

          {/* 文字は CLEARED! だけ（Hop 決定 2026-10-04。HarmonyPalette の Congratulations と APPROVED の札は外した） */}
          <h2 className="text-5xl md:text-7xl font-black tracking-tighter uppercase">CLEARED!</h2>

          <div className="border-b-2 border-dashed mt-2 opacity-50" style={{ borderColor: stampColor }} />
        </div>
      </Motion>

      {/* 衝撃エフェクト（埃が舞う） */}
      <Motion className="absolute inset-0 pointer-events-none" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
        {dust.map((d, i) => (
          <Motion
            key={i}
            className="absolute rounded-full"
            style={{ backgroundColor: stampColor, width: d.w, height: d.h, top: "50%", left: "50%" }}
            initial={{ x: 0, y: 0, opacity: 1 }}
            animate={{ x: d.x, y: d.y, opacity: 0 }}
            transition={{ duration: 0.6, ease: "easeOut" }}
          />
        ))}
      </Motion>
    </div>
  );
};

export default ClearEffect;
