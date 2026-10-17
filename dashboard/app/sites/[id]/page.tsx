// 임시 자리(Task 2): 현장 대시보드(스펙 §5 #03)는 Task 4 가 이 파일을 통째로 바꿔 만든다.
// 그때까지 현장 첫 화면은 측정위치 탭으로 보낸다(옛 현장 상세 본문은 ./locations 로 옮겼다).
// 현장 존재 확인은 app/sites/[id]/layout.tsx 가 먼저 한다(없는 현장은 여기까지 오지 않고 404).
import { redirect } from 'next/navigation';

export default async function SiteIndexPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/sites/${id}/locations`);
}
