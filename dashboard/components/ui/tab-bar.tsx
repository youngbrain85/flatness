'use client';
// 탭 바: 텍스트 14px 700, 활성 = 하단 4px cs-link. 내용 전환은 호출자가 active로 한다.
export function TabBar<T extends string>({ tabs, active, onChange }: {
  tabs: { id: T; label: string }[]; active: T; onChange: (id: T) => void;
}) {
  return (
    <div role="tablist" className="flex gap-6 border-b border-cs-divider">
      {tabs.map((t) => {
        const on = t.id === active;
        return (
          <button key={t.id} type="button" role="tab" aria-selected={on} onClick={() => onChange(t.id)}
            className={`-mb-px border-b-4 px-1 pb-2 text-sm font-bold ${on ? 'border-cs-link text-cs-text' : 'border-transparent text-cs-nav-text hover:text-cs-text'}`}>
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
