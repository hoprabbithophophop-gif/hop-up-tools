import { useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';

/** /youtube/pickup は /youtube にリダイレクト（?p= パラメータも引き継ぐ） */
export default function YouTubePickupPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const playlistId = searchParams.get('p');

  useEffect(() => {
    const to = playlistId ? `/youtube?p=${playlistId}` : '/youtube';
    navigate(to, { replace: true });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}
