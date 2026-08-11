// 설정 화면 (스펙 §7.7)
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { ensureProfile } from '@/lib/auth/ensure-profile';
import { CriteriaList } from '@/components/settings/criteria-list';
import { ProfileForm } from '@/components/settings/profile-form';
import { UncertaintyForm } from '@/components/settings/uncertainty-form';
import { PageHeader } from '@/components/ui/page-header';
import type { CriteriaRow } from '@/lib/domain/types';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  const profile = await ensureProfile(supabase, user); // 로그인 직후 실패했어도 여기서 복구
  const [criteriaRes, settingRes, sitesRes] = await Promise.all([
    supabase.from('criteria').select('*')
      .order('site_id', { ascending: true, nullsFirst: true })
      .order('surface').order('name'),
    supabase.from('app_settings').select('value').eq('key', 'uncertainty_mm').maybeSingle(),
    supabase.from('sites').select('id, name'),
  ]);
  const u = (settingRes.data?.value ?? { floor: 5.0, wall: 8.0 }) as { floor: number; wall: number };
  const siteNames = new Map((sitesRes.data ?? []).map((s) => [s.id as string, s.name as string]));
  return (
    <main className="mx-auto max-w-6xl space-y-8 p-6">
      {/* 최종 리뷰 M1: 타 상세 화면과 같은 루트 크럼 라벨('현장')로 통일한다
          (스펙 §6.4는 "홈 ›"이라 적었지만, 실제로는 모든 화면이 '현장'을 쓴다 -
          app/sites/[id]/page.tsx, app/scans/[id]/page.tsx 등). */}
      <PageHeader crumbs={[{ href: '/', label: '현장' }, { label: '설정' }]} title="설정" />
      <section>
        <h2 className="mb-2 font-semibold">프로필</h2>
        <ProfileForm userId={user.id} initialName={profile.display_name} />
      </section>
      <section>
        <h2 className="mb-2 font-semibold">측정 불확도 U</h2>
        <p className="mb-2 text-xs text-zinc-500">
          판정식의 경계 구간 폭을 결정합니다. 분석 시점 값이 결과에 스냅샷되므로 수정해도
          과거 분석·보고서는 바뀌지 않습니다. P5 반복 스캔 재현성 시험 후 갱신 예정.
        </p>
        <UncertaintyForm initial={u} />
      </section>
      <section>
        <h2 className="mb-2 font-semibold">판정 기준</h2>
        <CriteriaList criteria={(criteriaRes.data ?? []) as CriteriaRow[]} siteNames={siteNames} />
      </section>
    </main>
  );
}
