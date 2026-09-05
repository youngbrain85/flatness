// D7 Step 1: /reports/new에 location 없이 진입했을 때 먼저 보여주는 측정위치 선택
// UI. T4(upload-form.tsx)와 같은 현장별 optgroup 단일 셀렉트 방식을 그대로 따른다.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

const pushMock = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: pushMock }) }));

import { ReportLocationPicker } from '../report-location-picker';
import type { LocationRow, SiteRow } from '@/lib/domain/types';

function site(id: string, name: string): SiteRow {
  return { id, name, address: null, memo: null, created_at: '', updated_at: '' };
}
function location(id: string, siteId: string, name: string): LocationRow {
  return {
    id, site_id: siteId, building: '', floor: '', floor_order: 0, room: '', name,
    memo: null, created_at: '', updated_at: '',
  };
}

const sites = [site('s1', '현장A'), site('s2', '현장B')];
const locations = [location('l1', 's1', '거실'), location('l2', 's2', 'P1')];

describe('ReportLocationPicker', () => {
  beforeEach(() => { pushMock.mockClear(); });

  it('현장별 optgroup으로 측정위치를 묶어 보여준다', () => {
    const { container } = render(<ReportLocationPicker sites={sites} locations={locations} />);
    const sel = screen.getByLabelText('측정위치') as HTMLSelectElement;
    const groups = [...sel.querySelectorAll('optgroup')];
    expect(groups.map((g) => g.label)).toEqual(['현장A', '현장B']);
    // T8: selectClass(2px cs-input-border) + SelectWrap의 chevron
    expect(sel.className).toContain('border-cs-input-border');
    expect(container.querySelector('[data-icon="chevron-down"]')).toBeInTheDocument();
  });

  it('측정위치가 없는 현장은 optgroup에서 빠진다(업로드 폼과 동일 규칙)', () => {
    render(
      <ReportLocationPicker sites={[...sites, site('s3', '현장C(빈 현장)')]} locations={locations} />,
    );
    const sel = screen.getByLabelText('측정위치') as HTMLSelectElement;
    const labels = [...sel.querySelectorAll('optgroup')].map((g) => g.label);
    expect(labels).not.toContain('현장C(빈 현장)');
  });

  it('선택하면 그 측정위치로 보고서 생성 화면을 다시 요청한다(서버 재조회로 후보 로드)', () => {
    render(<ReportLocationPicker sites={sites} locations={locations} />);
    fireEvent.change(screen.getByLabelText('측정위치'), { target: { value: 'l2' } });
    expect(pushMock).toHaveBeenCalledWith('/reports/new?location=l2');
  });

  it('빈 선택("선택...")으로 되돌아가면 이동하지 않는다', () => {
    render(<ReportLocationPicker sites={sites} locations={locations} />);
    fireEvent.change(screen.getByLabelText('측정위치'), { target: { value: '' } });
    expect(pushMock).not.toHaveBeenCalled();
  });
});
