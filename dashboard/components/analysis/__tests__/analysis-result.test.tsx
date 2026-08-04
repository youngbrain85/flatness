import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('@/lib/supabase/client', () => ({ createClient: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { AnalysisResult } from '../analysis-result';
import type { AnalysisRow, ScanRow, Stats } from '@/lib/domain/types';

const stats: Stats = {
  n_cells: 1, n_valid: 1,
  grade_counts: { pass: 1, borderline: 0, repair: 0, rework: 0, na: 0 },
  grade_pct: { pass: 100, borderline: 0, repair: 0, rework: 0, na: 0 },
  value_max_mm: 3.2, value_min_mm: 3.2, value_mean_mm: 3.2, value_p95_mm: 3.2,
  worst: { value_mm: 3.2, cell_ix: 0, cell_iy: 0, point_x: 0.5, point_y: 0.5, zone_id: 1 },
  coverage_pct: 98.0, reduced_span_cells: 0,
  applied_criteria: { name: 'floor-kcs-exposed', source: 'KCS 14 20 10', span_m: 3,
                      pass_mm: 7, rework_mm: 21, u_mm: 5 },
  warnings: [], zones: [],
  meta: { file: 'raw.ply', n_points: 100, surface: 'floor', engine_version: 'p1d-0.4.0' },
  auto_summary: '자동 의견',
  deviation_paths: ['deviation.png'],
};

const analysis: AnalysisRow = {
  id: 'an1', scan_id: 'scan1', surface: 'floor', criteria_id: 'c1', applied_criteria: null,
  params: {}, engine_version: 'p1d-0.4.0', status: 'done', stats, coverage_pct: 98.0,
  overall_verdict: 'pass', warnings: [], artifacts_dir: 'artifacts/an1',
  auto_summary: '자동 의견', user_summary: null, is_current: true, deleted_at: null,
  created_at: '2026-07-29', created_by: null, kind: 'flatness',
};

const scan: ScanRow = {
  id: 'scan1', location_id: 'loc1', surface: 'floor', scanned_at: '2026-07-20', device: null,
  operator_id: null, operator_name_manual: null, selected_criteria_id: null,
  raw_file_path: null, original_filename: null, file_format: null, point_count: null,
  unit_scale: null, lineage: 'raw', status: 'ready', deleted_at: null,
  created_at: '2026-07-20', updated_at: '2026-07-20',
};

describe('AnalysisResult 정밀 편차맵 탭', () => {
  it('탭을 누르면 stats.deviation_paths의 이미지를 보여준다', async () => {
    // cells.json fetch는 히트맵 탭 전용이라 빈 배열로 스텁한다
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [] } as unknown as Response)));

    render(<AnalysisResult analysis={analysis} scan={scan} photos={[]} />);
    fireEvent.click(screen.getByRole('button', { name: '정밀 편차맵' }));

    await waitFor(() => {
      const img = screen.getByAltText('정밀 편차맵(10cm)') as HTMLImageElement;
      expect(img.getAttribute('src')).toBe('/api/data/artifacts/an1/deviation.png');
    });
  });

  it('편차맵이 없는 분석에서는 안내 문구를 보여준다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [] } as unknown as Response)));
    const without = { ...analysis, stats: { ...stats, deviation_paths: undefined } };

    render(<AnalysisResult analysis={without} scan={scan} photos={[]} />);
    fireEvent.click(screen.getByRole('button', { name: '정밀 편차맵' }));

    await waitFor(() => {
      expect(screen.getByText(/정밀 편차맵이 없습니다/)).toBeInTheDocument();
    });
  });

  it('임포트(Colab) 결과에서는 편차맵 재분석을 권하지 않는다 (스펙 §8/계약 §2: 임포트 경로는 편차맵 미생성)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [] } as unknown as Response)));
    const imported: AnalysisRow = {
      ...analysis, engine_version: 'external-colab-v1',
      stats: { ...stats, deviation_paths: undefined,
                meta: { ...stats.meta, engine_version: 'external-colab-v1', source: 'colab-import' } },
    };

    render(<AnalysisResult analysis={imported} scan={scan} photos={[]} />);
    fireEvent.click(screen.getByRole('button', { name: '정밀 편차맵' }));

    await waitFor(() => {
      expect(screen.getByText(/외부\(Colab\) 임포트 결과에는 정밀 편차맵을 생성하지 않습니다/)).toBeInTheDocument();
    });
    expect(screen.queryByText(/재분석하면 생성됩니다/)).not.toBeInTheDocument();
  });
});
