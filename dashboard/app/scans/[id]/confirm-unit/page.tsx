// D6: 구 URL 보존 — 이 화면이 렌더하던 것(높이 뷰 + UnitConfirmForm)은 D5(스캔 작업대
// 통합)가 app/scans/[id]/page.tsx의 awaiting_unit_confirm 섹션으로 이관했다. 이 파일은
// 이제 옛 링크를 그 섹션이 있는 스캔 상세로 보내는 리다이렉트만 한다. 로그인·존재
// 확인은 스캔 상세 페이지 자신의 가드가 이미 처리하므로 여기서 중복하지 않는다.
import { redirect } from 'next/navigation';

export default async function ConfirmUnitPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/scans/${id}`);
}
