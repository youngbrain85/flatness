// 로그인 화면 헤더(스펙 §4.2 "로그인 | 상표만", 아트보드 Login 머리): FLATNESS 상표 하나.
import { Brand, HEADER_CLASS } from './brand';

export function LoginHeader() {
  return (
    <header className={HEADER_CLASS}>
      <Brand />
    </header>
  );
}
