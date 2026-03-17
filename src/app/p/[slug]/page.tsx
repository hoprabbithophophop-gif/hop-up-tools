import { notFound } from "next/navigation";
import { decompressFromEncodedURIComponent } from "lz-string";
import { supabase } from "@/lib/supabase";
import ProfileView from "./ProfileView";

export default async function SlugPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  const { data, error } = await supabase
    .from("short_urls")
    .select("data, template")
    .eq("slug", slug)
    .single();

  if (error || !data) notFound();

  let profileData;
  try {
    profileData = JSON.parse(decompressFromEncodedURIComponent(data.data) ?? "");
  } catch {
    notFound();
  }

  return <ProfileView data={profileData} template={data.template} />;
}
