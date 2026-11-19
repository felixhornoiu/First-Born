"""Download Overture Maps features for a bounding box without any cloud SDK.

Reads only the Parquet footers (HTTP range requests) of the public Overture bucket to find the
row groups that overlap the box, then fetches just those. Output: GeoJSON-like JSON lines.

    pip install pyarrow requests shapely
    python scripts/fetch-overture.py <west> <south> <east> <north> <out.jsonl> [theme/type]

theme/type defaults to buildings/building; also used: transportation/segment, base/land_use,
base/land_cover, base/water.

Data: Overture Maps Foundation (overturemaps.org), ODbL / CDLA (© OpenStreetMap contributors
and other sources).
"""
import io, json, re, sys, concurrent.futures as cf
import requests, pyarrow.parquet as pq
from shapely import wkb
from shapely.geometry import mapping

BUCKET = "https://overturemaps-us-west-2.s3.amazonaws.com"
COLS = ["id", "geometry", "bbox", "height", "num_floors", "roof_shape", "roof_height", "roof_color",
        "facade_color", "subtype", "class", "min_height", "is_underground", "names"]
session = requests.Session()


class RangeFile(io.RawIOBase):
    """Seekable read-only file over HTTP range requests, with a cached tail for the footer."""

    def __init__(self, url, size, tail=None, tail_len=1 << 20):
        self.url, self.size, self.pos = url, size, 0
        self.tail_start = max(0, size - tail_len)
        self.tail = tail if tail is not None else self._get(self.tail_start, size)

    def _get(self, a, b):
        for attempt in range(5):
            try:
                r = session.get(self.url, headers={"Range": f"bytes={a}-{b - 1}"}, timeout=120)
                r.raise_for_status()
                return r.content
            except Exception:
                if attempt == 4:
                    raise

    def readable(self): return True
    def seekable(self): return True
    def tell(self): return self.pos

    def seek(self, off, whence=0):
        self.pos = off if whence == 0 else self.pos + off if whence == 1 else self.size + off
        return self.pos

    def read(self, n=-1):
        if n < 0: n = self.size - self.pos
        a, b = self.pos, min(self.pos + n, self.size)
        data = self.tail[a - self.tail_start:b - self.tail_start] if a >= self.tail_start else self._get(a, b)
        self.pos = b
        return data

    def readinto(self, buf):
        d = self.read(len(buf)); buf[:len(d)] = d; return len(d)


def listing(prefix):
    keys, token = [], None
    while True:
        q = {"list-type": "2", "prefix": prefix}
        if token: q["continuation-token"] = token
        xml = session.get(BUCKET + "/", params=q, timeout=60).text
        keys += [(k, int(s)) for k, s in re.findall(r"<Key>([^<]+)</Key>.*?<Size>(\d+)</Size>", xml)]
        m = re.search(r"<NextContinuationToken>([^<]+)<", xml)
        if not m: return keys
        token = m.group(1)


def latest_release():
    xml = session.get(BUCKET + "/", params={"list-type": "2", "prefix": "release/", "delimiter": "/"}, timeout=60).text
    return sorted(re.findall(r"<Prefix>release/([^/<]+)/</Prefix>", xml))[-1]


def scan(key, size, box):
    w, s, e, n = box
    f = pq.ParquetFile(RangeFile(f"{BUCKET}/{key}", size))
    md, names = f.metadata, f.schema_arrow.names
    idx = {md.row_group(0).column(i).path_in_schema: i for i in range(md.row_group(0).num_columns)}
    groups = []
    for g in range(md.num_row_groups):
        rg = md.row_group(g)
        st = {k: rg.column(idx[f"bbox.{k}"]).statistics for k in ("xmin", "xmax", "ymin", "ymax")}
        if st["xmin"].min <= e and st["xmax"].max >= w and st["ymin"].min <= n and st["ymax"].max >= s:
            groups.append(g)
    rows = []
    if groups:
        t = f.read_row_groups(groups, columns=[c for c in COLS if c in names]).to_pylist()
        for r in t:
            b = r["bbox"]
            if b["xmin"] <= e and b["xmax"] >= w and b["ymin"] <= n and b["ymax"] >= s:
                r["geometry"] = mapping(wkb.loads(r["geometry"]))
                r["name"] = (r.pop("names", None) or {}).get("primary")
                del r["bbox"]
                r.pop("id", None)
                rows.append(r)
    return rows


def main():
    box = tuple(map(float, sys.argv[1:5])); out = sys.argv[5]
    theme, kind = (sys.argv[6] if len(sys.argv) > 6 else "buildings/building").split("/")
    rel = latest_release()
    files = [k for k in listing(f"release/{rel}/theme={theme}/type={kind}/") if k[0].endswith(".parquet")]
    print(f"release {rel}: scanning {len(files)} file footers", file=sys.stderr)
    total = 0
    with open(out, "w") as fh, cf.ThreadPoolExecutor(24) as pool:
        for rows in pool.map(lambda k: scan(*k, box), files):
            for r in rows: fh.write(json.dumps(r) + "\n")
            total += len(rows)
    print(f"{total} {kind} features -> {out} (release {rel})", file=sys.stderr)


if __name__ == "__main__":
    main()
