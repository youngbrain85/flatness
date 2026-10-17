// 막다른 화면 금지 규칙의 구현체 - 안내 문구 + 반드시 다음 행동 버튼(primary). 카드 모양(surface + line-2 + 12px).
import { LinkButton } from './button';

export function EmptyState({ message, actionHref, actionLabel }: {
  message: string; actionHref: string; actionLabel: string;
}) {
  return (
    <div className="flex flex-col items-center gap-4 rounded-card border border-line-2 bg-surface px-[22px] py-10 text-center">
      <p className="text-sm text-muted">{message}</p>
      <LinkButton href={actionHref} variant="primary">{actionLabel}</LinkButton>
    </div>
  );
}
