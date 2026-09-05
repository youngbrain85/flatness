// 막다른 화면 금지 규칙의 구현체 - 안내 문구 + 반드시 다음 행동 버튼(primary).
import { LinkButton } from './button';

export function EmptyState({ message, actionHref, actionLabel }: {
  message: string; actionHref: string; actionLabel: string;
}) {
  return (
    <div className="rounded-cs-container bg-white px-5 py-10 text-center shadow-cs-container">
      <p className="text-sm text-cs-text-secondary">{message}</p>
      <LinkButton href={actionHref} variant="primary" className="mt-4">{actionLabel}</LinkButton>
    </div>
  );
}
