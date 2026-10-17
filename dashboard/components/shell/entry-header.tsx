// 진입 헤더(스펙 §4.3, 아트보드 EntrySearch·Settings 머리): 상표(/) + 오른쪽 계정 메뉴.
// `/`·`/settings` 페이지가 직접 그린다(전역 셸 없음). 현장 헤더를 그릴 수 없는 화면의 대체 헤더로도 쓴다.
import { AccountMenu } from './account-menu';
import { Brand, HEADER_CLASS } from './brand';

export function EntryHeader({ email }: { email: string | null }) {
  return (
    <header className={HEADER_CLASS}>
      <Brand />
      <div className="ml-auto">
        <AccountMenu email={email} />
      </div>
    </header>
  );
}
