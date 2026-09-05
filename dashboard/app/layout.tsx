import type { Metadata } from 'next';
import { Open_Sans, Noto_Sans_KR, Geist_Mono } from 'next/font/google';
import './globals.css';
import { ConsoleShell } from '@/components/shell/console-shell';
import { TopNav } from '@/components/shell/top-nav';
import { SideNav } from '@/components/shell/side-nav';

// Cloudscape 어휘의 본문 폰트(Open Sans) + 한글(Noto Sans KR). 모노는 Geist Mono 유지(스펙 §3).
const openSans = Open_Sans({ subsets: ['latin'], variable: '--font-open-sans' });
const notoSansKr = Noto_Sans_KR({ subsets: ['latin'], variable: '--font-noto-sans-kr' });
const geistMono = Geist_Mono({ subsets: ['latin'], variable: '--font-geist-mono' });

export const metadata: Metadata = {
  title: 'Flatness — 평활도 분석 콘솔',
  description: '현장 바닥·벽면 평활도 스크리닝 결과 대시보드',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body className={`${openSans.variable} ${notoSansKr.variable} ${geistMono.variable} min-h-screen bg-white font-sans text-sm leading-5 text-cs-text antialiased`}>
        <ConsoleShell topNav={<TopNav />} sideNav={<SideNav />}>{children}</ConsoleShell>
      </body>
    </html>
  );
}
