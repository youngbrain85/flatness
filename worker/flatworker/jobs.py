"""잡 핸들러 3종 (precheck/analyze/import) — 스펙 §5.1.7, §5.4.

analyze/import는 실패 시 예외를 그대로 전파한다: 잡 상태 전이(재시도/최종 실패)는
runner(Task 6)가 `fail_job`으로 처리하는 책임이라 이 모듈에서 잡지 않는다.
"""
from pathlib import Path

from flatness.criteria import Criterion
from flatness.core.pipeline import analyze_floor, analyze_wall
from flatness.importer.colab_csv import import_colab_csv

from flatworker.artifacts import artifacts_dir


def _to_criterion(row):
    """criteria 테이블 행(dict) -> 엔진 Criterion. thresholds[0]에서 span/pass/rework 추출.

    criteria.thresholds는 §4.2 규약상 배열이지만(추후 다중 스팬 구간 확장 여지),
    현재 시드 데이터·엔진 모두 원소 1개만 사용한다.
    """
    t = row["thresholds"][0]
    return Criterion(name=row["name"], surface=row["surface"], metric=t["metric"],
                      span_m=t.get("span_m"), pass_mm=t["pass_mm"], rework_mm=t["rework_mm"],
                      source=row["source_text"])


def overall_verdict(stats):
    """stats -> 종합 판정. rework>0 -> repair>0 -> borderline>0 -> pass, n_valid=0 -> None."""
    if stats.get("n_valid", 0) == 0:
        return None
    gc = stats.get("grade_counts", {})
    for grade in ("rework", "repair", "borderline"):
        if gc.get(grade, 0) > 0:
            return grade
    return "pass"


def handle_precheck(db, cfg, payload):
    """scan_id의 단위 확정 여부만 확인해 상태를 승격/대기시킨다.

    원래 스펙(§5.1.1)은 read_info→detect_units로 단위 후보를 산출해 사용자에게
    보여주는 흐름이지만, 데모 스키마의 scans 테이블에는 후보를 저장할 컬럼
    (unit_candidates 등)이 없다 — 계산해도 어디에도 남길 곳이 없다. 따라서
    scans.unit_scale이 이미 확정되어 있으면(P3 UI가 업로드 단계에서 직접 설정)
    'ready'로 승격하고, 아니면 'awaiting_unit_confirm'으로 둔다.
    """
    scan_id = payload["scan_id"]
    scan = db.get_scan(scan_id)
    if scan.get("unit_scale") is not None:
        db.update_scan(scan_id, {"status": "ready"})
    else:
        db.update_scan(scan_id, {"status": "awaiting_unit_confirm"})


def _load_context(db, analysis_id):
    """analysis -> scan -> criteria 순으로 로드하고 엔진 입력을 만들어 반환."""
    analysis = db.get_analysis(analysis_id)
    scan = db.get_scan(analysis["scan_id"])
    criteria_row = db.get_criteria(analysis["criteria_id"])
    crit = _to_criterion(criteria_row)
    uncertainty = db.get_app_setting("uncertainty_mm")
    u_mm = uncertainty[scan["surface"]]
    return analysis, scan, crit, u_mm


def _finalize(db, analysis_id, scan_id, stats, out_dir):
    """엔진 stats를 analyses 행에 반영하고 해당 스캔의 현재 분석으로 지정."""
    db.update_analysis(analysis_id, {
        "status": "done",
        "stats": stats,
        "coverage_pct": stats.get("coverage_pct"),
        "overall_verdict": overall_verdict(stats),
        "warnings": stats.get("warnings", []),
        "artifacts_dir": str(out_dir),
        "engine_version": stats.get("meta", {}).get("engine_version"),
        "applied_criteria": stats.get("applied_criteria"),
        "auto_summary": stats.get("auto_summary"),
    })
    db.set_current_analysis(scan_id, analysis_id)


def handle_analyze(db, cfg, payload):
    analysis_id = payload["analysis_id"]
    analysis, scan, crit, u_mm = _load_context(db, analysis_id)
    out_dir = artifacts_dir(cfg.data_dir, analysis_id)
    path = Path(scan["raw_file_path"])
    scale_to_m = scan["unit_scale"]
    if scan["surface"] == "wall":
        stats = analyze_wall(path, scale_to_m, crit, u_mm, out_dir)
    else:
        stats = analyze_floor(path, scale_to_m, crit, u_mm, out_dir)
    _finalize(db, analysis_id, analysis["scan_id"], stats, out_dir)


def handle_import(db, cfg, payload):
    analysis_id = payload["analysis_id"]
    analysis, scan, crit, u_mm = _load_context(db, analysis_id)
    out_dir = artifacts_dir(cfg.data_dir, analysis_id)
    path = Path(scan["raw_file_path"])
    stats = import_colab_csv(path, crit, u_mm, out_dir)
    _finalize(db, analysis_id, analysis["scan_id"], stats, out_dir)
