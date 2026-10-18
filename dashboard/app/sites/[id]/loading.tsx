// 현장 안 화면(대시보드·측정위치·스캔 업로드·보고서 목록) 로딩 - 현장 레이아웃이 헤더와 <main>을 이미
// 그렸으므로 몸통(LoadingBody)만 그린다.
import { LoadingBody } from '@/components/ui/loading-body';

export default function Loading() {
  return <LoadingBody />;
}
