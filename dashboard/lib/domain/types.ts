// DB 행(001_schema.sql)과 stats.json(docs/contracts/stats-schema.md) 타입 정본
export type Surface = 'floor' | 'wall';
export type Grade = 'pass' | 'borderline' | 'repair' | 'rework' | 'na';
export type Verdict = 'pass' | 'borderline' | 'repair' | 'rework';
export type ScanStatus = 'uploaded' | 'awaiting_unit_confirm' | 'ready' | 'archived' | 'failed';
export type AnalysisStatus = 'queued' | 'processing' | 'done' | 'failed';
export type Lineage = 'raw' | 'fused_mesh' | 'unknown';
// 007: analyses.kind/criteria.kind (기본값 'flatness'). 단계 C가 이 값으로 조회를 분기한다.
export type AnalysisKind = 'flatness' | 'slope';

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

/** 구배 기준의 thresholds[0] 형태. 평활도(span_m/metric/pass_mm/rework_mm)와 다르다. */
export interface SlopeThreshold {
  use: string;
  design_pct: number;
  pass_pct: number;
  re_pct: number;
  dir_pass_deg: number;
}

export interface CriteriaRow {
  id: string; site_id: string | null; surface: Surface; name: string; source_text: string;
  thresholds: Threshold[]; is_default: boolean; is_active: boolean; version: number;
  supersedes_id: string | null; created_at: string; kind: AnalysisKind;
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
  kind: AnalysisKind;
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
  deviation_paths?: string[]; // floor·벽 공통(정밀 편차맵 파일명, 임포트 결과에는 없음)
  walls?: WallInfo[];         // wall만
}

// cells.json 행 (stats-schema.md §6)
export interface CellRow {
  ix: number; iy: number; center_x: number; center_y: number;
  value_mm: number | null; span_used_m: number; occupancy: number; grade: Grade;
  worst_x: number | null; worst_y: number | null; zone_id: number | null;
}

// 엔진이 한국어 등급 문자열을 그대로 키로 쓴다(engine/flatness/core/slope.py GRADE_*).
// slope-heatmap.ts의 색 매핑과 SlopeSummary.counts가 이 타입을 공유한다.
export type SlopeGrade = '적합' | '경계' | '보수' | '재시공' | '판정불가';

// ---- 구배(slope) stats.json (engine/flatness/core/pipeline.py analyze_slope 반환값과 동일한 형태.
// 워커가 artifacts 경로만 버킷-상대로 치환해 저장한다) ----
export interface SlopeSummary {
  mean_dev_pct: number | null;
  std_dev_pct: number | null;
  max_dev_pct: number | null;
  counts: Record<SlopeGrade, number>;
  coverage_pct: number;
}

export interface SlopeStats {
  format: 'slope-stats-v1';
  cell_m: number;
  subcell_m: number;
  threshold: SlopeThreshold;
  summary: SlopeSummary;
  direction_judged: boolean;
  drain_points: [number, number][] | null;
  warnings: string[];
  // cells_json은 재판정(§7.3) 입력이자 이 태스크(브라우저 히트맵)의 데이터 소스다.
  // judged_json은 셀별 판정 결과(§7.2 결과표·히트맵 등급)의 데이터 소스다. 단계
  // C까지 만들어진 분석에는 두 키 모두 없다(브리프 D7) - 옵셔널로 둬서 화면이
  // 그 부재를 명시적으로 다루게 강제한다(CSV 근사 복원 금지).
  artifacts: { cells_json?: string; judged_json?: string; cells_csv: string; map_png: string };
}

// ---- slope_cells.json (engine/flatness/outputs/slope_cells.py 왕복 직렬화, schema_version=2)
// 재판정 입력이자 화면 히트맵 재구성 입력. 판정 결과(grade 등)는 담지 않는다(브리프 D1) -
// SlopeCell 13필드(기하 정보)만 반올림 없이 담긴다. slope_pct/downhill_rad/rmse_m/se_pct는
// ok=false 셀에서 엔진이 NaN -> null로 치환해 낸다(_NAN_FIELDS).
export interface SlopeCellRow {
  cx: number; cy: number; center_x: number; center_y: number; n_subcells: number;
  slope_pct: number | null; downhill_rad: number | null;
  rmse_m: number | null; se_pct: number | null;
  width_m: number; height_m: number; ok: boolean; zone_id: number | null;
}

export interface SlopeCellsFile {
  schema_version: number; engine_version: string; cell_m: number; subcell_m: number;
  cells: SlopeCellRow[];
}

// ---- slope_judged.json (engine/flatness/outputs/slope_judged.py, schema_version=1)
// 셀별 판정 결과 전용 산출물. slope_cells.json(기하)에는 이 값들이 없다(브리프 D1) -
// 재판정 때마다 다시 계산되는 파생값이라 입력 파일에 같이 담으면 이중 진실이 되기
// 때문이다. 화면은 반드시 (cx, cy) 키로 두 파일을 조인해야 한다(lib/domain/
// slope-judged.ts joinSlopeCells) - 배열 순서가 같다는 가정에 기대면 안 된다.
export interface SlopeJudgedRow {
  cx: number; cy: number; grade: SlopeGrade; reason: string;
  dev_pct: number | null; dir_err_deg: number | null; correction_mm: number | null;
}

export interface SlopeJudgedFile {
  schema_version: number; direction_judged: boolean; cells: SlopeJudgedRow[];
}

// ---- 재판정 상태 (analyses.params, 스펙 §3.5 + 마이그레이션 009 계약 - 브리프 D4/D5/D8)
export type JudgeState = 'queued' | 'processing' | 'done' | 'failed';

export interface DrainPoint { x: number; y: number; }

export interface JudgeInfo {
  state: JudgeState; at: string;
  // 대시보드 계약(009 주석): state==='failed'일 때만 사용자에게 노출한다.
  // state==='queued'일 때도 남아 있을 수 있으나(재큐 중인 재시도의 직전 실패
  // 사유) 최종 실패가 아니므로 화면에 실패로 보이면 안 된다.
  error?: string;
  previous_drain_points?: DrainPoint[] | null;
}

export interface SlopeParams {
  drain_points?: DrainPoint[];
  judge?: JudgeInfo;
}

// ---- 보고서 (001_schema.sql reports + 004_report_support.sql) ----
export type ReportStatus = 'draft' | 'finalized';
export type ReportGenStatus = 'queued' | 'processing' | 'done' | 'failed';

export interface ReportRow {
  id: string; location_id: string; title: string; status: ReportStatus;
  snapshot: Record<string, unknown> | null; opinion_text: string | null;
  pdf_path: string | null; gen_status: ReportGenStatus; gen_error: string | null;
  deleted_at: string | null;
  created_by: string | null; created_at: string;
}

export interface ReportAnalysisRow {
  report_id: string; analysis_id: string; sort_order: number;
}
