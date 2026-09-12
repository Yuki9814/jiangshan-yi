#!/usr/bin/env python3
"""Build the offline campaign map catalogue.

The catalogue is intentionally generated into one classic JavaScript file so a
double-clicked ``index.html`` never needs a network request.  Natural Earth
10m land and river archives plus the public-domain Gray Earth relief raster
are the geographic inputs.  Voronoi seeds are recognisable cities, while the
resulting cells are fictional game territory, not administrative boundaries.

This tool only writes ``map-catalog.js`` and the small, inspectable map JSON
copies under ``assets/maps``.  Source archives are extracted into a temporary
run directory below the workspace ``work/campaign-geography/build-cache`` and
are never modified.
"""

from __future__ import annotations

import copy
import json
import math
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Iterable, Sequence
from zipfile import ZipFile

import shapefile
from shapely import set_precision
from shapely.affinity import affine_transform
from shapely.geometry import GeometryCollection, LineString, MultiLineString, MultiPoint, MultiPolygon, Point, Polygon, box, shape
from shapely.ops import linemerge, nearest_points, polygonize, unary_union

TOOLS = Path(__file__).resolve().parent
ROOT = TOOLS.parent
ASSETS = ROOT / "assets"
MAP_ASSETS = ASSETS / "maps"
SCRATCH = ROOT / "work" / "campaign-geography" / "build-cache"
# The 41 MB public-domain source archive is kept in the project work cache so
# the runnable output stays small.  A bundled archive remains a convenient
# fallback for users who intentionally package the source beside the app.
RELIEF_SOURCE_DIR = ROOT / "work" / "campaign-geography"
RELIEF_ARCHIVE = RELIEF_SOURCE_DIR / "GRAY_LR_SR.zip"
RELIEF_FALLBACK_ARCHIVE = MAP_ASSETS / "GRAY_LR_SR.zip"

# The adjacent natural-boundary generator is delivered beside this script and
# has no dependency on the old central-map build directory.
sys.path.insert(0, str(TOOLS))
from natural_boundaries import lines as boundary_lines  # noqa: E402
from natural_boundaries import noise as boundary_noise  # noqa: E402


WIDTH, HEIGHT = 1000, 780
BACKGROUND_FACTOR = 3.2
# The Voronoi construction uses a generous rectangular guard box, but the
# actual playable land is clipped to an anchor-hull envelope below.  The hull
# gives the outer battlefield a rounded, slightly irregular contour instead
# of four synthetic latitude/longitude edges.
RAW_VORONOI_FACTOR = 2.0
SOURCE_URLS = {
    "land": "https://naciscdn.org/naturalearth/10m/physical/ne_10m_land.zip",
    "rivers": "https://naciscdn.org/naturalearth/10m/physical/ne_10m_rivers_lake_centerlines.zip",
    "countries": "https://naciscdn.org/naturalearth/10m/cultural/ne_10m_admin_0_countries.zip",
}


def city(name: str, lon: float, lat: float) -> tuple[str, float, float]:
    return name, lon, lat


# A city is used as a visual anchor only.  The maps deliberately use broader
# historical-geographic names and do not claim to reproduce any dynasty's
# prefectures, modern provincial borders, or a single period's jurisdiction.
SPECS = [
    {
        "id": "north",
        "name": "朔北风云",
        "subtitle": "河套、燕云与辽东",
        "bounds": (94.0, 34.0, 134.0, 54.0),
        "anchors": [
            city("西宁", 101.78, 36.62), city("兰州", 103.83, 36.06), city("银川", 106.23, 38.49),
            city("呼和浩特", 111.75, 40.84), city("包头", 110.00, 40.65), city("鄂尔多斯", 109.99, 39.82),
            city("大同", 113.30, 40.08), city("太原", 112.55, 37.87), city("北京", 116.41, 39.90),
            city("承德", 117.96, 40.97), city("张家口", 114.89, 40.82), city("赤峰", 118.89, 42.27),
            city("通辽", 122.24, 43.62), city("沈阳", 123.43, 41.80), city("长春", 125.32, 43.82),
            city("哈尔滨", 126.64, 45.76), city("齐齐哈尔", 123.92, 47.35), city("延吉", 129.51, 42.90),
            city("丹东", 124.35, 40.00), city("锦州", 121.13, 41.10), city("朝阳", 120.45, 41.57),
            city("大连", 121.62, 38.91), city("济南", 117.12, 36.65), city("石家庄", 114.51, 38.04),
            city("邯郸", 114.54, 36.63), city("邢台", 114.50, 37.07), city("保定", 115.46, 38.87),
            city("沧州", 116.84, 38.30), city("临汾", 111.52, 36.09), city("运城", 110.99, 35.03),
            city("西安", 108.94, 34.34), city("延安", 109.49, 36.59), city("榆林", 109.74, 38.29),
            city("武威", 102.64, 37.93), city("张掖", 100.45, 38.93),
        ],
        "mountain_names": [("祁连山", 99.6, 38.0, -10), ("阴山", 109.0, 41.2, -6), ("太行山", 113.8, 37.1, -65), ("燕山", 117.4, 40.4, -15), ("长白山", 128.1, 42.2, -35), ("大兴安岭", 121.0, 47.0, -30)],
        "river_names": {"黄河", "黑龙江", "松花江", "辽河", "海河", "嫩江", "色楞格河"},
        "seas": [("渤海", 119.0, 38.8, 0), ("黄海", 126.2, 37.4, 14)],
        "waterlines": [[(118.0, 39.0), (120.2, 39.8), (123.0, 39.3), (125.4, 38.5)], [(123.6, 37.0), (126.3, 37.4), (129.2, 37.0)]],
        "barriers": [
            ("燕山山脉", [(114.5, 40.6), (117.0, 41.1), (119.7, 40.6)]),
            ("长白山脉", [(126.0, 42.0), (128.0, 43.0), (130.0, 42.5)]),
            ("河套北缘", [(103.0, 40.2), (108.5, 41.2), (114.0, 40.5)]),
        ],
        "expeditions": [
            {"id": "north-steppe", "name": "草原盟约", "subtitle": "河套北境", "lon": 108.4, "lat": 42.4, "kind": "frontier"},
            {"id": "north-koryo", "name": "东海边城", "subtitle": "鸭绿江外", "lon": 129.2, "lat": 40.4, "kind": "border-state"},
            {"id": "north-silk", "name": "玉门商路", "subtitle": "河西走廊西口", "lon": 96.0, "lat": 39.8, "kind": "league"},
        ],
    },
    {
        "id": "south",
        "name": "岭南潮起",
        "subtitle": "巴蜀、岭表与中南半岛",
        "bounds": (97.0, 10.0, 124.0, 33.0),
        "anchors": [
            city("成都", 104.07, 30.57), city("重庆", 106.55, 29.56), city("贵阳", 106.63, 26.65),
            city("昆明", 102.83, 24.88), city("大理", 100.23, 25.60), city("丽江", 100.23, 26.87),
            city("西昌", 102.26, 27.89), city("遵义", 106.93, 27.73), city("南宁", 108.32, 22.82),
            city("柳州", 109.42, 24.33), city("桂林", 110.29, 25.27), city("广州", 113.26, 23.13),
            city("深圳", 114.06, 22.54), city("汕头", 116.60, 23.45), city("厦门", 118.20, 24.65),
            city("福州", 119.30, 26.08), city("温州", 120.70, 27.99), city("杭州", 120.15, 30.27),
            city("南昌", 115.86, 28.68), city("长沙", 112.94, 28.23), city("衡阳", 112.57, 26.89),
            city("郴州", 113.02, 25.77), city("湛江", 110.36, 21.27), city("河内", 105.83, 21.03),
            city("海防", 106.68, 20.84), city("老街", 103.97, 22.49), city("万象", 102.63, 17.98),
            city("琅勃拉邦", 102.14, 19.88), city("清迈", 98.99, 18.79), city("曼谷", 100.50, 13.76),
            city("金边", 104.93, 11.56), city("胡志明市", 106.63, 10.82), city("顺化", 107.59, 16.46),
            city("岘港", 108.20, 16.05), city("芽庄", 109.19, 12.24), city("景洪", 100.80, 22.01),
            city("梧州", 111.32, 23.48), city("韶关", 113.60, 24.81),
        ],
        "mountain_names": [("横断山脉", 99.7, 28.0, -35), ("南岭", 112.0, 25.3, -10), ("十万大山", 108.0, 22.0, -12), ("长山山脉", 107.5, 16.8, -55), ("掸邦高原", 99.5, 21.5, -20)],
        "river_names": {"长江", "湄公河", "怒江", "伊洛瓦底江", "红河", "昭拍耶河", "珠江", "湘江", "赣江"},
        "seas": [("南海", 118.0, 17.5, 0), ("北部湾", 108.5, 19.2, -12)],
        "waterlines": [[(113.7, 17.3), (117.0, 18.3), (120.6, 17.5), (123.0, 16.0)], [(107.1, 19.1), (109.2, 19.7), (111.2, 19.0)]],
        "barriers": [
            ("横断山脉", [(98.3, 27.2), (100.2, 28.8), (102.2, 28.0), (103.5, 26.4)]),
            ("南岭山脉", [(109.5, 25.0), (112.0, 25.8), (114.5, 25.0), (116.4, 25.7)]),
            ("长山山脉", [(106.0, 20.0), (107.0, 17.2), (108.4, 14.0), (109.5, 11.5)]),
        ],
        "expeditions": [
            {"id": "south-maritime", "name": "海上商盟", "subtitle": "南海北缘", "lon": 119.2, "lat": 19.0, "kind": "league"},
            {"id": "south-mekong", "name": "湄公河诸邦", "subtitle": "中南半岛内陆", "lon": 105.8, "lat": 14.3, "kind": "frontier"},
            {"id": "south-mountain", "name": "云贵边城", "subtitle": "横断山外缘", "lon": 98.5, "lat": 25.0, "kind": "border-state"},
        ],
    },
    {
        "id": "mediterranean",
        "name": "海隅十字潮",
        "subtitle": "亚得里亚海至两河",
        "bounds": (6.0, 28.0, 45.0, 52.0),
        "anchors": [
            city("罗马", 12.50, 41.90), city("那不勒斯", 14.27, 40.85), city("米兰", 9.19, 45.46),
            city("威尼斯", 12.45, 45.48), city("都灵", 7.69, 45.07), city("维也纳", 16.37, 48.21),
            city("布拉格", 14.44, 50.08), city("布达佩斯", 19.04, 47.50), city("贝尔格莱德", 20.46, 44.81),
            city("索非亚", 23.32, 42.70), city("布加勒斯特", 26.10, 44.43), city("雅典", 23.73, 37.98),
            city("塞萨洛尼基", 22.94, 40.64), city("萨拉热窝", 18.41, 43.86), city("萨格勒布", 15.98, 45.81),
            city("斯科普里", 21.43, 42.00), city("地拉那", 19.82, 41.33), city("伊斯坦布尔", 28.98, 41.01),
            city("安卡拉", 32.86, 39.93), city("伊兹密尔", 27.14, 38.42), city("布尔萨", 29.06, 40.19),
            city("第比利斯", 44.79, 41.72), city("埃里温", 44.51, 40.18),
            city("基辅", 30.52, 50.45), city("敖德萨", 30.72, 46.48), city("克里米亚", 34.10, 45.00),
            city("顿河畔罗斯托夫", 39.70, 47.24), city("利沃夫", 24.03, 49.84), city("雅西", 27.59, 47.16),
            city("贝鲁特", 35.50, 33.89), city("大马士革", 36.29, 33.51), city("阿勒颇", 37.16, 36.20),
            city("安条克", 36.16, 36.20), city("耶路撒冷", 35.21, 31.77), city("安曼", 35.93, 31.95),
            city("巴格达", 44.37, 33.31), city("摩苏尔", 43.13, 36.34),
        ],
        "mountain_names": [("阿尔卑斯山", 10.3, 46.2, -16), ("迪纳拉山脉", 17.5, 44.0, -55), ("巴尔干山脉", 24.5, 42.7, -8), ("托罗斯山脉", 34.5, 37.0, -8), ("高加索山脉", 43.0, 43.2, -20), ("黎巴嫩山", 35.7, 34.5, -20)],
        "river_names": {"多瑙河", "波河", "萨瓦河", "德涅斯特河", "顿河", "幼发拉底河", "底格里斯河", "莱茵河", "伏尔加河", "普鲁特河"},
        "seas": [("亚得里亚海", 17.4, 41.7, -10), ("爱琴海", 25.0, 37.4, -10), ("黑海", 34.5, 44.3, 0), ("地中海", 19.0, 33.0, 0)],
        "waterlines": [[(14.8, 39.0), (18.0, 38.2), (20.8, 38.7)], [(23.8, 36.2), (27.5, 35.8), (31.0, 36.2)], [(30.0, 44.0), (34.5, 45.0), (39.0, 44.2)]],
        "barriers": [
            ("阿尔卑斯山脉", [(6.8, 44.9), (9.5, 46.0), (12.3, 46.4), (15.1, 46.1)]),
            ("巴尔干山脉", [(18.0, 42.8), (21.5, 43.0), (24.8, 42.7), (27.2, 42.4)]),
            ("托罗斯山脉", [(28.2, 37.2), (31.5, 37.0), (34.6, 36.5), (37.2, 37.0)]),
            ("高加索山脉", [(39.0, 42.2), (41.8, 43.4), (44.8, 43.0)]),
        ],
        "expeditions": [
            {"id": "med-crusader", "name": "海隅营地", "subtitle": "东地中海岸", "lon": 34.8, "lat": 34.8, "kind": "camp"},
            {"id": "med-caravan", "name": "两河商路", "subtitle": "幼发拉底河上游", "lon": 40.1, "lat": 36.4, "kind": "league"},
            {"id": "med-black-sea", "name": "黑海城邦", "subtitle": "安纳托利亚北岸", "lon": 34.2, "lat": 42.5, "kind": "border-state"},
        ],
    },
]


def stage_sources() -> tuple[Path, Path, Path, Path, Path]:
    required = {
        "land": ASSETS / "geography-ne_10m_land.zip",
        "rivers": ASSETS / "geography-ne_10m_rivers_lake_centerlines.zip",
        "countries": ASSETS / "geography-ne_10m_admin_0_countries.zip",
    }
    missing = [str(p) for p in required.values() if not p.exists()]
    if missing:
        raise FileNotFoundError("missing bundled Natural Earth archives: " + ", ".join(missing))
    SCRATCH.mkdir(parents=True, exist_ok=True)
    run_dir = Path(tempfile.mkdtemp(prefix="run-", dir=str(SCRATCH)))
    paths: dict[str, Path] = {}
    for key, archive in required.items():
        dest = run_dir / key
        dest.mkdir()
        with ZipFile(archive) as zipped:
            zipped.extractall(dest)
        paths[key] = dest
    relief = run_dir / "relief"
    relief.mkdir()
    relief_archive = RELIEF_ARCHIVE if RELIEF_ARCHIVE.exists() else RELIEF_FALLBACK_ARCHIVE
    if not relief_archive.exists():
        raise FileNotFoundError(
            "missing Natural Earth Gray Earth archive; expected "
            f"{RELIEF_ARCHIVE} or fallback {RELIEF_FALLBACK_ARCHIVE}"
        )
    with ZipFile(relief_archive) as zipped:
        zipped.extractall(relief)
    return (
        paths["land"] / "ne_10m_land.shp",
        paths["rivers"] / "ne_10m_rivers_lake_centerlines.shp",
        paths["countries"] / "ne_10m_admin_0_countries.shp",
        run_dir,
        relief / "GRAY_LR_SR.tif",
    )


def fmt(value: float) -> str:
    if abs(value) < 0.005:
        value = 0.0
    # Background envelopes span several thousand SVG units; three decimals
    # avoid rounding a narrow real coastline into a self-intersection while
    # remaining compact enough for the static catalogue.
    return f"{value:.3f}".rstrip("0").rstrip(".")


def project(point: Sequence[float], bounds: Sequence[float], size=(WIDTH, HEIGHT)) -> tuple[float, float]:
    west, south, east, north = bounds
    lon, lat = point[0], point[1]
    return ((lon - west) / (east - west) * size[0], (north - lat) / (north - south) * size[1])


def expanded_bounds(bounds: Sequence[float], factor: float = BACKGROUND_FACTOR) -> tuple[float, float, float, float]:
    """Return a real geographic envelope around the playable crop.

    The SVG battle grid remains 1000×780.  This larger envelope is projected
    into the same coordinate system so panning and the minimum zoom reveal
    continuous surrounding terrain and sea instead of a hard crop edge.
    """
    west, south, east, north = bounds
    lon_pad = (east - west) * (factor - 1) / 2
    lat_pad = (north - south) * (factor - 1) / 2
    return (max(-179.0, west - lon_pad), max(-85.0, south - lat_pad), min(179.0, east + lon_pad), min(85.0, north + lat_pad))


def anchor_envelope(anchors: Sequence[tuple[str, float, float]], bounds: Sequence[float]):
    """Build a rounded real-land envelope around all campaign anchors.

    The nominal ``bounds`` are a navigation/focus extent.  A convex hull plus
    a modest geodesic-style buffer leaves room around the outer cities while
    making the game-land contour follow a curved envelope.  Natural Earth
    land is intersected with this envelope afterwards, so coastlines remain
    real and no rectangular crop edge is painted as playable territory.
    """
    points = MultiPoint([(lon, lat) for _, lon, lat in anchors])
    if points.is_empty:
        raise RuntimeError("cannot build a playable envelope without anchors")
    west, south, east, north = bounds
    # Scale the pad to each campaign's geographic span while keeping it large
    # enough to form a visible natural buffer around the outer anchors.
    pad = max(1.7, min(3.4, min(east - west, north - south) * 0.14))
    envelope = points.convex_hull.buffer(pad, quad_segs=16, join_style=1)
    return envelope.simplify(0.035, preserve_topology=True)


def svg_background_bounds(bounds: Sequence[float], background_bounds: Sequence[float]) -> dict:
    west, south, east, north = bounds
    bg_west, bg_south, bg_east, bg_north = background_bounds
    x0, y0 = project((bg_west, bg_north), bounds)
    x1, y1 = project((bg_east, bg_south), bounds)
    return {"x": round(x0, 2), "y": round(y0, 2), "width": round(x1 - x0, 2), "height": round(y1 - y0, 2)}


def ring_path(coords: Iterable[Sequence[float]], bounds, size=(WIDTH, HEIGHT)) -> str:
    points = [project(c, bounds, size) for c in coords]
    return "M" + " ".join(f"{fmt(x)},{fmt(y)}" for x, y in points) + "Z" if points else ""


def polygon_path(geom, bounds, size=(WIDTH, HEIGHT)) -> str:
    if geom is None or geom.is_empty:
        return ""
    if isinstance(geom, Polygon):
        rings = [ring_path(geom.exterior.coords, bounds, size)]
        rings.extend(ring_path(r.coords, bounds, size) for r in geom.interiors)
        return "".join(rings)
    if isinstance(geom, (MultiPolygon, GeometryCollection)):
        return "".join(polygon_path(part, bounds, size) for part in geom.geoms)
    return ""


def line_path(geom, bounds, size=(WIDTH, HEIGHT)) -> str:
    if geom is None or geom.is_empty:
        return ""
    if isinstance(geom, LineString):
        points = [project(c, bounds, size) for c in geom.coords]
        return "M" + " L".join(f"{fmt(x)},{fmt(y)}" for x, y in points) if len(points) > 1 else ""
    if isinstance(geom, (MultiLineString, GeometryCollection)):
        return "".join(line_path(part, bounds, size) for part in geom.geoms)
    return ""


def polygon_parts(geom) -> list[Polygon]:
    if geom is None or geom.is_empty:
        return []
    if isinstance(geom, Polygon):
        return [geom]
    if isinstance(geom, (MultiPolygon, GeometryCollection)):
        return [part for part in geom.geoms if isinstance(part, Polygon)]
    return []


def clip_half_plane(poly: list[tuple[float, float]], a: tuple[float, float], b: tuple[float, float]) -> list[tuple[float, float]]:
    if not poly:
        return []
    aa = 2.0 * (b[0] - a[0])
    bb = 2.0 * (b[1] - a[1])
    cc = b[0] * b[0] + b[1] * b[1] - a[0] * a[0] - a[1] * a[1]

    def value(point):
        return aa * point[0] + bb * point[1] - cc

    result: list[tuple[float, float]] = []
    previous = poly[-1]
    previous_value = value(previous)
    previous_inside = previous_value <= 1e-10
    for current in poly:
        current_value = value(current)
        current_inside = current_value <= 1e-10
        if current_inside != previous_inside:
            denominator = previous_value - current_value
            if abs(denominator) > 1e-14:
                ratio = previous_value / denominator
                result.append((previous[0] + (current[0] - previous[0]) * ratio, previous[1] + (current[1] - previous[1]) * ratio))
        if current_inside:
            result.append(current)
        previous, previous_value, previous_inside = current, current_value, current_inside
    return result


def voronoi_cell(index: int, coords: list[tuple[float, float]], bounds) -> Polygon:
    west, south, east, north = bounds
    polygon = [(west - 1.0, south - 1.0), (east + 1.0, south - 1.0), (east + 1.0, north + 1.0), (west - 1.0, north + 1.0)]
    for other_index, other in enumerate(coords):
        if index == other_index:
            continue
        polygon = clip_half_plane(polygon, coords[index], other)
        if len(polygon) < 3:
            return Polygon()
    return Polygon(polygon).buffer(0)


def feature_names(record) -> set[str]:
    data = record.as_dict()
    return {str(data.get(key) or "").strip() for key in ("name", "name_en", "name_zh", "name_alt") if data.get(key)}


def river_features(reader: shapefile.Reader, spec: dict, map_box) -> list[dict]:
    target_names = spec["river_names"]
    collected: dict[str, list] = {name: [] for name in target_names}
    for record, raw in zip(reader.iterRecords(), reader.iterShapes()):
        names = feature_names(record)
        match = next((target for target in target_names if target in names), None)
        if match is None:
            continue
        geometry = shape(raw.__geo_interface__)
        if not geometry.intersects(map_box):
            continue
        clipped = geometry.intersection(map_box)
        if not clipped.is_empty:
            collected[match].append(clipped)

    result = []
    for name, pieces in collected.items():
        if not pieces:
            continue
        merged = unary_union(pieces)
        merged = linemerge(merged) if not isinstance(merged, LineString) else merged
        merged = merged.simplify(0.008, preserve_topology=True)
        if isinstance(merged, MultiLineString):
            longest = max(merged.geoms, key=lambda line: line.length)
        else:
            longest = merged
        if not isinstance(longest, LineString) or longest.is_empty or longest.length < 0.04:
            continue
        label_point = longest.interpolate(0.52, normalized=True)
        result.append({"name": name, "path": line_path(merged, spec["bounds"]), "label": list(map(lambda v: round(v, 2), project(label_point.coords[0], spec["bounds"])) )})
    return result


def curve_path(points: list[tuple[float, float]], bounds) -> str:
    """A calm cubic ribbon line for a named natural barrier.

    It is cartographic annotation only; no repeated triangular mountain icons
    are used.  The actual coastline and rivers remain Natural Earth linework.
    """
    projected = [project(point, bounds) for point in points]
    if len(projected) < 2:
        return ""
    if len(projected) == 2:
        return f"M{fmt(projected[0][0])},{fmt(projected[0][1])} L{fmt(projected[1][0])},{fmt(projected[1][1])}"
    path = f"M{fmt(projected[0][0])},{fmt(projected[0][1])}"
    for index in range(len(projected) - 1):
        a = projected[index - 1] if index else projected[index]
        b = projected[index]
        c = projected[index + 1]
        d = projected[index + 2] if index + 2 < len(projected) else c
        c1 = (b[0] + (c[0] - a[0]) / 6.0, b[1] + (c[1] - a[1]) / 6.0)
        c2 = (c[0] - (d[0] - b[0]) / 6.0, c[1] - (d[1] - b[1]) / 6.0)
        path += f" C{fmt(c1[0])},{fmt(c1[1])} {fmt(c2[0])},{fmt(c2[1])} {fmt(c[0])},{fmt(c[1])}"
    return path


def build_relief_image(spec: dict, relief_tif: Path, run_dir: Path) -> Path:
    """Crop the staged global Gray Earth GeoTIFF to a 1000×780 map wash.

    The source is a regular 0.022222° world raster (documented by its TFW),
    so a simple pixel window followed by the same equirectangular resize as
    the SVG projection keeps the terrain aligned with the Natural Earth land
    paths.  ``sips`` is part of macOS and avoids adding a runtime Python image
    dependency to this zero-dependency web app.
    """
    bounds = tuple(spec.get("background_bounds") or spec["bounds"])
    west, south, east, north = bounds
    pixel = 0.02222222222222
    origin_x, origin_y = -179.98888888888889, 89.98888888888889
    # One-pixel padding prevents an anti-aliased coastline from exposing a
    # square crop edge when the map is panned to its maximum extent.
    x0 = max(0, math.floor((west - origin_x) / pixel) - 1)
    y0 = max(0, math.floor((origin_y - north) / pixel) - 1)
    crop_width = math.ceil((east - west) / pixel) + 2
    crop_height = math.ceil((north - south) / pixel) + 2
    crop_tif = run_dir / f"{spec['id']}-relief-crop.tif"
    output = MAP_ASSETS / f"{spec['id']}-relief.jpg"
    crop_cmd = ["sips", "-c", str(crop_height), str(crop_width), "--cropOffset", str(y0), str(x0), str(relief_tif), "--out", str(crop_tif)]
    resize_cmd = ["sips", "-z", str(HEIGHT), str(WIDTH), "-s", "format", "jpeg", "-s", "formatOptions", "82", str(crop_tif), "--out", str(output)]
    try:
        subprocess.run(crop_cmd, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        subprocess.run(resize_cmd, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    except FileNotFoundError as error:
        raise RuntimeError("macOS sips is required to generate bundled relief crops") from error
    except subprocess.CalledProcessError as error:
        raise RuntimeError(f"failed to crop Gray Earth relief for {spec['id']}: {error.stderr[-400:]}") from error
    return output


def load_central() -> dict:
    """Read the accepted central map without regenerating or touching it."""
    source = (ROOT / "map-data.js").read_text(encoding="utf-8")
    match = re.search(r"globalThis\.MAP_DATA\s*=\s*(\{.*\})\s*;\s*\n?if", source, flags=re.S)
    if not match:
        raise RuntimeError("could not read the existing central MAP_DATA payload")
    data = json.loads(match.group(1))
    data["id"] = "central"
    data["name"] = "中原逐鹿"
    data["subtitle"] = "关中、河洛与江淮"
    data["playablePath"] = data["landPath"]
    data["backgroundPath"] = data["landPath"] + data.get("contextPath", "")
    data["backgroundImage"] = "assets/maps/central-relief.jpg"
    data["seaLabels"] = [{"name": "黄海", "x": 1135, "y": 470, "rotation": 9}, {"name": "渤海", "x": 1140, "y": 170, "rotation": 0}]
    data["description"] = "中原及周边 105–122°E、28–40°N 的离线战场。大陆轮廓与河流承自 Natural Earth 10m；52 个城市锚点形成虚构地盘，不对应历史或现行行政区。"
    data["expeditionSites"] = [
        {"id": "central-west", "name": "河西关隘", "subtitle": "西北远征方向", "lon": 101.4, "lat": 37.1, "kind": "frontier"},
        {"id": "central-south", "name": "荆楚水营", "subtitle": "长江中游方向", "lon": 112.2, "lat": 29.8, "kind": "camp"},
        {"id": "central-east", "name": "海门商盟", "subtitle": "东海航路方向", "lon": 121.8, "lat": 32.2, "kind": "league"},
    ]
    data["expeditionSites"] = [project_site(site, data["bounds"]) for site in data["expeditionSites"]]
    data["sources"].append({"title": "Natural Earth 10m Gray Earth relief (offline crop from project source cache)", "url": "https://naciscdn.org/naturalearth/10m/raster/GRAY_LR_SR.zip", "license": "Public domain (Natural Earth; see repository terms)"})
    return data


def extend_central_background(data: dict, land) -> dict:
    bounds = tuple(data["bounds"])
    bg_bounds = expanded_bounds(bounds)
    background_land = land.intersection(box(*bg_bounds)).simplify(0.025, preserve_topology=True)
    data["backgroundPath"] = polygon_path(background_land, bounds)
    data["backgroundBounds"] = svg_background_bounds(bounds, bg_bounds)
    data["backgroundGeoBounds"] = list(bg_bounds)
    data["backgroundImageBounds"] = svg_background_bounds(bounds, bg_bounds)
    return data


def choose_playable_mask(land_crop, anchors: list[tuple[str, float, float]]):
    parts = polygon_parts(land_crop)
    selected = [part for part in parts if any(part.covers(Point(lon, lat)) for _, lon, lat in anchors)]
    if not selected:
        raise RuntimeError("no Natural Earth land polygon contains the supplied city anchors")
    return unary_union(selected)


def campaign_organic_cells(cells, bounds, size):
    """Curve shared edges while keeping a difficult coast numerically stable.

    The central map's historical naturalizer tries stronger bends first.  The
    broader campaign crops contain more narrow peninsulas and coastline
    vertices, so this copy starts with a restrained 0.18 strength and backs
    off until polygonisation preserves exactly the same planar topology.  The
    curve is still visible at map scale, and every adjacent pair continues to
    use one shared line.
    """
    west, south, east, north = bounds
    width, height = size
    sx, sy = width / (east - west), height / (north - south)
    forward = [sx, 0, 0, -sy, -west * sx, north * sy]
    inverse = [1 / sx, 0, 0, -1 / sy, west, north]
    original = [affine_transform(cell, forward) for cell in cells]
    land = unary_union(original)
    edge_pairs = set()
    arcs = []
    junctions: dict[tuple[float, float], list] = {}
    for first, cell in enumerate(original):
        for second in range(first + 1, len(original)):
            shared = cell.boundary.intersection(original[second].boundary)
            if shared.length < 0.055:
                continue
            edge_pairs.add((first, second))
            merged = boundary_lines(shared)
            merged = merged[0] if len(merged) == 1 else linemerge(merged)
            for part in boundary_lines(merged):
                coords = list(part.coords)
                if tuple(coords[0]) > tuple(coords[-1]):
                    coords.reverse()
                arc = {"a": first, "b": second, "line": LineString(coords), "start": coords[0], "end": coords[-1]}
                index = len(arcs)
                arcs.append(arc)
                for endpoint, opposite in (("start", "end"), ("end", "start")):
                    p, q = arc[endpoint], arc[opposite]
                    angle = math.atan2(q[1] - p[1], q[0] - p[0])
                    arc[endpoint + "_angle"] = angle
                    junctions.setdefault(tuple(p), []).append((angle, index, endpoint))

    # As in the central map, soften only interior three-way junctions.  The
    # endpoint coordinates remain fixed, keeping each pair's edge identical.
    for point, incident in junctions.items():
        if len(incident) != 3 or land.boundary.distance(Point(point)) < 0.03:
            continue
        incident.sort()
        phase = sum(angle - i * math.tau / 3 for i, (angle, _, _) in enumerate(incident)) / 3
        for i, (angle, index, endpoint) in enumerate(incident):
            desired = phase + i * math.tau / 3
            delta = (desired - angle + math.pi) % math.tau - math.pi
            arcs[index][endpoint + "_angle"] = angle + delta * 0.82

    # Wider campaign cells can carry a visible, low-amplitude bend.  Start
    # strong enough to read at 1000px, then back off only for narrow coastal
    # junctions where preserving the planar topology needs gentler curves.
    for strength in (0.72, 0.56, 0.42, 0.30, 0.20, 0.10, 0.0):
        network = [land.boundary]
        for index, arc in enumerate(arcs):
            source = arc["line"]
            start, end = arc["start"], arc["end"]
            length = source.length
            chord = math.dist(start, end)
            if length < 2 or chord < 0.01 or length > chord * 1.14 or strength == 0.0:
                network.append(source)
                continue
            seed = 1733 + arc["a"] * 104729 + arc["b"] * 15485863 + index * 37
            handle = min(chord * 0.30, 38)
            start_angle, end_angle = arc["start_angle"], arc["end_angle"]
            original_angle = math.atan2(end[1] - start[1], end[0] - start[0])
            start_angle = original_angle + ((start_angle - original_angle + math.pi) % math.tau - math.pi) * strength
            reverse_angle = original_angle + math.pi
            end_angle = reverse_angle + ((end_angle - reverse_angle + math.pi) % math.tau - math.pi) * strength
            c1 = (start[0] + math.cos(start_angle) * handle, start[1] + math.sin(start_angle) * handle)
            c2 = (end[0] + math.cos(end_angle) * handle, end[1] + math.sin(end_angle) * handle)
            nx, ny = -(end[1] - start[1]) / chord, (end[0] - start[0]) / chord
            amount = min(1, chord / 35) * strength
            points = []
            count = max(5, math.ceil(length / 1.35))
            for step in range(count + 1):
                t = step / count
                u = 1 - t
                x = u**3 * start[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t**3 * end[0]
                y = u**3 * start[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t**3 * end[1]
                distance = t * length
                displacement = (9.0 * boundary_noise(distance / 48 + 0.37, seed)
                                + 5.0 * boundary_noise(distance / 17 + 0.79, seed + 11)
                                + 1.9 * boundary_noise(distance / 5.5 + 0.21, seed + 23)
                                + 0.55 * boundary_noise(distance / 2.2 + 0.63, seed + 47))
                displacement *= math.sin(math.pi * t) ** 1.3 * amount
                points.append((x + nx * displacement, y + ny * displacement))
            points[0], points[-1] = start, end
            network.append(LineString(points))
        rebuilt = [poly for poly in polygonize(unary_union(network)) if poly.area > 0.001 and land.covers(poly.representative_point())]
        if len(rebuilt) != len(cells):
            continue
        assigned = [max(rebuilt, key=lambda poly: poly.intersection(cell).area) for cell in original]
        if len({poly.wkb for poly in assigned}) != len(cells):
            continue
        actual_pairs = {(a, b) for a in range(len(cells)) for b in range(a + 1, len(cells)) if assigned[a].boundary.intersection(assigned[b].boundary).length > 0.055}
        if actual_pairs != edge_pairs or not all(poly.is_valid and isinstance(poly, Polygon) for poly in assigned):
            continue
        if unary_union(assigned).symmetric_difference(land).area > 0.08:
            continue
        return [affine_transform(poly, inverse) for poly in assigned], {
            "style": "organic-shared-borders", "version": 1, "strength": strength,
            "arcs": len(arcs), "sharedEdges": len(edge_pairs), "coastlinePreserved": True,
            "topologyPreserved": True,
        }
    raise RuntimeError("could not naturalize campaign borders while preserving planar topology")


def natural_cells(raw_cells: list[Polygon], land_crop, anchors, bounds):
    cells: list[Polygon] = []
    discarded: list[dict] = []
    for index, raw in enumerate(raw_cells):
        clipped = raw.intersection(land_crop)
        parts = sorted(polygon_parts(clipped), key=lambda part: part.area, reverse=True)
        if not parts or parts[0].area < 0.004:
            raise RuntimeError(f"anchor {anchors[index][0]} produced no usable land cell")
        cell = set_precision(parts[0].simplify(0.002, preserve_topology=True), grid_size=1e-5)
        if not isinstance(cell, Polygon) or not cell.is_valid:
            cell = set_precision(parts[0].buffer(0), grid_size=1e-5)
        if not isinstance(cell, Polygon) or cell.is_empty:
            raise RuntimeError(f"anchor {anchors[index][0]} produced an invalid cell")
        cells.append(cell)
        for part_index, fragment in enumerate(parts[1:], start=1):
            discarded.append({"source": index, "part": part_index, "geom": set_precision(fragment.simplify(0.002, preserve_topology=True), grid_size=1e-5)})

    assigned = []
    unassigned = []
    fragment_audit = []
    for fragment in discarded:
        candidates = []
        for target, retained in enumerate(cells):
            if target == fragment["source"]:
                continue
            shared = fragment["geom"].boundary.intersection(retained.boundary).length
            if shared > 0.001:
                candidates.append((shared, target))
        if not candidates:
            unassigned.append(fragment)
            fragment_audit.append({"source": fragment["source"], "part": fragment["part"], "area": fragment["geom"].area, "shared": 0.0, "target": None})
            continue
        shared, target = max(candidates)
        merged = set_precision(unary_union([cells[target], fragment["geom"]]), grid_size=1e-5)
        # If a fragment only touches at a numerical sliver, retain its largest
        # connected part and expose the sliver as muted context instead of
        # introducing a disconnected game territory.
        if isinstance(merged, MultiPolygon):
            merged = max(merged.geoms, key=lambda part: part.area)
        cells[target] = merged
        assigned.append({"source": fragment["source"], "target": target, "area": fragment["geom"].area, "shared": shared})
        fragment_audit.append({"source": fragment["source"], "part": fragment["part"], "area": fragment["geom"].area, "shared": shared, "target": target})

    # All discarded pieces that sit on the main connected mask and are large
    # enough to affect the drawing should be assigned. Isolated islands and
    # offshore pieces remain context background by design.
    for fragment in unassigned:
        if fragment["geom"].area > 0.12 and fragment["geom"].centroid.distance(unary_union(cells)) < 0.2:
            raise RuntimeError(f"significant unassigned land fragment near playable mask: {anchors[fragment['source']][0]}")

    before = unary_union(cells)
    cells, style = campaign_organic_cells(cells, bounds, (WIDTH, HEIGHT))
    if len(cells) != len(anchors) or not all(isinstance(cell, Polygon) and cell.is_valid for cell in cells):
        raise RuntimeError("organic boundary rebuild did not preserve all game cells")
    after = unary_union(cells)
    if before.symmetric_difference(after).area > 0.08:
        raise RuntimeError("organic boundary rebuild changed playable coverage")
    return cells, fragment_audit, style, before, unassigned


def adjacency_and_borders(cells, bounds):
    neighbors = [[] for _ in cells]
    borders = []
    for first in range(len(cells)):
        for second in range(first + 1, len(cells)):
            shared = cells[first].boundary.intersection(cells[second].boundary)
            if shared.length <= 0.001:
                continue
            neighbors[first].append(second)
            neighbors[second].append(first)
            path = line_path(shared, bounds)
            if not path:
                raise RuntimeError(f"adjacent regions {first} and {second} have an empty shared border")
            borders.append({"a": first, "b": second, "path": path})
    for ids in neighbors:
        ids.sort()
    return neighbors, borders


def project_site(site: dict, bounds) -> dict:
    item = dict(site)
    item["x"], item["y"] = [round(value, 2) for value in project((item["lon"], item["lat"]), bounds)]
    plans = {
        "central-west": (5, 48, {"grain": 32, "troops": 18, "morale": 0.06}, "穿越河西山口，争取西北商路的补给。"),
        "central-south": (3, 34, {"grain": 24, "troops": 16, "development": 1.2}, "沿江南下，在荆楚水网中寻找盟友。"),
        "central-east": (8, 66, {"grain": 40, "troops": 28, "fort": 1.8}, "循海门航路会合远方商盟。"),
        "north-steppe": (5, 56, {"grain": 42, "troops": 24, "morale": 0.08}, "越过草原边界，与河套外的部族议盟。"),
        "north-koryo": (8, 72, {"grain": 58, "troops": 35, "fort": 2.2}, "渡过鸭绿江外的边地城塞。"),
        "north-silk": (3, 40, {"grain": 28, "troops": 15, "development": 1.0}, "整合玉门商路，换取西域军粮。"),
        "south-maritime": (8, 68, {"grain": 46, "troops": 32, "development": 1.6}, "在南海北缘争取季风航路。"),
        "south-mekong": (5, 52, {"grain": 38, "troops": 26, "morale": 0.1}, "沿湄公河会合中南半岛诸邦。"),
        "south-mountain": (3, 44, {"grain": 30, "troops": 20, "fort": 1.5}, "翻越横断山外缘，稳住西南边城。"),
        "med-crusader": (8, 74, {"grain": 60, "troops": 38, "fort": 2.5}, "在东地中海岸接触远方十字军营地。"),
        "med-caravan": (5, 58, {"grain": 48, "troops": 28, "development": 1.5}, "护送两河商路的粮秣与使节。"),
        "med-black-sea": (3, 43, {"grain": 34, "troops": 22, "morale": 0.07}, "争取黑海北岸城邦的船队支援。"),
    }
    distance, difficulty, rewards, description = plans.get(item.get("id"), (5, 50, {"grain": 30, "troops": 20}, "越过山海，在远方争取新的补给与战果。"))
    item.setdefault("distance", distance)
    item.setdefault("difficulty", difficulty)
    item.setdefault("rewards", rewards)
    item.setdefault("cooldownMonths", 12)
    item.setdefault("description", description)
    return item


def atomic_write_text(path: Path, text: str) -> None:
    """Publish generated text in one rename so an open local page never sees
    a half-written catalogue or mirror JSON file."""
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.tmp-{os.getpid()}")
    try:
        temporary.write_text(text, encoding="utf-8")
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


def build_map(spec: dict, land, river_reader) -> dict:
    bounds = tuple(spec["bounds"])
    map_box = box(*bounds)
    background_bounds = expanded_bounds(bounds)
    background_box = box(*background_bounds)
    envelope = anchor_envelope(spec["anchors"], bounds)
    # The nominal bounds describe the map's focus and labels.  Cells are
    # clipped to the rounded anchor envelope, while the rectangular guard box
    # only limits Voronoi half-plane work and never becomes a land edge.
    raw_bounds = expanded_bounds(bounds, RAW_VORONOI_FACTOR)
    land_crop = land.intersection(envelope).simplify(0.02, preserve_topology=True)
    background_land = land.intersection(background_box).simplify(0.025, preserve_topology=True)
    anchors = spec["anchors"]
    for name, lon, lat in anchors:
        if not land.covers(Point(lon, lat)):
            raise RuntimeError(f"anchor {name} ({lon},{lat}) lies outside Natural Earth land")
    mask = choose_playable_mask(land_crop, anchors)
    coords = [(lon, lat) for _, lon, lat in anchors]
    raw = [voronoi_cell(index, coords, raw_bounds) for index in range(len(coords))]
    cells, fragments, boundary_style, initial_union, unassigned = natural_cells(raw, mask, anchors, bounds)
    neighbors, borders = adjacency_and_borders(cells, bounds)

    # A label pole is kept inside each final cell after the curved rebuild.
    rows = []
    river_data = river_features(river_reader, spec, map_box)
    river_geometries = []
    for river in river_data:
        # The visual line is enough for the proximity hint; read back only the
        # source features below to avoid duplicating SVG path parsing here.
        river_geometries.append(river["name"])
    source_river_shapes = []
    wanted = spec["river_names"]
    for record, raw_shape in zip(river_reader.iterRecords(), river_reader.iterShapes()):
        if not wanted.intersection(feature_names(record)):
            continue
        geometry = shape(raw_shape.__geo_interface__).intersection(map_box)
        if not geometry.is_empty:
            source_river_shapes.append(geometry)
    river_union = unary_union(source_river_shapes) if source_river_shapes else None
    mountain_anchors = {name for name, *_ in spec["mountain_names"]}
    for index, (name, lon, lat) in enumerate(anchors):
        point = Point(lon, lat)
        if not cells[index].covers(point):
            interior = cells[index].buffer(-0.02)
            point = nearest_points(interior if not interior.is_empty else cells[index], cells[index].representative_point())[0]
        x, y = project((point.x, point.y), bounds)
        terrain = "mountain" if any(math.hypot(lon - mx, lat - my) < 1.1 for _, mx, my, _ in spec["mountain_names"]) else "plain"
        if terrain == "plain" and river_union is not None and river_union.distance(Point(lon, lat)) < 0.22:
            terrain = "river"
        fertility = {"plain": 1.08, "river": 1.22, "mountain": 0.88}[terrain]
        rows.append({
            "id": index,
            "name": name,
            "x": round(x, 2), "y": round(y, 2),
            "path": polygon_path(cells[index], bounds),
            "neighbors": neighbors[index],
            "terrain": terrain,
            "fertility": fertility,
            "center": [round(lon, 4), round(lat, 4)],
        })

    playable_union = unary_union(cells)
    context = set_precision(background_land.difference(playable_union).simplify(0.025, preserve_topology=True), grid_size=1e-5)
    barrier_paths = []
    terrain_relief = []
    for name, points in spec["barriers"]:
        path = curve_path(points, bounds)
        if path:
            label_point = project(points[len(points) // 2], bounds)
            barrier_paths.append({"name": name, "path": path, "label": [round(label_point[0], 2), round(label_point[1], 2)]})
            # Broad, low-opacity bands provide a continuous parchment relief
            # layer. They follow the named geographic range rather than using
            # repeated decorative triangle icons.
            ridge = LineString(points)
            for width_degrees, opacity in ((0.34, 0.11), (0.13, 0.18)):
                band = ridge.buffer(width_degrees, cap_style=2, join_style=2).simplify(0.025, preserve_topology=True)
                terrain_relief.append({"name": name, "path": polygon_path(band, bounds), "opacity": opacity})
    water_lines = [{"path": curve_path(points, bounds), "opacity": 0.28} for points in spec.get("waterlines", []) if curve_path(points, bounds)]
    mountains = []
    for name, lon, lat, rotation in spec["mountain_names"]:
        x, y = project((lon, lat), bounds)
        mountains.append({"name": name, "x": round(x, 2), "y": round(y, 2), "rotation": rotation})
    sea_labels = [{"name": name, "x": round(project((lon, lat), bounds)[0], 2), "y": round(project((lon, lat), bounds)[1], 2), "rotation": rotation} for name, lon, lat, rotation in spec["seas"]]
    data = {
        "id": spec["id"], "name": spec["name"], "subtitle": spec["subtitle"],
        "width": WIDTH, "height": HEIGHT, "bounds": list(bounds),
        "regions": rows, "borders": borders, "boundaryStyle": boundary_style,
        "landPath": polygon_path(playable_union, bounds), "playablePath": polygon_path(playable_union, bounds),
        "backgroundPath": polygon_path(background_land, bounds), "contextPath": polygon_path(context, bounds),
        "backgroundBounds": svg_background_bounds(bounds, background_bounds), "backgroundGeoBounds": list(background_bounds), "backgroundImageBounds": svg_background_bounds(bounds, background_bounds),
        "fragmentAudit": {
            "sharedEdgeTolerance": 0.001, "significantArea": 0.12,
            "fragments": [{"source": anchors[item["source"]][0], "part": item["part"], "area": round(item["area"], 6), "shared": round(item["shared"], 6), "assignedTo": anchors[item["target"]][0] if item["target"] is not None else None} for item in fragments],
            "unassignedContextArea": round(sum(item["geom"].area for item in unassigned), 6),
        },
        "rivers": river_data, "mountains": mountains, "barrierPaths": barrier_paths, "terrainRelief": terrain_relief, "waterLines": water_lines, "seaLabels": sea_labels,
        "expeditionSites": [project_site(site, bounds) for site in spec["expeditions"]],
        "sources": [
            {"title": "Natural Earth 10m physical land (bundled offline archive)", "url": SOURCE_URLS["land"], "license": "Public domain (Natural Earth; see repository terms)"},
            {"title": "Natural Earth 10m rivers and lake centerlines (bundled offline archive)", "url": SOURCE_URLS["rivers"], "license": "Public domain (Natural Earth; see repository terms)"},
            {"title": "Natural Earth 10m Gray Earth relief (offline crop from project source cache)", "url": "https://naciscdn.org/naturalearth/10m/raster/GRAY_LR_SR.zip", "license": "Public domain (Natural Earth; see repository terms)"},
            {"title": "Natural Earth Vector official repository", "url": "https://github.com/nvkelso/natural-earth-vector", "license": "Public domain"},
        ],
        "description": f"{spec['name']}：{spec['subtitle']}的离线地理战场。海岸与河流取自 Natural Earth 10m，并以平滑山系标注围合视野；{len(rows)} 个城市锚点生成虚构地盘，不对应历史或现行行政区。边缘灰色陆地是本局未设锚点的背景，不参与地盘邻接。",
    }
    return data


def main() -> None:
    land_path, rivers_path, _countries_path, run_dir, relief_tif = stage_sources()
    try:
        land = shape(shapefile.Reader(str(land_path)).shape(0).__geo_interface__)
        river_reader = shapefile.Reader(str(rivers_path), encoding="utf-8")
        maps = [extend_central_background(load_central(), land)]
        for spec in SPECS:
            maps.append(build_map(spec, land, river_reader))
        # Every catalogue map gets an extent-aligned crop of the same public
        # domain relief source.  The existing central ``terrain.webp`` remains
        # untouched for historical compatibility, but is no longer referenced
        # by the generated catalogue.
        for data, spec in zip(maps[1:], SPECS):
            image = build_relief_image({**spec, "background_bounds": tuple(data["backgroundGeoBounds"])}, relief_tif, run_dir)
            data["backgroundImage"] = f"assets/maps/{image.name}"
        central_spec = {"id": "central", "bounds": tuple(maps[0]["bounds"]), "background_bounds": tuple(maps[0]["backgroundGeoBounds"])}
        central_image = build_relief_image(central_spec, relief_tif, run_dir)
        maps[0]["backgroundImage"] = f"assets/maps/{central_image.name}"

        MAP_ASSETS.mkdir(parents=True, exist_ok=True)
        # These JSON mirrors aid inspection and reproducibility.  Runtime uses
        # only the classic inline map-catalog.js below.
        for data in maps:
            atomic_write_text(MAP_ASSETS / f"{data['id']}.json", json.dumps(data, ensure_ascii=False, indent=2))
        catalog_json = json.dumps(maps, ensure_ascii=False, indent=2)
        js = "/* Generated offline campaign maps; no runtime fetch is required. */\n" + "globalThis.MAP_CATALOG = " + catalog_json + ";\n" + "if (typeof module !== 'undefined') module.exports = globalThis.MAP_CATALOG;\n"
        atomic_write_text(ROOT / "map-catalog.js", js)
        summary = {
            "maps": [{"id": data["id"], "regions": len(data["regions"]), "edges": len(data.get("borders", [])), "contextChars": len(data.get("contextPath", "")), "landChars": len(data.get("backgroundPath", ""))} for data in maps],
            "output": str(ROOT / "map-catalog.js"),
            "assets": str(MAP_ASSETS),
            "run": str(run_dir),
        }
        atomic_write_text(SCRATCH / "last-build.json", json.dumps(summary, ensure_ascii=False, indent=2))
        print(json.dumps(summary, ensure_ascii=False, indent=2))
    finally:
        # Keep the parent work directory available for audit but remove only
        # this run's extracted source copy after generation has completed.
        shutil.rmtree(run_dir, ignore_errors=True)


if __name__ == "__main__":
    main()
