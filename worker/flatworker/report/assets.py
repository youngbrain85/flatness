"""보고서 자산 복사·생성 (스펙 §6.1 reports·§8 ④).

발행 시 참조 이미지(히트맵·3D 프리뷰·현장 사진)를 reports/{report_id}/assets/로
복사하고, 엔진 산출물에 없는 히스토그램은 여기서 생성한다. snapshot은 이 복사본
경로만 참조하므로 원본 분석이 삭제돼도 PDF가 재현된다.

경로 계약: 반환하는 모든 경로는 버킷-상대 문자열(`reports/{id}/assets/...`)이며,
실제 파일은 cfg.data_dir 아래에 쓴다.
"""
import re
import shutil
from pathlib import Path

# 부수효과 import: matplotlib Agg 백엔드·플랫폼별 한글 폰트 설정을 엔진 모듈이 이미
# 하고 있으므로 그대로 재사용한다(engine/flatness/outputs/preview3d.py와 동일 관례).
from flatness.outputs import heatmap as _engine_heatmap  # noqa: F401
import matplotlib.pyplot as plt
import numpy as np


def report_dir(data_dir, report_id) -> Path:
    d = Path(data_dir) / "reports" / str(report_id)
    d.mkdir(parents=True, exist_ok=True)
    return d


def assets_rel(report_id, *parts) -> str:
    """버킷-상대 자산 경로 문자열 (OS 구분자에 의존하지 않도록 '/'로 조립)."""
    return "/".join(["reports", str(report_id), "assets", *[str(p) for p in parts]])


def render_histogram(values_mm, criteria, out_path):
    """셀 편차 분포 히스토그램 — 엔진 산출물이 아닌 보고서 전용 자산(스펙 §8 ④).

    허용치·재시공 임계를 세로 점선으로 겹쳐 분포와 기준의 관계를 한눈에 보이게 한다
    (부호 규약상 편차는 양·음 양쪽으로 퍼지므로 ± 양쪽에 그린다).
    """
    values = np.asarray(values_mm, dtype=float)
    bins = int(min(30, max(10, np.sqrt(values.size) + 1)))
    fig, ax = plt.subplots(figsize=(7.2, 3.0))
    ax.hist(values, bins=bins, color="#5b8def", edgecolor="white")
    for key, color in (("pass_mm", "#2e7d32"), ("rework_mm", "#c5221f")):
        limit = criteria.get(key)
        if limit is None:
            continue
        label = f"허용 {limit}mm" if key == "pass_mm" else f"재시공 {limit}mm"
        ax.axvline(limit, color=color, linestyle="--", linewidth=1.2, label=label)
        ax.axvline(-limit, color=color, linestyle="--", linewidth=1.2)
    ax.set_xlabel("셀 편차 (mm)")
    ax.set_ylabel("셀 수")
    ax.set_title("셀 편차 분포")
    ax.legend(fontsize=8)
    fig.tight_layout()
    fig.savefig(out_path, dpi=140)
    plt.close(fig)


_DEVIATION_WALL = re.compile(r"^deviation_wall(\d+)\.png$")


def deviation_label(name):
    """편차맵 파일명 -> 캡션. 벽은 결번이 있으므로 파일명의 번호를 그대로 쓴다.

    같은 문구를 대시보드 deviation-view.tsx도 쓴다(화면과 PDF의 캡션이 갈리면 안 된다).
    """
    m = _DEVIATION_WALL.match(name)
    return f"벽 {m.group(1)} 정밀 편차맵(10cm)" if m else "정밀 편차맵(10cm)"


def _copy_if_exists(src, dst):
    if not src.exists():
        return False
    shutil.copyfile(src, dst)
    return True


def _copy_analysis_assets(cfg, report_id, bundle, assets_root, notes):
    analysis_id = str(bundle.analysis["id"])
    src_dir = Path(cfg.data_dir) / bundle.analysis["artifacts_dir"]
    dst_dir = assets_root / analysis_id
    dst_dir.mkdir(parents=True, exist_ok=True)
    stats = bundle.stats
    is_wall = stats.get("meta", {}).get("surface") == "wall"

    heatmaps = []
    if is_wall:
        # 벽 히트맵은 wall_id 채번에 결번이 있다(스킵된 벽) — 파일 존재를 가정하지 않는다
        for wall in (stats.get("walls") or []):
            name = f"heatmap_wall{wall['wall_id']}.png"
            if _copy_if_exists(src_dir / name, dst_dir / name):
                heatmaps.append({"label": f"벽 {wall['wall_id']} 판정 히트맵",
                                 "path": assets_rel(report_id, analysis_id, name)})
            else:
                notes.append(f"분석 {analysis_id}: 벽 {wall['wall_id']} 히트맵 파일이 없어 "
                             "보고서에서 제외했습니다.")
    else:
        if _copy_if_exists(src_dir / "heatmap.png", dst_dir / "heatmap.png"):
            heatmaps.append({"label": "판정 히트맵",
                             "path": assets_rel(report_id, analysis_id, "heatmap.png")})
        else:
            notes.append(f"분석 {analysis_id}: 히트맵 파일이 없어 보고서에서 제외했습니다.")

    deviation = []
    for name in (stats.get("deviation_paths") or []):
        if _copy_if_exists(src_dir / name, dst_dir / name):
            deviation.append({"label": deviation_label(name),
                              "path": assets_rel(report_id, analysis_id, name)})
        else:
            notes.append(f"분석 {analysis_id}: 정밀 편차맵 {name} 파일이 없어 "
                         "보고서에서 제외했습니다.")

    preview3d = []
    for name in (stats.get("preview3d_paths") or []):
        label = "3D 프리뷰(전체)" if name == "preview3d.png" else "3D 프리뷰(최대 결함 확대)"
        if _copy_if_exists(src_dir / name, dst_dir / name):
            preview3d.append({"label": label,
                              "path": assets_rel(report_id, analysis_id, name)})
        else:
            notes.append(f"분석 {analysis_id}: 3D 프리뷰 {name} 파일이 없어 "
                         "보고서에서 제외했습니다.")

    histogram = None
    values = [c["value_mm"] for c in bundle.cells if c.get("value_mm") is not None]
    if values:
        render_histogram(values, stats.get("applied_criteria", {}), dst_dir / "histogram.png")
        histogram = assets_rel(report_id, analysis_id, "histogram.png")
    else:
        notes.append(f"분석 {analysis_id}: 유효 판정 셀이 없어 히스토그램을 생성하지 않았습니다.")

    return {"heatmaps": heatmaps, "deviation": deviation, "preview3d": preview3d,
            "histogram": histogram}


def _copy_photos(db, report_id, photos, assets_root, notes):
    if not photos:
        return []
    dst_dir = assets_root / "photos"
    dst_dir.mkdir(parents=True, exist_ok=True)
    copied = []
    for photo in photos:
        file_path = photo["file_path"]
        name = f"{photo['id']}{Path(file_path).suffix or '.jpg'}"
        try:
            blob = db.download_photo(file_path)
        except Exception as e:  # noqa: BLE001 - 사진 1건 실패로 보고서 전체를 실패시키지 않는다
            notes.append(f"사진 {photo['id']}을(를) 내려받지 못해 보고서에서 제외했습니다: {e}")
            continue
        (dst_dir / name).write_bytes(blob)
        copied.append({
            "photo_id": str(photo["id"]),
            "caption": photo.get("caption"),
            "taken_at": photo.get("taken_at"),
            "scan_id": str(photo["scan_id"]) if photo.get("scan_id") else None,
            "path": assets_rel(report_id, "photos", name),
        })
    return copied


def build_assets(db, cfg, report_id, ctx):
    """보고서 자산 일체를 복사·생성하고 snapshot의 assets 인자 형태로 반환한다."""
    assets_root = report_dir(cfg.data_dir, report_id) / "assets"
    # 재생성 시 이전 자산 잔재(제외된 분석의 히트맵 등)가 남지 않도록 통째로 지운다
    shutil.rmtree(assets_root, ignore_errors=True)
    assets_root.mkdir(parents=True, exist_ok=True)

    notes = []
    per_analysis = {}
    for bundle in ctx.bundles:
        per_analysis[str(bundle.analysis["id"])] = _copy_analysis_assets(
            cfg, report_id, bundle, assets_root, notes)
    photos = _copy_photos(db, report_id, ctx.photos, assets_root, notes)
    return {"analyses": per_analysis, "photos": photos, "notes": notes}
