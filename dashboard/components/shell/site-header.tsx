// 현장 작업 공간 헤더(스펙 §4.3, 아트보드 DashStatus 등 현장 화면 공통 header):
// 상표(현장 목록으로) / 현장 바꾸기 / 현장 메뉴 / 오른쪽 "스캔 업로드" 주 버튼 · 계정 메뉴.
// 서버 컴포넌트다. 활성 메뉴·펼침 목록은 클라이언트 섬(SiteNav·SiteSwitcher·AccountMenu)이 맡는다.
// 휴대폰 폭에서는 flex-wrap 으로 "상표·현장 이름 / 메뉴 / 업로드·계정" 순으로 줄이 바뀐다(스펙 §7).
import { LinkButton } from '@/components/ui/button';
import { Icon } from '@/components/ui/icons';
import { AccountMenu } from './account-menu';
import { Brand, HEADER_CLASS } from './brand';
import { SiteNav } from './site-nav';
import { SiteSwitcher } from './site-switcher';

export function SiteHeader({ site, email }: { site: { id: string; name: string }; email: string | null }) {
  return (
    <header className={HEADER_CLASS}>
      <Brand label="FLATNESS, 현장 목록으로" />
      <span aria-hidden="true" className="text-[20px] text-line-3">/</span>
      <SiteSwitcher current={site} />
      <SiteNav siteId={site.id} />
      <div className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-2">
        <LinkButton href={`/sites/${site.id}/upload`} variant="primary">
          <Icon name="upload" />
          스캔 업로드
        </LinkButton>
        <AccountMenu email={email} />
      </div>
    </header>
  );
}
