"""PLY 리더 — vertex의 x/y/z만 float32 청크로 스트리밍. 면·기타 속성은 무시."""
import numpy as np

_TYPES = {"char": "i1", "uchar": "u1", "int8": "i1", "uint8": "u1",
          "short": "i2", "ushort": "u2", "int16": "i2", "uint16": "u2",
          "int": "i4", "uint": "u4", "int32": "i4", "uint32": "u4",
          "float": "f4", "float32": "f4", "double": "f8", "float64": "f8"}


def _parse_header(f):
    if f.readline().strip() != b"ply":
        raise ValueError("PLY 매직 누락")
    fmt, n_vertex, props, in_vertex, first_elem = None, None, [], False, None
    while True:
        line = f.readline()
        if not line:
            raise ValueError("end_header 누락")
        tok = line.decode("ascii", "replace").split()
        if not tok:
            continue
        if tok[0] == "format":
            fmt = tok[1]
        elif tok[0] == "element":
            if first_elem is None:
                first_elem = tok[1]
            in_vertex = tok[1] == "vertex"
            if in_vertex:
                n_vertex = int(tok[2])
        elif tok[0] == "property" and in_vertex:
            if tok[1] == "list":
                raise ValueError("vertex list property 미지원")
            if tok[1] not in _TYPES:
                raise ValueError(f"지원하지 않는 PLY property 타입: {tok[1]}")
            props.append((tok[2], _TYPES[tok[1]]))
        elif tok[0] == "end_header":
            break
    if fmt not in ("ascii", "binary_little_endian"):
        raise ValueError(f"미지원 PLY 포맷: {fmt}")
    if n_vertex is None:
        raise ValueError("vertex element 없음")
    if first_elem != "vertex":
        raise ValueError("vertex가 첫 element가 아닌 PLY는 지원하지 않음")
    names = [p[0] for p in props]
    if not all(c in names for c in ("x", "y", "z")):
        raise ValueError("x/y/z property 없음")
    return fmt, n_vertex, props


def read_ply_chunks(path, chunk_size=2_000_000):
    with open(path, "rb") as f:
        fmt, n_vertex, props = _parse_header(f)
        if fmt == "ascii":
            cols = [i for i, p in enumerate(props) if p[0] in ("x", "y", "z")]
            order = [props[i][0] for i in cols]
            sel = [cols[order.index(c)] for c in ("x", "y", "z")]
            done, buf = 0, []
            for line in f:
                if done >= n_vertex:
                    break
                v = line.split()
                buf.append([float(v[sel[0]]), float(v[sel[1]]), float(v[sel[2]])])
                done += 1
                if len(buf) >= chunk_size:
                    yield np.asarray(buf, dtype=np.float32); buf = []
            if buf:
                yield np.asarray(buf, dtype=np.float32)
        else:
            dt = np.dtype([(p[0], "<" + p[1]) for p in props])  # 중복 property명은 유효 PLY가 아님
            done = 0
            while done < n_vertex:
                k = min(chunk_size, n_vertex - done)
                rec = np.fromfile(f, dtype=dt, count=k)
                if len(rec) < k:
                    raise ValueError("PLY 본문이 header 개수보다 짧음")
                yield np.column_stack([rec["x"], rec["y"], rec["z"]]).astype(np.float32)
                done += k
