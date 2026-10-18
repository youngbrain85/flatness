'use client';
// 루트 오류 화면(error.js 규약, node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/error.md).
// 오류 경계는 클라이언트 컴포넌트여야 한다. 루트 error 는 루트 layout 안에서 loading·not-found·page 와 하위
// layout(현장 레이아웃 포함)을 감싸므로, 처리하지 못한 렌더 오류가 헤더도 돌아갈 길도 없는 Next 기본 오류 화면으로
// 떨어지지 않게 여기서 진입 헤더와 현장 목록(/)으로 가는 primary 링크를 그린다(app/not-found.tsx 와 같은 꼴).
// 현장 레이아웃까지 이 경계 안이라 현장 헤더 대신 진입 헤더를 그린다. 클라이언트라 요청 헤더(proxy 가 실은
// 이메일)를 읽지 못해 계정 단추 라벨은 이메일 없이 그린다.
// "다시 시도"는 unstable_retry 를 부른다: 서버에서 다시 받아 다시 그린다. reset 은 다시 받지 않고 다시 그리기만
// 해서 서버 렌더 오류에서는 같은 오류를 또 그린다(같은 문서 "reset": 대부분은 unstable_retry 를 쓰라고 한다).
// 클라이언트 컴포넌트라 metadata 를 내보낼 수 없다(같은 문서 Global Error 의 "Good to know").
import { EntryHeader } from '@/components/shell/entry-header';
import { Button, LinkButton } from '@/components/ui/button';
import { MAIN_BG, PAGE_MAIN } from '@/components/ui/page';
import { PageHeader } from '@/components/ui/page-header';

export default function RootError({ unstable_retry }: {
  error: Error & { digest?: string };
  reset: () => void;
  unstable_retry: () => void;
}) {
  return (
    <>
      <EntryHeader email={null} />
      <main className={MAIN_BG}>
        <div className={PAGE_MAIN}>
          <PageHeader title="화면을 불러오지 못했습니다"
            description="일시적인 문제일 수 있습니다. 다시 시도하거나 현장 목록으로 돌아가세요." />
          <div className="flex flex-wrap gap-3">
            <LinkButton href="/" variant="primary">현장 목록으로</LinkButton>
            <Button onClick={() => unstable_retry()}>다시 시도</Button>
          </div>
        </div>
      </main>
    </>
  );
}
