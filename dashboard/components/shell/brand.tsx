// FLATNESS 글자 상표와 헤더 세 종류(로그인·진입·현장)가 함께 쓰는 틀 클래스.
// 로고는 쓰지 않는다(스펙 §1, 2026-10-15). 아트보드 header 의 인라인 스타일을 토큰 클래스로 옮겼다.
// 키보드 포커스 외곽선은 globals.css 의 전역 :focus-visible 이 그린다 - 셸 부품은 포커스 클래스를 달지 않는다.
import Link from 'next/link';
import { Icon } from '@/components/ui/icons';

// 아트보드 header: flex-wrap, 간격 세로 4px·가로 20px, 최소 높이 64px, 좌우 clamp(16px, 3vw, 40px),
// 위아래 8px, 아래 1px line. relative 는 휴대폰 폭에서 현장 바꾸기 목록이 헤더 기준으로 펼쳐지게 하는
// 기준점이다(site-switcher.tsx 의 패널 위치 주석).
export const HEADER_CLASS =
  'relative flex min-h-16 flex-wrap items-center gap-x-5 gap-y-1 border-b border-line px-[clamp(16px,3vw,40px)] py-2';

// 상표 링크(/). 현장 헤더는 label 로 "FLATNESS, 현장 목록으로"를 준다(아트보드 aria-label).
export function Brand({ label }: { label?: string }) {
  return (
    <Link href="/" aria-label={label} className="inline-flex min-h-11 items-center gap-2.5 rounded-control text-ink">
      <Icon name="trend" size={22} />
      <span className="text-[15px] font-bold tracking-[0.14em]">FLATNESS</span>
    </Link>
  );
}
