// 설정 화면 (스펙 §7.7, §5 17행). 아트보드: docs/design/dark/Settings.dc.html
// 현장 밖 화면이라 진입 헤더(상표 + 계정 메뉴)를 이 페이지가 직접 그린다. 브레드크럼은 현장 목록 / 설정.
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { ensureProfile } from '@/lib/auth/ensure-profile';
import { getRequestUser } from '@/lib/auth/request-user';
import { CriteriaList } from '@/components/settings/criteria-list';
import { ProfileForm } from '@/components/settings/profile-form';
import { UncertaintyForm } from '@/components/settings/uncertainty-form';
import { SupabaseErrorNotice } from '@/components/supabase-error';
import { EntryHeader } from '@/components/shell/entry-header';
import { Container } from '@/components/ui/container';
import { MAIN_BG, PAGE_MAIN } from '@/components/ui/page';
import { PageHeader } from '@/components/ui/page-header';
import type { CriteriaRow } from '@/lib/domain/types';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: '설정' };

export default async function SettingsPage() {
  const supabase = await createClient();
  // proxy가 검증한 헤더를 읽는다(Auth 왕복 0회). 가드는 방어 심층으로 유지 -
  // 헬퍼가 null을 주는 경로가 생겨도 여전히 안전해야 한다.
  const user = await getRequestUser();
  if (!user) redirect('/login');
  const profile = await ensureProfile(supabase, user); // 로그인 직후 실패했어도 여기서 복구
  const [criteriaRes, settingRes, sitesRes] = await Promise.all([
    supabase.from('criteria').select('*')
      .order('site_id', { ascending: true, nullsFirst: true })
      .order('surface').order('name'),
    supabase.from('app_settings').select('value').eq('key', 'uncertainty_mm').maybeSingle(),
    supabase.from('sites').select('id, name'),
  ]);
  // 스펙 §4.3: 설정은 현장 밖 화면이라 루트 크럼이 '현장 목록'(진입 페이지)이다
  const header = <PageHeader crumbs={[{ href: '/', label: '현장 목록' }, { label: '설정' }]} title="설정" />;
  // 조회가 하나라도 실패하면 폼·표를 그리지 않는다. 저장된 U 를 못 읽었는데 기본값(5/8)을
  // 저장값처럼 보여 주면 한 칸만 고쳐 저장할 때 다른 칸이 기본값으로 덮이고, 기준을 못 읽으면
  // '(0)' 빈 표가 사실처럼 보인다. (행이 없는 것은 오류가 아니다 - 그때는 기본값이 맞다.)
  const queryError = settingRes.error ?? criteriaRes.error ?? sitesRes.error;
  if (queryError) {
    return (
      <>
        <EntryHeader email={user.email} />
        <main className={MAIN_BG}>
          <div className={PAGE_MAIN}>
            {header}
            <SupabaseErrorNotice message={queryError.message} />
          </div>
        </main>
      </>
    );
  }
  const u = (settingRes.data?.value ?? { floor: 5.0, wall: 8.0 }) as { floor: number; wall: number };
  const siteNames = new Map((sitesRes.data ?? []).map((s) => [s.id as string, s.name as string]));
  return (
    <>
      <EntryHeader email={user.email} />
      <main className={MAIN_BG}>
        <div className={PAGE_MAIN}>
          {header}
          {/* 아트보드: 프로필·측정 불확도 U 두 카드가 `flex: 1 1 420px`로 나란히, 좁은 폭에서는 쌓인다 */}
          <div className="flex flex-wrap gap-3">
            <Container title="프로필" className="min-w-0 flex-[1_1_420px]">
              <ProfileForm userId={user.id} initialName={profile.display_name} />
            </Container>
            <Container title="측정 불확도 U" className="min-w-0 flex-[1_1_420px]">
              {/* 설명문은 카드 본문(폼 위)에 둔다 - 문구 그대로 */}
              <div className="flex flex-col gap-4">
                <p className="text-sm leading-relaxed text-muted">
                  판정식의 경계 구간 폭을 결정합니다. 분석 시점 값이 결과에 스냅샷되므로 수정해도
                  과거 분석·보고서는 바뀌지 않습니다. P5 반복 스캔 재현성 시험 후 갱신 예정.
                </p>
                <UncertaintyForm initial={u} />
              </div>
            </Container>
          </div>
          {/* 판정 기준은 카드가 아니라 제목 + 그룹 + 표 상자(아트보드) */}
          <section aria-labelledby="settings-criteria-title" className="flex flex-col gap-3.5">
            <h2 id="settings-criteria-title" className="font-heading text-[19px] font-semibold">판정 기준</h2>
            <CriteriaList criteria={(criteriaRes.data ?? []) as CriteriaRow[]} siteNames={siteNames} />
          </section>
        </div>
      </main>
    </>
  );
}
