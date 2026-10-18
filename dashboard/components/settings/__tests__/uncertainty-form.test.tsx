import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

const fromMock = vi.fn();
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ from: fromMock }) }));

import { UncertaintyForm } from '../uncertainty-form';
import { inputClass } from '@/components/ui/form';

describe('UncertaintyForm', () => {
  it('상한(100mm)을 초과하면 저장 요청 없이 안내 메시지를 보여준다', async () => {
    fromMock.mockClear();
    render(<UncertaintyForm initial={{ floor: 5, wall: 8 }} />);
    fireEvent.change(screen.getByLabelText('바닥 U(mm)'), { target: { value: '999999' } });
    fireEvent.click(screen.getByRole('button', { name: '저장' }));
    expect(await screen.findByText('U는 100mm 이하여야 합니다')).toBeInTheDocument();
    expect(fromMock).not.toHaveBeenCalled();
  });

  it('초기값을 문자열 그대로 그리고(5 -> "5"), 입력은 inputClass + mono, 저장은 이 화면의 주 버튼이다', () => {
    fromMock.mockClear();
    render(<UncertaintyForm initial={{ floor: 5, wall: 8 }} />);
    const floor = screen.getByLabelText('바닥 U(mm)') as HTMLInputElement;
    const wall = screen.getByLabelText('벽면 U(mm)') as HTMLInputElement;
    expect(floor.value).toBe('5'); // String(initial.floor) - 소수점 보정 없음(무변경)
    expect(wall.value).toBe('8');
    for (const input of [floor, wall]) {
      expect(input.className).toContain(inputClass);
      expect(input.className).toContain('font-mono');
      expect(input.className).toContain('tabular-nums');
    }
    const btn = screen.getByRole('button', { name: '저장' });
    expect(btn).toHaveAttribute('type', 'submit');
    expect(btn.className).toContain('bg-ink');
  });

  it('결과 문구는 role=status 13px muted로 버튼 옆에 뜬다', async () => {
    fromMock.mockClear();
    render(<UncertaintyForm initial={{ floor: 5, wall: 8 }} />);
    fireEvent.change(screen.getByLabelText('벽면 U(mm)'), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: '저장' }));
    const msg = await screen.findByText('U는 0보다 큰 수치여야 합니다');
    expect(msg).toHaveAttribute('role', 'status');
    expect(msg.className).toContain('text-muted');
    expect(fromMock).not.toHaveBeenCalled();
  });
});

// 변이 실험(Task 11 보강): 위 단언만으로는 검증 경계(0 이하·숫자 아님·100 경계·벽면 쪽 검사)와 저장 경로
// (테이블·키·값·소수·RLS 0행 실패 판정·성공/실패 문구)가 조용히 틀어져도 통과했다.
describe('UncertaintyForm 보강 (변이 실험으로 드러난 빈틈)', () => {
  // from('app_settings').update(...).eq(...).select('key') 체인을 흉내낸다
  function mockSave(result: { data: unknown; error: unknown }) {
    const select = vi.fn(() => Promise.resolve(result));
    const eq = vi.fn(() => ({ select }));
    const update = vi.fn(() => ({ eq }));
    fromMock.mockReset();
    fromMock.mockReturnValue({ update });
    return { update, eq, select };
  }
  function submit(floor: string, wall: string) {
    render(<UncertaintyForm initial={{ floor: 5, wall: 8 }} />);
    fireEvent.change(screen.getByLabelText('바닥 U(mm)'), { target: { value: floor } });
    fireEvent.change(screen.getByLabelText('벽면 U(mm)'), { target: { value: wall } });
    fireEvent.click(screen.getByRole('button', { name: '저장' }));
  }

  it.each<[string, string, string, string]>([
    ['바닥이 0', '0', '8', 'U는 0보다 큰 수치여야 합니다'],
    ['벽면이 0', '5', '0', 'U는 0보다 큰 수치여야 합니다'],
    ['바닥이 음수', '-1', '8', 'U는 0보다 큰 수치여야 합니다'],
    ['벽면이 음수', '5', '-0.5', 'U는 0보다 큰 수치여야 합니다'],
    ['바닥이 숫자가 아님', 'abc', '8', 'U는 0보다 큰 수치여야 합니다'],
    ['벽면이 비어 있음', '5', '', 'U는 0보다 큰 수치여야 합니다'],
    ['바닥이 100 초과', '100.5', '8', 'U는 100mm 이하여야 합니다'],
    ['벽면이 100 초과', '5', '100.01', 'U는 100mm 이하여야 합니다'],
    ['벽면이 매우 큼', '5', '999999', 'U는 100mm 이하여야 합니다'],
  ])('%s이면 저장 요청 없이 안내한다', async (_label, floor, wall, message) => {
    mockSave({ data: [{ key: 'uncertainty_mm' }], error: null }); // 검증을 뚫으면 저장까지 가도록 열어 둔다
    submit(floor, wall);
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(fromMock).not.toHaveBeenCalled();
  });

  it('상한 100은 허용하고 소수도 그대로, app_settings의 uncertainty_mm 한 행을 갱신한다', async () => {
    const { update, eq, select } = mockSave({ data: [{ key: 'uncertainty_mm' }], error: null });
    submit('100', '4.5');
    expect(await screen.findByText('저장되었습니다 (이후 분석부터 적용)')).toBeInTheDocument();
    expect(fromMock).toHaveBeenCalledWith('app_settings');
    expect(update).toHaveBeenCalledWith({ value: { floor: 100, wall: 4.5 } });
    expect(eq).toHaveBeenCalledWith('key', 'uncertainty_mm');
    expect(select).toHaveBeenCalledWith('key'); // 갱신된 행을 돌려받아야 0행(RLS 거부)을 알아챈다
  });

  it.each<[string, { data: unknown; error: unknown }]>([
    ['0행 갱신(RLS가 거른 경우)', { data: [], error: null }],
    ['응답이 비어 있음', { data: null, error: null }],
    ['오류 응답', { data: null, error: { message: 'boom' } }],
    ['오류와 행이 함께 온 응답', { data: [{ key: 'uncertainty_mm' }], error: { message: 'boom' } }],
  ])('%s이면 저장되었다고 말하지 않고 관리자 안내를 띄운다', async (_label, result) => {
    mockSave(result);
    submit('5', '8');
    expect(await screen.findByText('수정에 실패했습니다. 측정 불확도는 관리자만 수정할 수 있습니다.')).toBeInTheDocument();
    expect(screen.queryByText(/저장되었습니다/)).toBeNull();
  });
});
