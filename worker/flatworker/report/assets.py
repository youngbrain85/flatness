"""보고서 자산 복사·생성 (스펙 §6.1 reports·§8 ④).

발행 시 참조 이미지(히트맵·3D 프리뷰·현장 사진)를 reports/{report_id}/assets/로
복사하고, 엔진 산출물에 없는 히스토그램은 여기서 생성한다. snapshot은 이 복사본
경로만 참조하므로 원본 분석이 삭제돼도 PDF가 재현된다.

경로 계약: 반환하는 모든 경로는 버킷-상대 문자열(`reports/{id}/assets/...`)이며,
실제 파일은 Storage 객체다 — 엔진/matplotlib이 로컬 Path에만 쓸 수 있으므로 잡
처리 동안만 스테이징 디렉터리(work_dir)에 모았다가 한 번에 업로드한다.
"""
import re
from contextlib import ExitStack
from pathlib import Path

# 부수효과 import: matplotlib Agg 백엔드·플랫폼별 한글 폰트 설정을 엔진 모듈이 이미
# 하고 있으므로 그대로 재사용한다(engine/flatness/outputs/preview3d.py와 동일 관례).
from flatness.outputs import heatmap as _engine_heatmap  # noqa: F401
import matplotlib.pyplot as plt
import numpy as np

from flatworker.artifacts import staging_dir
from flatworker.report.context import analysis_kind


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


def _fetch_if_exists(storage, key, dst):
    blob = storage.download(key)
    if blob is None:
        return False
    dst.write_bytes(blob)
    return True


def _copy_slope_assets(storage, report_id, bundle, dst_dir, notes):
    """구배 산출물 복사 - 과업지시서 11·12쪽이 요구한 PNG(시각자료)를 박제한다.

    평활도 전용 자산(판정 히트맵·정밀 편차맵·3D 프리뷰·셀 편차 히스토그램)은
    구배 분석에 애초에 존재하지 않는다. 빈 목록을 그대로 두고 notes도 남기지
    않는다 - "파일이 없어 제외했다"는 안내는 없는 것이 정상인 자산에 대해서는
    거짓 경보이고, 보고서를 받는 사람에게 산출 실패로 읽힌다.

    구배 히스토그램은 만들지 않는다(계획서 "범위 밖") - 평활도의 편차 히스토그램은
    mm 편차 분포지만 구배는 %p 편차라 축과 임계선의 의미가 달라 별도 판단이 필요하다.
    """
    analysis_id = str(bundle.analysis["id"])
    # stats.artifacts.map_png은 이미 버킷-상대 전체 경로다(flatworker/slope.py의
    # normalize_slope_stats) - artifacts_dir와 다시 합치면 경로가 중복된다.
    src = ((bundle.stats.get("artifacts") or {}).get("map_png")
           or f"{bundle.analysis['artifacts_dir']}/slope_map.png")
    slope_map = None
    if _fetch_if_exists(storage, src, dst_dir / "slope_map.png"):
        slope_map = assets_rel(report_id, analysis_id, "slope_map.png")
    else:
        notes.append(f"분석 {analysis_id}: 구배 판정 지도(slope_map.png) 파일이 없어 "
                     "보고서에서 제외했습니다.")
    return {"heatmaps": [], "deviation": [], "preview3d": [], "histogram": None,
            "slope_map": slope_map}


def _copy_analysis_assets(storage, report_id, bundle, assets_root, notes):
    analysis_id = str(bundle.analysis["id"])
    src_prefix = bundle.analysis["artifacts_dir"]
    dst_dir = assets_root / analysis_id
    dst_dir.mkdir(parents=True, exist_ok=True)
    stats = bundle.stats
    if analysis_kind(bundle.analysis) == "slope":
        return _copy_slope_assets(storage, report_id, bundle, dst_dir, notes)
    is_wall = stats.get("meta", {}).get("surface") == "wall"

    heatmaps = []
    if is_wall:
        # 벽 히트맵은 wall_id 채번에 결번이 있다(스킵된 벽) — 파일 존재를 가정하지 않는다
        for wall in (stats.get("walls") or []):
            name = f"heatmap_wall{wall['wall_id']}.png"
            if _fetch_if_exists(storage, f"{src_prefix}/{name}", dst_dir / name):
                heatmaps.append({"label": f"벽 {wall['wall_id']} 판정 히트맵",
                                 "path": assets_rel(report_id, analysis_id, name)})
            else:
                notes.append(f"분석 {analysis_id}: 벽 {wall['wall_id']} 히트맵 파일이 없어 "
                             "보고서에서 제외했습니다.")
    else:
        if _fetch_if_exists(storage, f"{src_prefix}/heatmap.png", dst_dir / "heatmap.png"):
            heatmaps.append({"label": "판정 히트맵",
                             "path": assets_rel(report_id, analysis_id, "heatmap.png")})
        else:
            notes.append(f"분석 {analysis_id}: 히트맵 파일이 없어 보고서에서 제외했습니다.")

    deviation = []
    for name in (stats.get("deviation_paths") or []):
        if _fetch_if_exists(storage, f"{src_prefix}/{name}", dst_dir / name):
            deviation.append({"label": deviation_label(name),
                              "path": assets_rel(report_id, analysis_id, name)})
        else:
            notes.append(f"분석 {analysis_id}: 정밀 편차맵 {name} 파일이 없어 "
                         "보고서에서 제외했습니다.")

    preview3d = []
    for name in (stats.get("preview3d_paths") or []):
        label = "3D 프리뷰(전체)" if name == "preview3d.png" else "3D 프리뷰(최대 결함 확대)"
        if _fetch_if_exists(storage, f"{src_prefix}/{name}", dst_dir / name):
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


def build_assets(db, storage, report_id, ctx, work_dir=None):
    """보고서 자산 일체를 복사·생성하고 snapshot의 assets 인자 형태로 반환한다.

    `work_dir`가 주어지면 그 아래 assets/에 쓰고 업로드까지 한다(호출자가 PDF 렌더에
    같은 디렉터리를 쓴다). None이면 임시 디렉터리를 만들어 업로드 후 폐기한다.
    """
    with ExitStack() as stack:
        if work_dir is None:
            work_dir = stack.enter_context(staging_dir())
        assets_root = Path(work_dir) / "assets"
        assets_root.mkdir(parents=True, exist_ok=True)

        notes = []
        per_analysis = {}
        for bundle in ctx.bundles:
            per_analysis[str(bundle.analysis["id"])] = _copy_analysis_assets(
                storage, report_id, bundle, assets_root, notes)
        photos = _copy_photos(db, report_id, ctx.photos, assets_root, notes)
        # 스테이징이 항상 새 디렉터리라 로컬 rmtree는 필요 없다. 재생성 시 이전 자산
        # 잔재가 저장소에 남지 않도록 원격 접두만 지우고 새로 올린다.
        storage.delete_prefix(f"reports/{report_id}/assets")
        storage.upload_dir(f"reports/{report_id}/assets", assets_root)
        return {"analyses": per_analysis, "photos": photos, "notes": notes}
