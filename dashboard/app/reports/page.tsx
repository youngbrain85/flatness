// 옛 전체 보고서 목록(스펙 §4.2 "옛 경로 처리"): 보고서 목록은 이제 현장 안(/sites/[id]/reports)에 있다.
// 어느 현장인지 모르는 옛 주소라 진입 페이지로 보낸다(?location= 이 붙어 와도 같다 - 스펙: /reports → /).
import { redirect } from 'next/navigation';

export default function LegacyReportsPage() {
  redirect('/');
}
