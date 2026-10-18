// 옛 새 현장 화면(스펙 §4.2 "옛 경로 처리"): 새 현장은 이제 진입 페이지(/) 안에서 만든다(Task 3).
// 옛 NewSiteForm 은 Task 3 이 진입 페이지의 인라인 새 현장 카드(components/entry/new-site-card.tsx)로 대신하며 지웠다.
import { redirect } from 'next/navigation';

export default function LegacyNewSitePage() {
  redirect('/');
}
