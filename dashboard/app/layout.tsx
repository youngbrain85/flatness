import type { Metadata } from 'next';
import { Anton, IBM_Plex_Mono, Montserrat, Noto_Sans_KR } from 'next/font/google';
import './globals.css';

// 다크 C안 글꼴(스펙 §3): 본문 Montserrat + 한글 Noto Sans KR, 라벨·숫자·파일명 IBM Plex Mono,
// 큰 KPI 숫자 Anton. CSS 변수 이름은 globals.css @theme 의 --font-* 가 부르는 이름과 같아야 한다
// (app/__tests__/layout.test.tsx 가 대조). Montserrat·Noto Sans KR 은 가변 글꼴이라 weight 를 적지 않고,
// IBM Plex Mono·Anton 은 가변 글꼴이 아니라 weight 가 필수다(아트보드 글꼴 링크: Plex Mono 400·500, Anton 400).
const montserrat = Montserrat({ subsets: ['latin'], variable: '--font-montserrat' });
const notoSansKr = Noto_Sans_KR({ subsets: ['latin'], variable: '--font-noto-sans-kr' });
const plexMono = IBM_Plex_Mono({ subsets: ['latin'], weight: ['400', '500'], variable: '--font-plex-mono' });
const anton = Anton({ subsets: ['latin'], weight: '400', variable: '--font-anton' });

// <title> 은 "Flatness · 화면 이름"(스펙 §9). 하위 경로의 page 가 metadata.title 에 화면 이름만 주면
// 이 template 이 붙는다. 같은 경로 단위인 app/page.tsx 에는 template 이 붙지 않으므로 그 page 는
// title 을 'Flatness · 현장 목록' 처럼 전체 문자열로 준다(Next.js generate-metadata 문서 title.template).
export const metadata: Metadata = {
  title: { default: 'Flatness', template: 'Flatness · %s' },
  description: '현장 바닥·벽면 평활도 스크리닝 결과 대시보드',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body className={`${montserrat.variable} ${notoSansKr.variable} ${plexMono.variable} ${anton.variable} min-h-screen bg-ground font-sans text-[15px] leading-normal text-ink antialiased`}>
        {/* 전역 셸은 없다(스펙 §4.3). 셸은 화면이 고른다 - 진입 헤더(/·/settings), 현장 헤더
            (app/sites/[id]/layout.tsx 와 현장 밖 URL 의 현장 화면), 로그인 상표 헤더(/login). */}
        {children}
      </body>
    </html>
  );
}
