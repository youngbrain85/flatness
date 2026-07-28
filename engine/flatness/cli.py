"""CLI — 단위 자동 확정 금지: --units 없으면 감지 결과를 보여주고 exit 2 (스펙 §5.1.1)."""
import argparse
import sys
from pathlib import Path
from flatness.criteria import load_criteria
from flatness.io.reader import read_info
from flatness.io.units import detect_units

_SCALES = {"m": 1.0, "cm": 0.01, "mm": 0.001}


def main(argv=None):
    p = argparse.ArgumentParser(prog="flatness")
    sub = p.add_subparsers(dest="cmd", required=True)
    a = sub.add_parser("analyze", help="바닥 평활도 분석")
    a.add_argument("file", type=Path)
    a.add_argument("--out", type=Path, required=True)
    a.add_argument("--units", choices=sorted(_SCALES))
    a.add_argument("--criteria", default="floor-kcs-exposed")
    a.add_argument("--uncertainty-mm", type=float, default=None)
    sub.add_parser("list-criteria", help="탑재된 판정 기준 목록")
    ic = sub.add_parser("import-colab", help="기존 Colab 결과 CSV 임포트")
    ic.add_argument("file", type=Path)
    ic.add_argument("--out", type=Path, required=True)
    ic.add_argument("--criteria", default="floor-kcs-exposed")
    ic.add_argument("--uncertainty-mm", type=float, default=5.0)
    args = p.parse_args(argv)

    crits = load_criteria()
    if args.cmd == "list-criteria":
        for c in crits.values():
            span = f"{c.span_m}m당" if c.span_m else "높이당"
            print(f"{c.name:26s} {c.surface:5s} {span} {c.pass_mm}mm  ({c.source})")
        return 0

    if args.cmd == "import-colab":
        crit = crits.get(args.criteria)
        if crit is None or crit.metric != "flatness":
            print(f"오류: 알 수 없는 기준 '{args.criteria}': flatness list-criteria 참고")
            return 1
        from flatness.importer.colab_csv import import_colab_csv
        try:
            stats = import_colab_csv(args.file, crit, args.uncertainty_mm, args.out)
        except (ValueError, OSError) as e:
            print(f"임포트 실패: {e}")
            return 1
        gc = stats["grade_counts"]
        print(f"외부 결과 임포트 완료: 셀 {stats['n_cells']}개 (유효 {stats['n_valid']})")
        print(f"  적합 {gc['pass']} / 경계 {gc['borderline']} / 보수 {gc['repair']}"
              f" / 재시공 {gc['rework']} / 판정불가 {gc['na']}")
        print(f"  산출물: {args.out}")
        return 0

    if args.criteria not in crits:
        print(f"오류: 알 수 없는 기준 '{args.criteria}': flatness list-criteria 참고")
        return 1
    crit = crits[args.criteria]
    if crit.metric == "plumbness":
        print("오류: 수직도는 자동 병행 판정: flatness 기준을 선택하세요 (flatness list-criteria)")
        return 1
    u_mm = args.uncertainty_mm if args.uncertainty_mm is not None else (8.0 if crit.surface == "wall" else 5.0)

    if args.units is None:
        info = read_info(args.file)
        print("단위가 지정되지 않았습니다. 감지 결과(자동 확정하지 않음):")
        for g in detect_units(info):
            print(f"  --units {g.unit:2s} (scale={g.scale_to_m}) [{g.confidence}] {g.evidence}")
        print("위 후보 중 하나를 --units 로 명시해 다시 실행하세요.")
        return 2

    from flatness.core.pipeline import analyze_floor, analyze_wall
    try:
        if crit.surface == "wall":
            stats = analyze_wall(args.file, _SCALES[args.units], crit, u_mm, args.out)
        else:
            stats = analyze_floor(args.file, _SCALES[args.units], crit, u_mm, args.out)
    except ValueError as e:
        print(f"분석 실패: {e}")
        return 1
    gc = stats["grade_counts"]
    print(f"분석 완료: 셀 {stats['n_cells']}개 (유효 {stats['n_valid']})")
    print(f"  적합 {gc['pass']} / 경계 {gc['borderline']} / 보수 {gc['repair']}"
          f" / 재시공 {gc['rework']} / 판정불가 {gc['na']}")
    zs = stats.get("zones", [])
    if zs:
        n_ghost = sum(1 for z in zs if z["status"] == "ghost")
        n_furn = sum(1 for z in zs if z["status"] == "furniture")
        print(f"  구역 {len(zs)}개 (제외: 유령 {n_ghost}, 가구 {n_furn})  바닥 인식률 {stats['coverage_pct']}%")
    for wnfo in stats.get("walls", []):
        print(f"  벽 {wnfo['wall_id']}: 길이 {wnfo['length_m']}m 높이 {wnfo['height_m']}m"
              f"  수직도 {wnfo['plumbness_mm']}mm ({wnfo['plumb_grade']})")
    if "ghost_layer_rescan" in stats.get("warnings", []):
        # cp949 콘솔 호환을 위해 특수기호 대신 텍스트 사용
        print("  주의: 이중 표면(유령층) 감지, 해당 지역 판정 불가. 재스캔 권장")
    if stats["worst"] is not None:
        print(f"  최대 {stats['value_max_mm']}mm @ ({stats['worst']['point_x']:.2f},"
              f" {stats['worst']['point_y']:.2f})  기준 {stats['applied_criteria']['name']}"
              f" (U={stats['applied_criteria']['u_mm']}mm)")
    print(f"  ※ 본 결과는 스크리닝이며 공식 검측(실물 직선자·레벨)을 대체하지 않습니다.")
    print(f"  산출물: {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
