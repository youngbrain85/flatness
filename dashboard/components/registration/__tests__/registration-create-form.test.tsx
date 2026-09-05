// 정합 시작 폼 (단계 F Task 5, 스펙 §6.2 2단계)
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

const pushMock = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: pushMock, refresh: vi.fn() }) }));
vi.mock('@/lib/supabase/client', () => ({ createClient: vi.fn() }));

import { createClient } from '@/lib/supabase/client';
import { RegistrationCreateForm } from '../registration-create-form';
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

  // Cloudscape 리스킨(아트보드 RegistrationNew): 컨테이너 '스캔 선택' 안 FormField 두 개
  // (라벨/설명 분리), 컨테이너 밖 우측 primary. 검증·제출 로직은 위 세 테스트가 그대로 잠근다.
  it('컨테이너 "스캔 선택" 안에 A/B 셀렉트를 FormField로, 밖에 primary 제출 버튼을 그린다', () => {
    vi.mocked(createClient).mockReturnValue(stubSupabase() as never);
    render(<RegistrationCreateForm scans={SCANS} userId="u1" />);

    expect(screen.getByRole('heading', { level: 2, name: '스캔 선택' })).toBeInTheDocument();
    const a = screen.getByLabelText('기준 스캔 (A)');
    const b = screen.getByLabelText('맞출 스캔 (B)');
    expect(a.className).toContain('border-cs-input-border');
    expect(b.className).toContain('appearance-none');
    expect(screen.getByText('이 스캔의 좌표계를 유지합니다').className).toContain('text-cs-text-secondary');
    expect(screen.getByText('A에 맞춰 회전·이동합니다')).toBeInTheDocument();
    // 셀렉트 옵션 문구(optionLabel, ISO 원문)는 그대로 - 두 셀렉트에 하나씩
    expect(screen.getAllByRole('option', { name: '동쪽.ply · 2026-08-01' })).toHaveLength(2);
    const submit = screen.getByRole('button', { name: /대응점 찍기 시작/ });
    expect(submit.className).toContain('bg-cs-link');
    expect(submit.className).toContain('rounded-full');
  });
});
