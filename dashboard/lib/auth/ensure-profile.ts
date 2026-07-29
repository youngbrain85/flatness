import type { SupabaseClient } from '@supabase/supabase-js';

export interface ProfileRow { id: string; display_name: string; }

// profiles 자동 생성 트리거가 없으므로(P2 확정) 첫 로그인 시 대시보드가 직접 만든다.
// authenticated의 insert grant는 (id, display_name) 2컬럼뿐 - 다른 컬럼을 넣으면 권한 오류가 난다.
export async function ensureProfile(
  supabase: SupabaseClient,
  user: { id: string; email?: string | null },
): Promise<ProfileRow> {
  const { data: existing } = await supabase
    .from('profiles').select('id, display_name').eq('id', user.id).maybeSingle();
  if (existing) return existing as ProfileRow;
  const displayName = (user.email ?? '').split('@')[0] || '사용자';
  const { data, error } = await supabase
    .from('profiles').insert({ id: user.id, display_name: displayName })
    .select('id, display_name').single();
  if (error) throw error;
  return data as ProfileRow;
}
