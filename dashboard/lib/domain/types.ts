// DB 행(001_schema.sql)과 stats.json(docs/contracts/stats-schema.md) 타입 정본
export type Surface = 'floor' | 'wall';
export type Grade = 'pass' | 'borderline' | 'repair' | 'rework' | 'na';
export type Verdict = 'pass' | 'borderline' | 'repair' | 'rework';
export type ScanStatus = 'uploaded' | 'awaiting_unit_confirm' | 'ready' | 'archived' | 'failed';
export type AnalysisStatus = 'queued' | 'processing' | 'done' | 'failed';
export type Lineage = 'raw' | 'fused_mesh' | 'unknown';

export interface SiteRow {
  id: string; name: string; address: string | null; memo: string | null;
  created_at: string; updated_at: string;
}

export interface LocationRow {
  id: string; site_id: string; building: string; floor: string; floor_order: number;
  room: string; name: string; memo: string | null; created_at: string; updated_at: string;
}

export interface Threshold {
  span_m: number | null; metric: 'flatness' | 'plumbness';
  pass_mm: number; rework_mm: number; note?: string;
}

export interface CriteriaRow {
  id: string; site_id: string | null; surface: Surface; name: string; source_text: string;
  thresholds: Threshold[]; is_default: boolean; is_active: boolean; version: number;
  supersedes_id: string | null; created_at: string;
}

export interface ScanRow {
  id: string; location_id: string; surface: Surface; scanned_at: string;
  device: string | null; operator_id: string | null; operator_name_manual: string | null;
  selected_criteria_id: string | null; raw_file_path: string | null;
  original_filename: string | null; file_format: string | null; point_count: number | null;
  unit_scale: number | null; lineage: Lineage; status: ScanStatus;
  deleted_at: string | null; created_at: string; updated_at: string;
}

export interface AnalysisRow {
  id: string; scan_id: string; surface: Surface; criteria_id: string;
  applied_criteria: AppliedCriteria | null; params: Record<string, unknown>;
  engine_version: string | null; status: AnalysisStatus; stats: Stats | null;
  coverage_pct: number | null; overall_verdict: Verdict | null; warnings: string[];
  artifacts_dir: string | null; auto_summary: string | null; user_summary: string | null;
  is_current: boolean; deleted_at: string | null; created_at: string; created_by: string | null;
}

export interface PhotoRow {
  id: string; scan_id: string | null; location_id: string | null; site_id: string | null;
  file_path: string; caption: string | null; taken_at: string | null; created_at: string;
}

// ---- stats.json (docs/contracts/stats-schema.md §1~§2) ----
export interface Worst {
  value_mm: number; cell_ix: number; cell_iy: number;
  point_x: number; point_y: number; zone_id: number | null;
}

export interface AppliedCriteria {
  name: string; source: string; span_m: number | null;
  pass_mm: number; rework_mm: number; u_mm: number;
}

export interface ZoneInfo {
  zone_id: number; level_m: number; area_m2: number;
  status: 'ok' | 'ghost' | 'furniture';
  plane_abc: [number, number, number] | null;
}

export interface WallFrame {
  p0: [number, number]; direction: [number, number]; normal: [number, number];
  u_min: number; u_max: number; z_min: number; z_max: number;
}

export interface WallInfo {
  wall_id: number; n_cells: number; height_m: number; length_m: number;
  plumbness_mm: number; plumb_grade: Verdict;
  plane_abc: [number, number, number]; frame: WallFrame;
}

export interface StatsMeta {
  file: string; n_points: number;
  engine_version?: string; surface?: Surface; source?: string;
  scale_to_m?: number; bbox_min?: [number, number, number];
  subcell_m?: number; cell_m?: number;
}

export interface Stats {
  n_cells: number; n_valid: number;
  grade_counts: Record<Grade, number>; grade_pct: Record<Grade, number>;
  value_max_mm: number | null; value_min_mm: number | null;
  value_mean_mm: number | null; value_p95_mm: number | null;
  worst: Worst | null; coverage_pct: number; reduced_span_cells: number;
  applied_criteria: AppliedCriteria; warnings: string[]; zones: ZoneInfo[];
  meta: StatsMeta; auto_summary: string;
  preview3d_paths?: string[]; // floor만
  walls?: WallInfo[];         // wall만
}

// cells.json 행 (stats-schema.md §6)
export interface CellRow {
  ix: number; iy: number; center_x: number; center_y: number;
  value_mm: number | null; span_used_m: number; occupancy: number; grade: Grade;
  worst_x: number | null; worst_y: number | null; zone_id: number | null;
}
