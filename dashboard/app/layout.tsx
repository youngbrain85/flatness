import type { Metadata } from 'next';
import { Noto_Sans_KR, Geist_Mono } from 'next/font/google';
import './globals.css';
import { Sidebar } from '@/components/sidebar';

const notoSansKr = Noto_Sans_KR({ subsets: ['latin'], variable: '--font-noto-sans-kr' });
const geistMono = Geist_Mono({ subsets: ['latin'], variable: '--font-geist-mono' });

export const metadata: Metadata = {
  title: 'Flatness — 평활도 분석 콘솔',
  description: '현장 바닥·벽면 평활도 스크리닝 결과 대시보드',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body className={`${notoSansKr.variable} ${geistMono.variable} min-h-screen bg-zinc-50 font-sans text-zinc-900 antialiased`}>
        {/* 리뷰 Critical: flex(가로)를 모든 뷰포트에 고정하면 375px에서 모바일
            <header md:hidden>이 flex-row 아이템이 되어 세로로 늘어나 붙고 본문이
            찌그러진다(실측 header 321x1030, 본문 321x54). 모바일은 세로 스택
            (헤더 위 / 본문 아래, 둘 다 cross-axis stretch로 자연스럽게 풀폭),
            md 이상에서만 가로 스택(사이드바 + 본문)으로 전환한다. */}
        <div className="flex min-h-screen flex-col md:flex-row">
          <Sidebar />
          <div className="min-w-0 flex-1">{children}</div>
        </div>
      </body>
    </html>
  );
}
