import { Container } from '@/components/ui/container';
import { LoginForm } from './login-form';

// 로그인 화면(아트보드 Login): 상단 바(44px) 아래 남은 높이의 중앙에 400px 흰 카드.
// 사이드 내비는 ConsoleShell이 /login에서 생략한다(스펙 §5) - 여기서는 본문만 그린다.
// 카드 헤더가 곧 페이지 h1이므로 Container의 title(h2 18px)을 쓰지 않고 같은 해부
// (padding 12px 20px + 하단 1px 구분선)를 직접 그린다 - h2 안에 h1을 중첩할 수 없다.
// 폭은 아트보드의 400px 고정 대신 max-w로 둔다(375px에서 카드가 화면을 넘지 않게, 스펙 §5).
export default function LoginPage() {
  return (
    <main className="flex min-h-[calc(100vh-44px)] items-center justify-center px-4">
      <Container padded={false} className="w-full max-w-[400px]">
        <div className="border-b border-cs-divider px-5 py-3">
          <h1 className="text-2xl font-bold leading-[30px]">평활도 분석 대시보드</h1>
        </div>
        <div className="p-5">
          <LoginForm />
        </div>
      </Container>
    </main>
  );
}
