import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({}) }));

import { UnitConfirmForm } from '../unit-confirm-form';
import type { ScanRow } from '@/lib/domain/types';

const scan = {
  id: 'c1', location_id: 'l1', surface: 'floor', scanned_at: '2026-07-28',
  device: null, operator_id: null, operator_name_manual: null,
  selected_criteria_id: 'cr1', raw_file_path: 'raw-scans/s1/c1/raw.ply',
  original_filename: 'room.ply', file_format: 'ply', point_count: null,
  unit_scale: null, lineage: 'raw', status: 'awaiting_unit_confirm',
  deleted_at: null, created_at: '', updated_at: '',
} as ScanRow;

describe('UnitConfirmForm', () => {
  it('단위 3종 라디오와 확정 버튼, 원본 파일명을 렌더한다', () => {
    render(<UnitConfirmForm scan={scan} userId="u1" />);
    expect(screen.getByText(/room\.ply/)).toBeInTheDocument();
    expect(screen.getByLabelText(/m\(미터\)/)).toBeInTheDocument();
    expect(screen.getByLabelText(/cm/)).toBeInTheDocument();
    expect(screen.getByLabelText(/mm/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '단위 확정 후 분석 시작' })).toBeInTheDocument();
  });
});
