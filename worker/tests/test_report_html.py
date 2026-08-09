"""snapshot -> HTML 렌더 — 스펙 §8의 5부 구성과 필수 문구를 검증한다."""
import json

from flatworker.config import Config
from flatworker.report.assets import build_assets
from flatworker.report.context import load_report_context
from flatworker.report.html import asset_src, fmt_mm, render_html, section_analyses
from flatworker.report.snapshot import build_snapshot
from flatworker.storage import LocalStorage
from tests.fake_db import FakeDB
from tests.test_report_snapshot import _seed, _seed_slope


def _cfg(tmp_path):
    return Config(supabase_url="http://fake", service_role_key="k",
                  data_dir=tmp_path / "data", poll_interval_s=0.01, worker_id="w1")


def _storage(tmp_path):
    return LocalStorage(tmp_path / "data")


def _snapshot(tmp_path):
    db, cfg = FakeDB(), _cfg(tmp_path)
    _seed(db, cfg)
    artifacts = cfg.data_dir / "artifacts" / "an1"
    for name in ("heatmap.png", "preview3d.png"):
        (artifacts / name).write_bytes(b"\x89PNG-fake")
    storage = _storage(tmp_path)
    ctx = load_report_context(db, storage, "r1")
    return build_snapshot(ctx, build_assets(db, storage, "r1", ctx))


def test_fmt_mm_matches_dashboard_fmt():
    assert fmt_mm(None) == "-"
    assert fmt_mm(8.2) == "8.20"


def test_asset_src_strips_report_prefix():
    assert asset_src("reports/r1/assets/an1/heatmap.png", "r1") == "assets/an1/heatmap.png"
    assert asset_src("assets/an1/heatmap.png", "r1") == "assets/an1/heatmap.png"


def test_render_html_contains_five_parts(tmp_path):
    html = render_html(_snapshot(tmp_path))
    for heading in ("1. 기본 정보", "2. 분석 개요", "3. 구간별 결과",
                    "4. 시각자료", "5. 종합의견"):
        assert heading in html, heading


def test_render_html_includes_required_content(tmp_path):
    html = render_html(_snapshot(tmp_path))
    assert "대체하지 않습니다" in html                 # 스크리닝 한계 문구(필수)
    assert "측정 불확도" in html                       # 분석 개요 고지
    assert "3층 거실 평활도 보고서" in html            # 표지 제목
    assert "홍길동" in html and "iPhone 15 Pro" in html  # 담당자·장비
    assert "floor-kcs-exposed" in html                 # 적용 기준 명시
    assert "구역 1" in html                            # 구간별 결과표
    assert "8.20" in html                              # mm 필터 적용 수치
    assert "src=\"assets/an1/heatmap.png\"" in html     # 상대 경로 자산 참조
    assert "src=\"assets/an1/histogram.png\"" in html
    assert "src=\"assets/photos/p1.jpg\"" in html
    assert "#c5221f" in html                           # palette 색상 사용


def test_render_html_has_no_em_dash_and_escapes_title(tmp_path):
    snap = _snapshot(tmp_path)
    snap["report"]["title"] = "<script>alert(1)</script>"
    html = render_html(snap)
    assert "—" not in html            # 사용자 대면 문자열 U+2014 금지
    assert "<script>alert(1)</script>" not in html   # autoescape 동작 확인
    assert "&lt;script&gt;" in html


def _snapshot_with_deviation(tmp_path):
    db, cfg = FakeDB(), _cfg(tmp_path)
    _seed(db, cfg)
    db.analyses["an1"]["stats"]["deviation_paths"] = ["deviation.png"]
    artifacts = cfg.data_dir / "artifacts" / "an1"
    for name in ("heatmap.png", "preview3d.png", "deviation.png"):
        (artifacts / name).write_bytes(b"\x89PNG-fake")
    storage = _storage(tmp_path)
    ctx = load_report_context(db, storage, "r1")
    return build_snapshot(ctx, build_assets(db, storage, "r1", ctx))


def test_render_html_includes_deviation_figure(tmp_path):
    html = render_html(_snapshot_with_deviation(tmp_path))
    assert "src=\"assets/an1/deviation.png\"" in html
    assert "정밀 편차맵(10cm)" in html
    # 판정 무관 고지: 스펙이 요구한 문구 두 절을 모두 담아야 한다(대시보드 탭과 동일 취지).
    # 편차맵의 초록은 "침하", 판정 히트맵의 초록은 "적합"이라 색 의미가 반대다 - 등급 기준이
    # 1m 판정 셀임을 함께 알려야 오독을 막는다.
    assert "판정 등급 산출에는 사용되지 않으며" in html
    assert "1m 판정 셀" in html
    assert "—" not in html                                  # 사용자 대면 문자열 U+2014 금지


def test_slope_analysis_is_not_rendered_as_a_flatness_section(tmp_path):
    """구배 분석은 scans.surface가 'floor'라 걸러내지 않으면 '3.1 수평면(바닥)'에
    섞인다 - 구간·레벨·mm 편차가 전부 없어 머리글만 있는 빈 표가 박힌다.

    구배 셀 결과는 같은 §3의 별도 절('3.3 바닥 구배')이 맡는다 - 평활도 구간표
    목록(section_analyses)에는 여전히 들어오지 않는다.
    """
    db, cfg = FakeDB(), _cfg(tmp_path)
    _seed(db, cfg)
    _seed_slope(db, cfg)
    artifacts = cfg.data_dir / "artifacts" / "an1"
    for name in ("heatmap.png", "preview3d.png"):
        (artifacts / name).write_bytes(b"\x89PNG-fake")
    storage = _storage(tmp_path)
    ctx = load_report_context(db, storage, "r1")
    snap = build_snapshot(ctx, build_assets(db, storage, "r1", ctx))

    assert len(snap["analyses"]) == 2, "픽스처 확인: 평활도 + 구배 두 건이어야 한다"
    assert [a["analysis_id"] for a in section_analyses(snap["analyses"], "floor")] == ["an1"]
    assert section_analyses(snap["analyses"], "wall") == []

    html = render_html(snap)
    body = html[html.index("3. 구간별 결과"):html.index("4. 시각자료")]
    # 구배 기준이 '3.1 수평면(바닥)' 표에 새면 안 된다(구배 전용 절은 3.3이다)
    floor_table = body[body.index("3.1 수평면(바닥)"):body.index("3.3 바닥 구배")]
    assert "slope-parking-ramp" not in floor_table
    assert "구역 1" in floor_table               # 평활도 구간표는 그대로다
    # 표지 측정 개요에는 실리되 평활도와 문구로 구별된다(둘 다 같은 바닥 스캔이다)
    assert "slope-parking-ramp" in html and "바닥 구배" in html


# ---------------------------------------------------------------- 구배 장(단계 H)
#
# 구배는 별도 장 번호를 만들지 않고 기존 5부 구성 안에 들어간다:
#   §2 분석 개요   -> 개요·판정 요약(산출 항목 5개)·등급 분포·경고
#   §3 구간별 결과 -> '3.3 바닥 구배' 셀별 표
#   §4 시각자료    -> slope_map.png + 배수구 위치
# 그래야 구배만 담긴 보고서에서 §2·§3이 머리글만 남은 빈 장이 되지 않는다.

def _slope_db(tmp_path):
    """평활도(an1) + 구배(an2)가 함께 담긴 보고서 r1. 자산 원본까지 만들어 둔다."""
    db, cfg = FakeDB(), _cfg(tmp_path)
    _seed(db, cfg)
    _seed_slope(db, cfg)
    artifacts = cfg.data_dir / "artifacts" / "an1"
    for name in ("heatmap.png", "preview3d.png"):
        (artifacts / name).write_bytes(b"\x89PNG-fake")
    return db, cfg


def _drop_flatness(db):
    """구배 분석만 담긴 보고서로 만든다(세부과업 4의 실제 사용 형태)."""
    db.report_analyses[:] = [r for r in db.report_analyses if r["analysis_id"] == "an2"]


def _render(tmp_path, db):
    storage = _storage(tmp_path)
    ctx = load_report_context(db, storage, "r1")
    return render_html(build_snapshot(ctx, build_assets(db, storage, "r1", ctx)))


def _between(html, start, end):
    """장 사이 구간만 잘라낸다 - '어딘가에는 있다'가 아니라 '그 장에 있다'를 본다."""
    assert start in html and end in html, (start, end)
    return html[html.index(start):html.index(end)]


def test_slope_chapter_renders_design_and_deviation_table(tmp_path):
    """★ 과업지시서 11쪽 산출 항목 5개가 표에 있다.

    원문: "산출 항목 : 구배값(%), 설계기준 대비 편차, 평균편차, 표준편차,
    최대편차 자동 계산". 하나라도 빠지면 PDF가 과업지시서를 못 채운다.
    """
    db, _ = _slope_db(tmp_path)
    html = _render(tmp_path, db)
    overview = _between(html, "2. 분석 개요", "3. 구간별 결과")
    cells = _between(html, "3.3 바닥 구배", "4. 시각자료")

    # 머리글(과업지시서 원문 어휘)
    assert "평균편차(%)" in overview and "표준편차(%)" in overview
    assert "최대편차(%)" in overview and "설계 구배(%)" in overview
    assert "구배값(%)" in cells and "설계기준 대비 편차(%)" in cells

    # 값 - 머리글만 있고 수치가 없으면 표가 아니다
    assert ">1.5<" in overview        # 설계 구배
    assert ">0.46<" in overview       # 평균편차
    assert ">0.65<" in overview       # 표준편차
    assert ">1.7<" in overview        # 최대편차
    assert ">1.35<" in cells and ">3.2<" in cells       # 셀별 구배값(%)
    assert ">0.15<" in cells and ">1.7<" in cells       # 셀별 설계기준 대비 편차(%)

    # 장 번호는 그대로다(구배를 넣느라 5부 구성을 밀지 않았다)
    for heading in ("1. 기본 정보", "2. 분석 개요", "3. 구간별 결과",
                    "4. 시각자료", "5. 종합의견"):
        assert heading in html, heading
    assert "—" not in html            # 사용자 대면 문자열 U+2014 금지


def test_slope_chapter_shows_map_png_and_drain_points(tmp_path):
    """과업지시서가 PNG(시각자료)를 산출 형식으로 명시했다. 배수구 위치가 없으면
    지도의 화살표·역구배 판정을 읽을 기준이 사라진다."""
    db, _ = _slope_db(tmp_path)
    html = _render(tmp_path, db)
    visuals = _between(html, "4. 시각자료", "5. 종합의견")

    assert 'src="assets/an2/slope_map.png"' in visuals
    assert "배수구" in visuals
    assert "(3.20, 5.10)" in visuals          # stats.drain_points [[3.2, 5.1]]
    # 개요에도 배수구 좌표를 남긴다 - 지도 파일이 빠져도 판정 기준은 보고서에 남아야 한다
    assert "(3.20, 5.10)" in _between(html, "2. 분석 개요", "3. 구간별 결과")


def test_reverse_cells_are_visually_distinct_in_the_table(tmp_path):
    """★ 스펙 §7.2: 역구배는 색만으로 구별하면 안 된다. 표의 문구로 구별된다."""
    db, _ = _slope_db(tmp_path)
    cells = _between(_render(tmp_path, db), "3.3 바닥 구배", "4. 시각자료")

    rows = [r for r in cells.split("<tr>") if "역구배" in r]
    assert len(rows) == 1, "역구배 셀 행이 정확히 하나여야 한다(픽스처 (0,1))"
    reverse_row = rows[0]
    assert "재시공" in reverse_row and "(역구배)" in reverse_row   # 등급 칸의 문구 표시
    assert "역구배 - 방향 전면 재시공 필요(크기 보정으로 해결 안 됨)" in reverse_row
    # 크기 문구를 냈다면 correction_mm=0.04라 "서쪽 끝을 0.0mm 높임"이 된다
    assert "높임" not in reverse_row and "낮춤" not in reverse_row

    # 역구배가 아닌 셀은 여전히 크기 문구를 낸다(보정란을 통째로 비우는 변이 차단)
    assert "북쪽 끝을 3.0mm 낮춤" in cells
    assert "동쪽 끝을 34.0mm 높임" in cells
    # 역구배는 아니지만 방향 편차가 허용을 넘은 셀도 문구로 드러난다
    assert "45.0도(허용 30도 초과)" in cells


def test_slope_chapter_accounts_for_cells_left_out_of_the_table(tmp_path):
    """표에서 뺀 적합·경계 셀이 '없던 일'이 되면 안 된다 - 전수 집계가 함께 실린다."""
    db, _ = _slope_db(tmp_path)
    html = _render(tmp_path, db)
    overview = _between(html, "2. 분석 개요", "3. 구간별 결과")
    cells = _between(html, "3.3 바닥 구배", "4. 시각자료")

    # 등급 분포는 5등급 전수(적합 1 · 경계 1 · 보수 1 · 재시공 2 · 판정불가 1)
    for grade in ("적합", "경계", "보수", "재시공", "판정불가"):
        assert grade in overview, grade
    assert "판정 가능 비율" in overview and "83.3%" in overview
    # 표가 조치 대상만 담았다는 사실과 그 분모를 밝힌다
    assert "전체 6셀 중 4셀" in cells


def test_slope_chapter_states_direction_was_not_judged_without_drain(tmp_path):
    """배수구를 지정하지 않으면 역구배 판정 자체를 하지 않는다 - '적합'이 크기만
    본 결과라는 사실을 보고서가 밝히지 않으면 오독을 부른다."""
    db, cfg = _slope_db(tmp_path)
    stats = db.analyses["an2"]["stats"]
    stats["direction_judged"] = False
    stats["drain_points"] = []
    judged_path = cfg.data_dir / "artifacts" / "an2" / "slope_judged.json"
    judged = json.loads(judged_path.read_text(encoding="utf-8"))
    judged["direction_judged"] = False
    judged_path.write_text(json.dumps(judged, ensure_ascii=False), encoding="utf-8")

    overview = _between(_render(tmp_path, db), "2. 분석 개요", "3. 구간별 결과")

    assert "방향(역구배)은 판정하지 않았습니다" in overview
    assert "지정되지 않음" in overview        # 배수구 칸을 빈칸으로 두지 않는다


def test_slope_chapter_without_action_cells_has_no_header_only_table(tmp_path):
    """조치 대상 셀이 하나도 없으면 머리글만 있는 빈 표가 박제된다 - 문장으로 낸다."""
    db, cfg = _slope_db(tmp_path)
    judged_path = cfg.data_dir / "artifacts" / "an2" / "slope_judged.json"
    judged = json.loads(judged_path.read_text(encoding="utf-8"))
    for row in judged["cells"]:
        row["grade"], row["reason"] = "적합", "크기·방향 모두 허용 안"
    judged_path.write_text(json.dumps(judged, ensure_ascii=False), encoding="utf-8")

    cells = _between(_render(tmp_path, db), "3.3 바닥 구배", "4. 시각자료")

    assert "조치가 필요한 셀이 없습니다" in cells
    assert "구배값(%)" not in cells, "빈 표의 머리글만 남으면 안 된다"


def test_report_without_slope_analysis_has_no_empty_slope_chapter(tmp_path):
    """★ 평활도만 있는 보고서에 빈 구배 장이 박제되면 안 된다.
    단계 C 주석이 경고한 바로 그 실패다."""
    html = render_html(_snapshot(tmp_path))

    for token in ("3.3 바닥 구배", "구배값(%)", "설계 구배(%)", "역구배",
                  "배수구", "설계기준 대비 편차"):
        assert token not in html, token
    # 평활도 본문은 그대로다
    assert "3.1 수평면(바닥)" in html and "구역 1" in html
    # ★ 이 스냅샷의 평활도 항목에는 kind 키가 없다(이미 발행된 스냅샷과 같은 형태다).
    # 구배 분기를 == 'flatness'로 뒤집으면 여기가 통째로 비므로 직접 단언한다 -
    # 색·자산 같은 곁가지가 우연히 잡아 주기를 기다리지 않는다.
    overview = _between(html, "2. 분석 개요", "3. 구간별 결과")
    for token in ("바닥 인식률", "축소 스팬 적용 셀", "95퍼센타일(mm)", "등급 분포"):
        assert token in overview, token


def test_slope_only_report_leaves_no_chapter_empty(tmp_path):
    """구배만 담긴 보고서에서 §2·§3이 머리글만 남으면 안 된다 - 구배 내용을
    별도 장으로 빼지 않고 기존 장 안에 넣은 이유가 이것이다."""
    db, _ = _slope_db(tmp_path)
    _drop_flatness(db)
    html = _render(tmp_path, db)

    overview = _between(html, "2. 분석 개요", "3. 구간별 결과")
    assert "바닥 구배 분석" in overview and "판정 가능 비율" in overview
    sections = _between(html, "3. 구간별 결과", "4. 시각자료")
    assert "3.3 바닥 구배" in sections and "역구배" in sections
    assert "3.1 수평면(바닥)" not in sections and "3.2 수직면(벽면)" not in sections
    visuals = _between(html, "4. 시각자료", "5. 종합의견")
    assert 'src="assets/an2/slope_map.png"' in visuals
    # 평활도 전용 표(mm 통계·직선자 스팬)는 한 줄도 새지 않는다
    assert "직선자 스팬" not in html and "95퍼센타일" not in html
    assert "—" not in html


def test_render_html_tolerates_snapshot_without_deviation_key(tmp_path):
    """이미 발행된 보고서의 snapshot에는 assets.deviation 키가 없다 - 템플릿이 견뎌야 한다."""
    snap = _snapshot(tmp_path)
    for a in snap["analyses"]:
        a["assets"].pop("deviation", None)

    html = render_html(snap)

    assert "4. 시각자료" in html
    assert "src=\"assets/an1/heatmap.png\"" in html
