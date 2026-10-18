// 로딩 화면 몸통(스펙 §5: loading.tsx는 페이지와 같은 본문 클래스 PAGE_MAIN). 스켈레톤 대신 가운데 스피너로
// "불러오는 중"을 알린다(사용자 피드백: 스켈레톤만으로는 인지 못 함).
// 헤더 자리는 셸 헤더 세 종류가 함께 쓰는 틀 클래스(HEADER_CLASS, Task 2)를 그대로 빌려 같은 높이·선으로 잡는다.
import { HEADER_CLASS } from '@/components/shell/brand';
import { MAIN_BG, PAGE_MAIN } from './page';
import { Spinner } from './spinner';

/** 현장 레이아웃(app/sites/[id]/layout.tsx)의 <main> 안에 들어가는 몸통. */
export function LoadingBody() {
  return (
    <div className={PAGE_MAIN} aria-busy="true">
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3">
        <Spinner size="md" />
        <p className="text-sm text-muted">불러오는 중…</p>
      </div>
    </div>
  );
}

/** 헤더를 페이지가 직접 그리는 경로(진입·설정·로그인·스캔·정합·보고서 생성/상세)의 로딩 화면.
 *  헤더 자리(HEADER_CLASS: 최소 64px, 아래 1px line)를 먼저 잡아 두어 헤더가 그려질 때 본문이 덜 튄다.
 *  loading.tsx는 현장·계정을 모르므로 빈 틀만 둔다(상표 링크를 넣으면 aria-hidden 안에 초점 대상이 생긴다). */
export function LoadingScreen() {
  return (
    <>
      <div aria-hidden="true" className={HEADER_CLASS} />
      <main className={MAIN_BG}>
        <LoadingBody />
      </main>
    </>
  );
}
