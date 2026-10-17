// 정합 시작 폼 (단계 F Task 5, 스펙 §6.2 2단계) + 다크 리스킨(Task 9, 아트보드 RegistrationNew):
// 카드 '스캔 선택' 안 FormField 둘 + 카드 밖 오른쪽 주 버튼. 검증·제출 로직은 앞의 세 테스트가 잠근다.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

const pushMock = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: pushMock, refresh: vi.fn() }) }));
vi.mock('@/lib/supabase/client', () => ({ createClient: vi.fn() }));

import { createClient } from '@/lib/supabase/client';
import { RegistrationCreateForm } from '../registration-create-form';
import { selectClass } from '@/components/ui/form';
import type { ScanRow } from '@/lib/domain/types';

function scan(id: string, name: string): ScanRow {
  return {
    id, location_id: 'l1', surface: 'floor', scanned_at: '2026-08-01', device: null,
    operator_id: null, operator_name_manual: null, selected_criteria_id: null,
    raw_file_path: null, original_filename: name, file_format: 'ply', point_count: 1,
    unit_scale: 1, lineage: 'raw', status: 'ready',
    height_view_path: `artifacts/scans/OTHER-${id}/hv.png`,
    deleted_at: null, created_at: '', updated_at: '',
  } as ScanRow;
}
const SCANS = [scan('s1', '동쪽.ply'), scan('s2', '서쪽.ply'), scan('s3', '남쪽.ply')];

function stubSupabase(o: { insertSpy?: (f: unknown) => void; error?: { message: string } } = {}) {
  return {
    from: (table: string) => {
      if (table !== 'registrations') throw new Error(`예상치 못한 테이블: ${table}`);
      return {
        insert: (fields: unknown) => {
          o.insertSpy?.(fields);
          return {
            select: () => ({
              single: async () => (o.error
                ? { data: null, error: o.error }
                : { data: { id: 'newreg' }, error: null }),
            }),
          };
        },
      };
    },
  };
}

afterEach(() => vi.clearAllMocks());

describe('RegistrationCreateForm', () => {
  it('두 스캔을 고르면 정합 행을 만들고 정합 화면으로 이동한다', async () => {
    const insertSpy = vi.fn();
    vi.mocked(createClient).mockReturnValue(stubSupabase({ insertSpy }) as never);
    render(<RegistrationCreateForm scans={SCANS} userId="u1" />);

    fireEvent.change(screen.getByLabelText(/기준 스캔/), { target: { value: 's3' } });
    fireEvent.change(screen.getByLabelText(/맞출 스캔/), { target: { value: 's1' } });
    fireEvent.click(screen.getByRole('button', { name: /대응점 찍기 시작/ }));

    await vi.waitFor(() => expect(pushMock).toHaveBeenCalledWith('/registrations/newreg'));
    // Task 4 계약: a = source_scan_ids[0](기준), b = [1](맞출 스캔)
    expect(insertSpy).toHaveBeenCalledWith(expect.objectContaining({
      source_scan_ids: ['s3', 's1'], correspondences: [], status: 'awaiting_points', created_by: 'u1',
    }));
  });

  it('같은 스캔 두 개는 거부한다', async () => {
    const insertSpy = vi.fn();
    vi.mocked(createClient).mockReturnValue(stubSupabase({ insertSpy }) as never);
    render(<RegistrationCreateForm scans={SCANS} userId="u1" />);

    fireEvent.change(screen.getByLabelText(/맞출 스캔/), { target: { value: 's1' } });
    fireEvent.click(screen.getByRole('button', { name: /대응점 찍기 시작/ }));

    expect(await screen.findByText(/서로 다른 스캔/)).toBeInTheDocument();
    // 검증 실패는 error Alert로 - 스타일 문자열이 아니라 의미 속성으로 읽는다
    expect(screen.getByText(/서로 다른 스캔/).closest('[data-alert]')).toHaveAttribute('data-alert', 'error');
    expect(insertSpy).not.toHaveBeenCalled();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('생성 실패 사유를 화면에 남기고 다시 시도할 수 있게 한다', async () => {
    vi.mocked(createClient).mockReturnValue(
      stubSupabase({ error: { message: '권한이 없습니다' } }) as never);
    render(<RegistrationCreateForm scans={SCANS} userId="u1" />);

    fireEvent.click(screen.getByRole('button', { name: /대응점 찍기 시작/ }));

    expect(await screen.findByText(/권한이 없습니다/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /대응점 찍기 시작/ })).toBeEnabled();
  });

  it('카드 "스캔 선택" 안에 A/B 셀렉트와 도움말을, 카드 밖에 주 버튼 하나를 그린다', () => {
    vi.mocked(createClient).mockReturnValue(stubSupabase() as never);
    render(<RegistrationCreateForm scans={SCANS} userId="u1" />);

    const heading = screen.getByRole('heading', { level: 2, name: '스캔 선택' });
    const card = heading.closest('[class*="rounded-card"]') as HTMLElement;
    expect(card).not.toBeNull();
    const a = screen.getByLabelText('기준 스캔 (A)');
    const b = screen.getByLabelText('맞출 스캔 (B)');
    expect(a.className).toBe(selectClass);
    expect(b.className).toBe(selectClass);
    expect(card.contains(a)).toBe(true);
    expect(screen.getByText('이 스캔의 좌표계를 유지합니다')).toBeInTheDocument();
    expect(screen.getByText('A에 맞춰 회전·이동합니다')).toBeInTheDocument();
    // 셀렉트 옵션 문구(optionLabel, ISO 원문)는 그대로 - 두 셀렉트에 하나씩
    expect(screen.getAllByRole('option', { name: '동쪽.ply · 2026-08-01' })).toHaveLength(2);

    const submit = screen.getByRole('button', { name: '대응점 찍기 시작' });
    expect(submit).toHaveAttribute('type', 'submit');
    expect(submit.className).toContain('bg-ink');
    expect(card.contains(submit)).toBe(false);
    // 주 버튼(ink 채움)은 이 화면에 하나뿐이다
    expect(screen.getAllByRole('button').filter((el) => el.className.includes('bg-ink'))).toHaveLength(1);
  });
});

// ---- Task 9 변이 실험 보강 --------------------------------------------------------------------
// 변이 실험(보고서 참고)으로 드러난 빈틈: 제출 중 잠금(이중 제출 방지), 재제출 시 지난 오류 해제, 폼 기본 동작
// 차단, 후보가 하나뿐일 때 B 가 비는 경우, 응답에 데이터가 없는 경우, 오류 문구 원문, 오류 상자·버튼 줄의 자리.
const SAME_SCAN_MESSAGE = '서로 다른 스캔 두 개를 고르세요. 같은 스캔끼리는 정합할 수 없습니다.';

describe('RegistrationCreateForm 변이 실험 보강 (Task 9)', () => {
  it('제출 중에는 버튼이 잠겨 한 번만 보내고, 끝나면 이동한다', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const insertSpy = vi.fn();
    vi.mocked(createClient).mockReturnValue({
      from: () => ({
        insert: (fields: unknown) => {
          insertSpy(fields);
          return { select: () => ({ single: async () => { await gate; return { data: { id: 'newreg' }, error: null }; } }) };
        },
      }),
    } as never);
    render(<RegistrationCreateForm scans={SCANS} userId="u1" />);

    const submit = screen.getByRole('button', { name: '대응점 찍기 시작' });
    fireEvent.click(submit);
    await vi.waitFor(() => expect(submit).toBeDisabled());
    fireEvent.click(submit); // 잠긴 버튼은 눌러도 아무 일이 없다
    expect(insertSpy).toHaveBeenCalledTimes(1);

    release();
    await vi.waitFor(() => expect(pushMock).toHaveBeenCalledWith('/registrations/newreg'));
  });

  it('B 로 고를 스캔이 없으면(후보가 하나뿐이면) 보내지 않고 안내 문구를 그대로 보인다', async () => {
    const insertSpy = vi.fn();
    vi.mocked(createClient).mockReturnValue(stubSupabase({ insertSpy }) as never);
    render(<RegistrationCreateForm scans={[SCANS[0]]} userId="u1" />);

    fireEvent.click(screen.getByRole('button', { name: /대응점 찍기 시작/ }));
    expect(await screen.findByText(SAME_SCAN_MESSAGE)).toBeInTheDocument();
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it('다시 제출하면 지난 오류를 먼저 지운다', async () => {
    vi.mocked(createClient).mockReturnValue(stubSupabase() as never);
    render(<RegistrationCreateForm scans={SCANS} userId="u1" />);

    fireEvent.change(screen.getByLabelText(/맞출 스캔/), { target: { value: 's1' } });
    fireEvent.click(screen.getByRole('button', { name: /대응점 찍기 시작/ }));
    expect(await screen.findByText(SAME_SCAN_MESSAGE)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/맞출 스캔/), { target: { value: 's2' } });
    fireEvent.click(screen.getByRole('button', { name: /대응점 찍기 시작/ }));
    await vi.waitFor(() => expect(pushMock).toHaveBeenCalledWith('/registrations/newreg'));
    expect(screen.queryByText(SAME_SCAN_MESSAGE)).toBeNull();
  });

  it('생성 실패 사유와 "알 수 없는 오류" 문구를 앞부분까지 그대로 보인다', async () => {
    vi.mocked(createClient).mockReturnValue(stubSupabase({ error: { message: '권한이 없습니다' } }) as never);
    const first = render(<RegistrationCreateForm scans={SCANS} userId="u1" />);
    fireEvent.click(screen.getByRole('button', { name: /대응점 찍기 시작/ }));
    expect(await screen.findByText('정합을 시작하지 못했습니다: 권한이 없습니다')).toBeInTheDocument();
    first.unmount();

    // 오류도 데이터도 없는 응답
    vi.mocked(createClient).mockReturnValue({
      from: () => ({ insert: () => ({ select: () => ({ single: async () => ({ data: null, error: null }) }) }) }),
    } as never);
    render(<RegistrationCreateForm scans={SCANS} userId="u1" />);
    fireEvent.click(screen.getByRole('button', { name: /대응점 찍기 시작/ }));
    expect(await screen.findByText('정합을 시작하지 못했습니다: 알 수 없는 오류')).toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('폼 제출의 기본 동작(페이지 이동)은 막는다', async () => {
    vi.mocked(createClient).mockReturnValue(stubSupabase() as never);
    const { container } = render(<RegistrationCreateForm scans={SCANS} userId="u1" />);

    // fireEvent 는 기본 동작이 취소됐을 때 false 를 돌려준다
    expect(fireEvent.submit(container.querySelector('form') as HTMLFormElement)).toBe(false);
    await vi.waitFor(() => expect(pushMock).toHaveBeenCalled());
  });

  it('오류 상자는 카드 안에, 주 버튼 줄은 카드 밖 오른쪽에 있다', async () => {
    vi.mocked(createClient).mockReturnValue(stubSupabase() as never);
    render(<RegistrationCreateForm scans={SCANS} userId="u1" />);
    fireEvent.change(screen.getByLabelText(/맞출 스캔/), { target: { value: 's1' } });
    fireEvent.click(screen.getByRole('button', { name: /대응점 찍기 시작/ }));

    const card = screen.getByRole('heading', { level: 2, name: '스캔 선택' }).closest('[class*="rounded-card"]') as HTMLElement;
    const alert = (await screen.findByText(SAME_SCAN_MESSAGE)).closest('[data-alert]') as HTMLElement;
    expect(card.contains(alert)).toBe(true);
    expect(screen.getByRole('button', { name: '대응점 찍기 시작' }).parentElement?.className).toContain('justify-end');
  });
});
