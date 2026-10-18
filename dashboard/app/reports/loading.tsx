// 보고서 생성·상세(/reports/new, /reports/[id]) 로딩 화면 - /reports 자체는 진입 페이지로 리다이렉트한다.
// 현장 밖 경로라 헤더를 페이지가 직접 그린다 - 헤더 자리를 잡아 두는 LoadingScreen.
import { LoadingScreen } from '@/components/ui/loading-body';

export default function Loading() {
  return <LoadingScreen />;
}
