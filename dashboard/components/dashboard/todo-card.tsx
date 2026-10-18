// 할 일 카드(아트보드 DashStatus "할 일"): 단위 확인 대기 → 실패 → 보고서 생성 실패 → 처리 중 순서는
// buildSiteDashboard가 정했다. 줄마다 상태(점 + 글자) · 측정위치(또는 보고서 제목) · 표면·날짜 · "열기".
import { Container } from '@/components/ui/container';
import { StatusIndicator } from '@/components/ui/status-indicator';
import type { DashTodo } from '@/lib/domain/site-dashboard';
import { ArrowLink } from './arrow-link';

export function TodoCard({ todos, noScanAttention }: { todos: DashTodo[]; noScanAttention: boolean }) {
  return (
    <Container title="할 일" counter={todos.length}>
      <div className="flex flex-col gap-3.5">
        {/* role="list": Tailwind preflight 의 list-style: none 때문에 Safari VoiceOver 가 목록 의미를 버리지 않게 직접 단다 */}
        {todos.length > 0 && (
          <ul role="list" className="flex flex-col">
            {todos.map((t) => (
              <li key={t.key} data-todo={t.kind} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line py-2.5">
                <div className="flex min-w-0 flex-[1_1_180px] flex-col gap-1">
                  <StatusIndicator type={t.type}>{t.label}</StatusIndicator>
                  <span className="text-sm text-ink [overflow-wrap:anywhere]">{t.title}</span>
                  <span className="text-xs text-muted [overflow-wrap:anywhere]">
                    {t.detail} · <span className="font-mono">{t.date}</span>
                  </span>
                </div>
                <ArrowLink href={t.href} label={t.ariaLabel}>열기</ArrowLink>
              </li>
            ))}
          </ul>
        )}
        {/* 아트보드의 빈 문구: 처리 중 줄만 있을 때도 이 안내가 붙는다 */}
        {noScanAttention && <p className="text-[13px] text-muted">실패하거나 단위 확인을 기다리는 스캔은 없습니다.</p>}
      </div>
    </Container>
  );
}
