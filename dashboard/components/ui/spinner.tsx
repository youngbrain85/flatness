// 계측 콘솔 톤의 절제된 회전 스피너 - 의미색(success/warning/error) 대신 토큰만 쓴다
// (트랙 cs-divider, 회전 호만 진행 색 cs-link로 칠해 회전을 눈으로 읽게 한다 -
// ProgressBar 채움·활성 내비와 같은 색, T12 Step 6과 동일 값).
// prefers-reduced-motion 사용자는 motion-reduce:animate-none으로 회전을 끈다
// (정지된 링만 남고 layout은 그대로 - 정보 손실 없음).
const SIZE = {
  sm: 'h-4 w-4 border-2',
  md: 'h-8 w-8 border-2',
} as const;

export function Spinner({ size = 'md' }: { size?: keyof typeof SIZE }) {
  return (
    <span
      role="status"
      className={`inline-block animate-spin rounded-full border-cs-divider border-t-cs-text motion-reduce:animate-none ${SIZE[size]}`}
    >
      <span className="sr-only">불러오는 중</span>
    </span>
  );
}
