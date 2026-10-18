// /reports/new?site= 에서 먼저 보여 주는 측정위치 고르기(D7 Step 1 → Task 10): 이 현장의 측정위치만,
// 현장 묶음(optgroup) 없이 나열한다. 화면 안에서 현장을 고르지 않는다(스펙 §5 15행).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

const pushMock = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: pushMock }) }));

import { ReportLocationPicker } from '../report-location-picker';
import { selectClass } from '@/components/ui/form';
import type { LocationRow } from '@/lib/domain/types';

function location(id: string, over: Partial<LocationRow> = {}): LocationRow {
  return {
    id, site_id: 's1', building: '101동', floor: '3층', floor_order: 3, room: '301호', name: '거실',
    memo: null, created_at: '', updated_at: '', ...over,
  };
}

const locations = [
  location('l1'),
  location('l2', { room: '302호' }),
  location('l3', { building: '', floor: '', room: '', name: '로비' }),
];

describe('ReportLocationPicker', () => {
  beforeEach(() => { pushMock.mockClear(); });

  it('현장 묶음 없이 이 현장의 측정위치를 " / "로 이어 나열한다', () => {
    render(<ReportLocationPicker locations={locations} />);
    const sel = screen.getByLabelText('측정위치') as HTMLSelectElement;
    expect(sel.querySelectorAll('optgroup')).toHaveLength(0);
    expect([...sel.options].map((o) => o.textContent)).toEqual([
      '선택...', '101동 / 3층 / 301호 / 거실', '101동 / 3층 / 302호 / 거실', '로비',
    ]);
    expect(sel.className).toBe(selectClass);
    // selectClass 는 appearance-none 이라 SelectWrap 의 chevron 이 유일한 드롭다운 표시다 - 셀렉트 바로 옆에 있어야 한다
    expect(sel.nextElementSibling).toHaveAttribute('data-icon', 'chevron-down');
  });

  it('선택하면 그 측정위치로 보고서 생성 화면을 다시 요청한다(서버 재조회로 후보 로드)', () => {
    render(<ReportLocationPicker locations={locations} />);
    fireEvent.change(screen.getByLabelText('측정위치'), { target: { value: 'l2' } });
    expect(pushMock).toHaveBeenCalledWith('/reports/new?location=l2');
  });

  it('빈 선택("선택...")으로 되돌아가면 이동하지 않는다', () => {
    render(<ReportLocationPicker locations={locations} />);
    fireEvent.change(screen.getByLabelText('측정위치'), { target: { value: '' } });
    expect(pushMock).not.toHaveBeenCalled();
  });
});
