interface Props {
  onDismiss: () => void;
}

export default function IntroModal({ onDismiss }: Props) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onDismiss}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.4)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "1.2rem",
        zIndex: 50,
        fontFamily: "Inter, 'Noto Sans JP', sans-serif",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#fff",
          maxWidth: 360,
          width: "100%",
          padding: "1.6rem",
          boxShadow: "0 4px 24px rgba(0,0,0,.12)",
          color: "#191c1d",
        }}
      >
        <p
          style={{
            margin: 0,
            fontSize: "0.85rem",
            lineHeight: 1.7,
            color: "#474747",
          }}
        >
          『ハイ！テンション』のライブ動画に合わせて、画面下のボタンでハイ！するツールです。
        </p>
        <p
          style={{
            margin: "0.8rem 0 0",
            fontSize: "0.85rem",
            lineHeight: 1.7,
            color: "#474747",
          }}
        >
          押したタイミングが時間軸上に蓄積され、次に再生した人の画面に、過去のみんなのハイ！が✋として表示されます。
        </p>
        <p
          style={{
            margin: "0.8rem 0 0",
            fontSize: "0.85rem",
            lineHeight: 1.7,
            color: "#474747",
          }}
        >
          横アリの予行演習のつもりで、みんなで一緒にハイ！しましょう。
        </p>
        <p
          style={{
            margin: "1.2rem 0 1.4rem",
            fontSize: "0.7rem",
            lineHeight: 1.8,
            color: "#777",
          }}
        >
          ※ハイ！のタイミングは人それぞれ。
          <br />
          好きなタイミングで押してください。
          <br />
          本番(現地)では、周囲の迷惑にならないようご注意ください。
        </p>
        <button
          type="button"
          onClick={onDismiss}
          style={{
            width: "100%",
            padding: "0.8rem",
            background: "#000",
            color: "#fff",
            border: "none",
            fontSize: "0.875rem",
            fontWeight: 700,
            letterSpacing: "0.05em",
            textTransform: "uppercase",
            cursor: "pointer",
          }}
        >
          OK
        </button>
      </div>
    </div>
  );
}
