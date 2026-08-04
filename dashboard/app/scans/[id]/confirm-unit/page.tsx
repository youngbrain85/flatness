import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { UnitConfirmForm } from '@/components/unit-confirm-form';
import type { ScanRow } from '@/lib/domain/types';

export const dynamic = 'force-dynamic';

export default async function ConfirmUnitPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  const { data: scan } = await supabase.from('scans').select('*').eq('id', id).maybeSingle();
  if (!scan) notFound();
  // max-w-6xl은 그대로 둔다: 단계 E부터 이 화면이 높이 뷰 PNG를 함께 그리므로
  // 폼 하나만 있던 시절보다 훨씬 넓은 폭이 실제로 쓰인다(2열 배치 자체는
  // UnitConfirmForm이 담당한다 - 그림 유무에 따라 열 수가 달라지기 때문이다).
  return (
    <main className="mx-auto max-w-6xl p-6">
      <h1 className="text-xl font-bold">단위 확인</h1>
      <p className="mb-4 mt-1 text-sm text-slate-600">
        파일 좌표가 m·cm·mm 중 무엇인지 확정하는 단계입니다. 높이 뷰가 있으면 그
        축 눈금과 실제 공간 크기를 견주어 고르고, 없으면 파일명과 스캔 앱의 내보내기
        설정으로 판단하세요.
      </p>
      <UnitConfirmForm scan={scan as ScanRow} userId={user.id} />
    </main>
  );
}
