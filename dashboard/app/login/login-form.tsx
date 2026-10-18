'use client';
import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { ensureProfile } from '@/lib/auth/ensure-profile';
import { FormField, inputClass } from '@/components/ui/form';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';

export function LoginForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { data, error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    if (signInError || !data.user) {
      setError('로그인에 실패했습니다. 이메일과 비밀번호를 확인하세요.');
      setBusy(false);
      return;
    }
    try {
      await ensureProfile(supabase, data.user);
    } catch {
      // 프로필 생성 실패가 로그인 자체를 막지는 않는다(설정 화면 저장 시 재시도 가능)
    }
    // 전체 페이지 이동으로 홈에 간다. router.push('/') 다음에 router.refresh()를
    // 부르면 안 된다 - refresh는 "현재 라우트"를 다시 렌더하는 API라서 진행 중이던
    // 이동을 취소해 버린다. 그러면 레이아웃만 새 세션으로 갱신되고 URL은 /login에
    // 남아, 사용자에게는 로그인 버튼이 멈춘 것처럼 보인다(홈 렌더가 느린 배포
    // 환경에서 재현됨). 로그인은 세션 쿠키가 바뀌는 경계라 서버 컴포넌트를 확실히
    // 다시 렌더시켜야 하므로, 라우터 캐시와 경합할 여지가 없는 전체 이동을 쓴다.
    window.location.assign('/');
  }

  // 아트보드 Login 본문: 필드 사이 16px, 진짜 type=email/password 입력(스펙 §5 01행) + 브라우저 자동 완성 힌트,
  // 오류는 error 상자, 위 4px 띄운 전폭 주 버튼(화면의 유일한 주 버튼), 13px muted 안내.
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <FormField label="이메일" htmlFor="email">
        <input id="email" type="email" autoComplete="email" required value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={inputClass} />
      </FormField>
      <FormField label="비밀번호" htmlFor="password">
        <input id="password" type="password" autoComplete="current-password" required value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={inputClass} />
      </FormField>
      {error && <Alert type="error">{error}</Alert>}
      {/* busy면 Button이 비활성 모양으로 바꾼다(재시도는 실패 시 setBusy(false)로 다시 열린다) */}
      <Button type="submit" variant="primary" disabled={busy} className="mt-1 w-full">
        로그인
      </Button>
      <p className="text-[13px] leading-[1.55] text-muted">
        계정은 관리자가 Supabase 대시보드(Authentication)에서 생성합니다.
      </p>
    </form>
  );
}
