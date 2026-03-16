import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ハロプロ プロフ帳メーカー",
  description: "ハロプロファン向けプロフィールカード作成ツール。推しメンと脳内占有率を入力してシェアしよう！",
  openGraph: {
    title: "ハロプロ プロフ帳メーカー",
    description: "推しメンと脳内占有率を入力してシェアしよう！",
    images: ["/api/og"],
  },
  twitter: {
    card: "summary_large_image",
    images: ["/api/og"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Zen+Maru+Gothic:wght@400;700;900&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
