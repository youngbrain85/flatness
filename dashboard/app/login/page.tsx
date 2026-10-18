// 로그인 화면(스펙 §5 01행, 아트보드 docs/design/dark/Login.dc.html): 상표만 있는 헤더(LoginHeader) 아래
// 도면 격자 본문이 남은 높이(100vh - 헤더 64px)를 채우고, 그 가운데 400px 카드. 카드 머리가 곧 페이지 h1이므로
// Container(<h2> 제목)를 쓰지 않고 같은 모양(surface + line-2 + 12px)을 직접 그린다 - h2 안에 h1을 둘 수 없다.
// 폭은 고정 400px 대신 max-w로 둔다(390px 휴대폰에서 카드가 화면을 넘지 않게, 스펙 §7).
import type { Metadata } from 'next';
import { LoginHeader } from '@/components/shell/login-header';
import { MAIN_BG, PAGE_MAIN } from '@/components/ui/page';
import { LoginForm } from './login-form';

export const metadata: Metadata = { title: '로그인' };

export default function LoginPage() {
  return (
    <>
      <LoginHeader />
      <main className={`${MAIN_BG} flex min-h-[calc(100vh-64px)] flex-col`}>
        <div className={`${PAGE_MAIN} flex-1 items-center justify-center`}>
          <section aria-labelledby="login-title"
            className="flex w-full max-w-[400px] flex-col rounded-card border border-line-2 bg-surface">
            <div className="border-b border-line px-6 pb-[18px] pt-[22px]">
              <h1 id="login-title" className="font-heading text-2xl font-bold leading-tight">평활도 분석 대시보드</h1>
            </div>
            <div className="px-6 pb-6 pt-[22px]">
              <LoginForm />
            </div>
          </section>
        </div>
      </main>
    </>
  );
}
