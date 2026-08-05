// DB 행(001_schema.sql)과 stats.json(docs/contracts/stats-schema.md) 타입 정본
export type Surface = 'floor' | 'wall';
export type Grade = 'pass' | 'borderline' | 'repair' | 'rework' | 'na';
export type Verdict = 'pass' | 'borderline' | 'repair' | 'rework';
export type ScanStatus = 'uploaded' | 'awaiting_unit_confirm' | 'ready' | 'archived' | 'failed';
export type AnalysisStatus = 'queued' | 'processing' | 'done' | 'failed';
// 011_register_enums.sql이 data_lineage에 'registered'를 더했다(설계 결정 F9).
// 정합 병합으로 만들어진 스캔의 계보이며 **시스템만 쓴다** - 업로드 화면의 선택지에는
// 넣지 않는다(components/upload-form.tsx는 세 값을 명시적으로 나열한다).
// fused_mesh를 재사용하면 업로드 화면이 그 값에 붙인 "앱이 스무딩한 데이터" 경고가
// 거짓이 된다 - 정합 병합은 원시 점군 두 개의 서브셀 중앙값이다.
export type Lineage = 'raw' | 'fused_mesh' | 'unknown' | 'registered';
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
  // 010_scan_height_view.sql. precheck 잡이 남기는 높이 뷰 PNG의 버킷-상대 "전체"
  // 경로다(artifacts/scans/{scan_id}/height_view.png) - artifacts_dir 같은 디렉터리
  // 조각이 아니므로 소비할 때 dataUrl()에 그대로 넘긴다(artifactUrl 금지).
  // nullable인 이유는 두 가지다: (1) precheck를 돈 적이 없는 스캔(임포트 등),
  // (2) 렌더·업로드가 실패한 경우(worker/flatworker/jobs.py의 handle_precheck가
  // except로 삼키고 상태 승격만 진행한다 - 흔적은 `[flatworker] 높이 뷰 생성 실패`
  // 로그 한 줄뿐이다).
  // "점이 성기면 워커가 렌더를 건너뛴다"는 더 이상 사실이 아니다 - Task 2 리뷰에서
  // 그 스킵 분기가 제거됐다(components/unit-confirm-form.tsx의 같은 설명 참고).
  // 전부-NaN 그림이어도 축 눈금은 진짜 bbox 값이라 단위 질문의 답이 나오기 때문에,
  // 성긴 스캔은 이제 "그림 없음"이 아니라 "거의 빈 그림 + 빨간 경고"로 온다.
  height_view_path: string | null;
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

// ---- 정합 (007_slope_analysis.sql registrations + 012_register_support.sql) ----
// status는 registration_status **enum**이다(text가 아니다). 007이 만든 다섯 값이
// 단계 F가 쓰는 상태와 정확히 일치한다.
export type RegistrationStatus = 'awaiting_points' | 'queued' | 'processing' | 'done' | 'failed';

/** 대응점 한 쌍. a = source_scan_ids[0], b = [1]이며 값은 **각 스캔 파일 단위의
 * 월드 좌표**다(설계 결정 F7). 워커(registration.align_sources)가 각 소스의
 * unit_scale을 곱해 미터로 맞추므로 화면이 미리 미터로 바꾸면 두 번 곱해진다. */
export interface Correspondence {
  a: { x: number; y: number; z: number };
  b: { x: number; y: number; z: number };
}

export interface RegistrationRow {
  id: string;
  /** [기준 스캔, 맞출 스캔]. 배열이라 FK가 없어 죽은 id가 남을 수 있다(007 주석). */
  source_scan_ids: string[];
  correspondences: Correspondence[];
  /** 4x4 동차 변환(B를 A에 맞춘다). 단위는 **미터**다. */
  transform: number[][] | null;
  rmse_mm: number | null;
  iterations: number | null;
  /** ★ 참 중첩이 아니다 - trim_ratio(0.8)가 상한이다(스펙 §9.3.4).
   *  화면에 쓰려면 lib/domain/registration.ts의 trueOverlapPct를 거쳐야 한다. */
  overlap_ratio: number | null;
  /** 수평 오정합을 **검출할 수 있는 정도**(엔진 감도 프로브). 정합을 ±10cm 수평으로
   *  밀었을 때 point-to-plane 잔차가 오르는 비의 최솟값이다. 1.0에 가까우면 이 장면은
   *  수평 방향으로 검증 불가다 - 몇 미터가 어긋나도 잔차가 그대로라 rmse_mm이 안전을
   *  보장하지 못한다(스펙 §9.3.2).
   *
   *  null인 경우가 정상 경로에 둘 있다: (1) 감도 프로브 이전에 만들어진 정합 이력,
   *  (2) 마이그레이션 012의 이 컬럼을 아직 적용하지 않은 DB(select('*')에 컬럼 자체가
   *  없어 undefined로 온다). 둘 다 "알 수 없음"이지 "위험함"이 아니므로 화면은
   *  조용히 넘어간다(lib/domain/registration.ts isHorizontalUnverifiable). */
  horizontal_sensitivity: number | null;
  status: RegistrationStatus;
  /** 실패 사유. jobs 테이블은 RLS 정책이 0개라(설계 결정 F10) 여기가 유일한 통로다. */
  error_text: string | null;
  result_scan_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}
