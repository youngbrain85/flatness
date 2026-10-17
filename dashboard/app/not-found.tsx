// 루트 404 화면(스펙 §4.2·§4.3): 전역 셸을 지운 뒤에는 notFound()(현장·스캔·정합·보고서 상세)와 알 수 없는
// 주소가 헤더도 돌아갈 길도 없는 Next 기본 404 로 떨어진다. 루트 not-found 는 둘 다 받으므로
// (node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/not-found.md "Good to know")
// 여기서 진입 헤더(상표 + 계정 메뉴)와 현장 목록(/)으로 가는 primary 버튼을 그린다.
// not-found 는 async 서버 컴포넌트가 될 수 있다(같은 문서 "Data Fetching" 의 headers() 예시) - proxy 가 실어
// 준 사용자 헤더로 계정 메뉴 라벨을 채운다. 현장을 모르는 화면이라 현장 헤더가 아니라 진입 헤더다.
import type { Metadata } from 'next';
import { getRequestUser } from '@/lib/auth/request-user';
import { EntryHeader } from '@/components/shell/entry-header';
import { LinkButton } from '@/components/ui/button';
import { MAIN_BG, PAGE_MAIN } from '@/components/ui/page';
import { PageHeader } from '@/components/ui/page-header';

// 화면 이름만 준다(<title> 틀 "Flatness · %s" 는 루트 layout 의 title.template). 실측(Next 16.2.12): 알 수 없는
// 주소는 HTTP 404 + "Flatness · 찾을 수 없음". 스트리밍 중에 던진 notFound()는 같은 UI 가 그려지지만 HTTP 200
// (not-found.md: 스트리밍 응답은 200) + noindex 이고, 제목은 기본값 "Flatness" 로 남는다.
export const metadata: Metadata = { title: '찾을 수 없음' };

export default async function NotFound() {
  // proxy 가 실어 준 헤더만 읽는다(Auth 왕복 0회). 헤더가 없으면 이메일 없이 그린다(계정 단추 라벨은 "계정").
  const email = (await getRequestUser())?.email ?? null;
  return (
    <>
      <EntryHeader email={email} />
      <main className={MAIN_BG}>
        <div className={PAGE_MAIN}>
          <PageHeader title="페이지를 찾을 수 없습니다" description="주소가 바뀌었거나 지워진 화면입니다." />
          <LinkButton href="/" variant="primary" className="self-start">현장 목록으로</LinkButton>
        </div>
      </main>
    </>
  );
}
