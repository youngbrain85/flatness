"""데이터 계보(`scans.lineage`) 기반 분석 경고 — 스펙 §5.1.1.

업로드 화면(`dashboard/components/upload-form.tsx`)은 계보로 '융합 메시'를 고른
사용자에게 **"결과에 경고가 표시됩니다"** 라고 안내하고, 설계 정본 §5.1.1도
"융합 메시면 ... 경고를 결과·보고서에 표기"를 요구한다. 이 모듈이 그 경고를 만든다.

**왜 엔진이 아니라 워커인가.** 계보는 파일에서 도출되는 값이 아니라 업로드할 때
사람이 고른 DB 메타데이터다(`scans.lineage`). 자동 감지는 설계 정본에 계획만 있고
미구현이며(`docs/service-report.md` 6.5절), `docs/scan-guideline.md` §6은 사용자에게
"시스템은 융합 메시를 자동으로 감지하지 못하니 직접 선택하라"고 명시한다. 엔진은
DB를 모르고 stats의 다른 warnings는 전부 "엔진이 실제로 본 점군에서 도출한 사실"인
반면 이 경고는 그렇지 않다 — 엔진에 계보 인자를 뚫으면 CLI·임포터까지 파급되면서
그 구분마저 흐려진다. 그래서 stats 계약(`docs/contracts/stats-schema.md` §5)에
**출처가 워커인 유일한 경고 코드**로 명시해 두고 여기서 덧붙인다.

**정렬하지 않고 끝에 덧붙인다.** 평활도 warnings는 엔진이 정렬해 내지만
(`criteria.py:67`, `core/pipeline.py:96`) 구배 warnings는 **한국어 완성 문장**을
발생 순서대로 담은 리스트다(`slope.py:196-197`). 여기서 정렬하면 구배 경고의
읽는 순서가 뒤바뀐다. 워커가 나중에 덧붙인 값이라는 점에서도 맨 뒤가 자연스럽다.

원본 dict는 건드리지 않고 사본을 돌려준다(`slope.normalize_slope_stats`와 같은 관례).
"""

# 융합 메시 경고 코드. 표시 문구는 `dashboard/lib/domain/labels.ts`의 WARNING_LABEL이
# 정본이고 `report/labels.py`가 사본이다(tests/test_report_labels.py가 대조한다).
FUSED_MESH_WARNING = "fused_mesh_smoothed"


def is_fused_mesh(scan):
    """scans 행이 융합 메시 계보인가. 행이 없거나 lineage 키가 없으면 False."""
    return (scan or {}).get("lineage") == "fused_mesh"


def _appended(warnings):
    warns = list(warnings or [])
    if FUSED_MESH_WARNING not in warns:
        warns.append(FUSED_MESH_WARNING)
    return warns


def with_lineage_warning(stats, scan):
    """엔진 stats 사본에 계보 경고를 더한다(평활도·임포트 경로).

    `jobs._finalize`가 `stats`와 `warnings` 컬럼을 **같은 stats에서** 뽑으므로
    (`jobs.py:215-218`) 여기서 한 번 손보면 화면(stats.warnings)과 목록·필터
    (analyses.warnings) 양쪽이 자동으로 일치한다.
    """
    if not is_fused_mesh(scan):
        return stats
    out = dict(stats)
    out["warnings"] = _appended(stats.get("warnings"))
    return out


def fields_with_lineage_warning(fields, scan):
    """analyses 갱신 필드 dict 사본에 계보 경고를 더한다(구배 analyze·재판정 경로).

    구배는 `_finalize`를 쓰지 않고 필드 dict를 직접 만들어 저장하므로
    (`slope.run_slope_analysis` / `slope.build_slope_judge_fields`)
    `stats.warnings`와 `warnings` 컬럼을 여기서 따로 맞춘다 — 한쪽만 채우면
    결과 화면과 목록이 서로 다른 사실을 말하게 된다.
    """
    if not is_fused_mesh(scan):
        return fields
    out = dict(fields)
    out["warnings"] = _appended(fields.get("warnings"))
    if isinstance(fields.get("stats"), dict):
        out["stats"] = with_lineage_warning(fields["stats"], scan)
    return out
