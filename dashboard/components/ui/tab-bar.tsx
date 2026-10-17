'use client';
// 알약 탭(스펙 §6 TabBar, 아트보드 '결과 보기'): 높이 44px · 14px · line-3 테두리 · ink-2 글자,
// 활성 = ink 테두리 + surface-2 바탕 + ink 600. 내용 전환은 호출자가 active로 한다.
// label 은 탭 묶음의 이름(aria-label)이다(아트보드 role="tablist" aria-label="결과 보기").
export function TabBar<T extends string>({ tabs, active, onChange, label }: {
  tabs: { id: T; label: string }[]; active: T; onChange: (id: T) => void; label?: string;
}) {
  return (
    <div role="tablist" aria-label={label} className="flex flex-wrap gap-2">
      {tabs.map((t) => {
        const on = t.id === active;
        return (
          <button key={t.id} type="button" role="tab" aria-selected={on} onClick={() => onChange(t.id)}
            className={`min-h-11 rounded-full border px-4 text-sm transition-colors ${on
              ? 'border-ink bg-surface-2 font-semibold text-ink'
              : 'border-line-3 bg-transparent font-medium text-ink-2 hover:text-ink'}`}>
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
