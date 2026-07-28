import numpy as np
from flatness.importer.colab_csv import import_colab_csv
from flatness.criteria import load_criteria
import pytest

CRIT = load_criteria()["floor-kcs-exposed"]

def _write_csv(path, pts, signed_mm):
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write("X,Y,Z,Distance_mm,Signed_Distance_mm,R,G,B,Is_Uneven\n")
        for (x, y, z), s in zip(pts, signed_mm):
            f.write(f"{x},{y},{z},{abs(s)},{s},0,128,0,False\n")

def test_import_detects_depression(tmp_path):
    from tests.fixtures.synthetic import flat_floor
    pts = flat_floor(size=(6.0, 6.0), spacing=0.02)
    r = np.hypot(pts[:, 0] - 2.0, pts[:, 1] - 2.0)
    signed = np.where(r < 0.3, -10.0 * 0.5 * (1.0 + np.cos(np.pi * r / 0.3)), 0.0)
    _write_csv(tmp_path / "colab.csv", pts, signed)
    stats = import_colab_csv(tmp_path / "colab.csv", CRIT, 5.0, tmp_path / "out")
    assert 9.0 <= stats["worst"]["value_mm"] <= 11.0
    assert abs(stats["worst"]["point_x"] - 2.0) < 1.0
    assert stats["meta"]["engine_version"] == "external-colab-v1"
    assert stats["meta"]["source"] == "colab-import"
    assert (tmp_path / "out" / "heatmap.png").exists()
    assert "auto_summary" in stats

def test_import_rejects_wrong_schema(tmp_path):
    (tmp_path / "bad.csv").write_text("a,b,c\n1,2,3\n", encoding="utf-8")
    with pytest.raises(ValueError, match="Colab CSV"):
        import_colab_csv(tmp_path / "bad.csv", CRIT, 5.0, tmp_path / "out")

def test_import_cli(tmp_path):
    from tests.fixtures.synthetic import flat_floor
    from tests.test_cli import _run
    pts = flat_floor(size=(3.0, 3.0), spacing=0.02)
    _write_csv(tmp_path / "colab.csv", pts, np.zeros(len(pts)))
    r = _run("import-colab", str(tmp_path / "colab.csv"), "--out", str(tmp_path / "out"))
    assert r.returncode == 0, r.stderr
    assert "외부 결과" in r.stdout
