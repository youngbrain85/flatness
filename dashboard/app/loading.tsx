// 루트 로딩 화면(loading.tsx 규약: 같은 세그먼트의 layout 안에서 page 자리만 Suspense로 감싼다).
// 진입·설정·로그인처럼 헤더를 페이지가 직접 그리는 경로라 헤더 자리를 잡아 두는 LoadingScreen을 쓴다.
import { LoadingScreen } from '@/components/ui/loading-body';

export default function Loading() {
  return <LoadingScreen />;
}
