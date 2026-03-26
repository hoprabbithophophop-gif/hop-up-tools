import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { decompressFromEncodedURIComponent } from "lz-string";
import { getSupabase } from "@/lib/supabase";
import ProfileView from "./ProfileView";
import type { ProfileData } from "@/types/profile";

export default function SlugPage() {
  const { slug } = useParams<{ slug: string }>();
  const [data, setData] = useState<ProfileData | null>(null);
  const [template, setTemplate] = useState<string | undefined>();
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!slug) return;
    getSupabase()
      .from("short_urls")
      .select("data, template")
      .eq("slug", slug)
      .single()
      .then(({ data: row, error }) => {
        if (error || !row) { setNotFound(true); return; }
        try {
          const profileData = JSON.parse(decompressFromEncodedURIComponent(row.data) ?? "");
          setData(profileData);
          setTemplate(row.template);
        } catch {
          setNotFound(true);
        }
      });
  }, [slug]);

  if (notFound) return (
    <div style={{ textAlign: "center", padding: "2rem", fontFamily: "'Zen Maru Gothic',sans-serif", color: "#999" }}>
      プロフィールが見つかりませんでした
    </div>
  );
  if (!data) return (
    <div style={{ textAlign: "center", padding: "2rem", fontFamily: "'Zen Maru Gothic',sans-serif", color: "#bbb" }}>
      読み込み中…
    </div>
  );

  return <ProfileView data={data} template={template} />;
}
