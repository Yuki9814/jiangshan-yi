#!/usr/bin/env python3
"""Build the offline map payload for the cross-era generals sandbox.

The only geographic inputs are the Natural Earth 10m archives shipped in the
application's assets directory. They are extracted into a task-specific
work-geography run directory and never overwritten. The generated payload is
dependency-free: the browser receives SVG paths and JSON only, with no
runtime fetch or map-library requirement.
"""

from __future__ import annotations

import json
import math
import tempfile
from zipfile import ZipFile
from pathlib import Path
from typing import Iterable, Sequence

import shapefile
from shapely.geometry import (
    GeometryCollection,
    LineString,
    MultiLineString,
    MultiPolygon,
    Point,
    Polygon,
    box,
    shape,
)
from shapely.ops import unary_union, linemerge, nearest_points
from shapely import set_precision
from natural_boundaries import organic_cells


ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT
ASSETS = ROOT / "assets"
STAGE_ROOT = ROOT / "work-geography"


def stage_source_archives() -> tuple[Path, Path, Path]:
    """Extract the three shipped archives into an isolated run directory."""

    archives = {
        "land": ASSETS / "geography-ne_10m_land.zip",
        "rivers": ASSETS / "geography-ne_10m_rivers_lake_centerlines.zip",
        "countries": ASSETS / "geography-ne_10m_admin_0_countries.zip",
    }
    missing = [str(path) for path in archives.values() if not path.exists()]
    if missing:
        raise FileNotFoundError("missing bundled geography archives: " + ", ".join(missing))
    STAGE_ROOT.mkdir(parents=True, exist_ok=True)
    run_dir = Path(tempfile.mkdtemp(prefix="run-", dir=str(STAGE_ROOT)))
    shapefiles = {}
    for key, archive in archives.items():
        destination = run_dir / key
        destination.mkdir()
        with ZipFile(archive) as zipped:
            zipped.extractall(destination)
        shapefiles[key] = destination
    return (
        shapefiles["land"] / "ne_10m_land.shp",
        shapefiles["rivers"] / "ne_10m_rivers_lake_centerlines.shp",
        shapefiles["countries"] / "ne_10m_admin_0_countries.shp",
    )


LAND_SHP, RIVERS_SHP, COUNTRIES_SHP = stage_source_archives()

WEST, SOUTH, EAST, NORTH = 105.0, 28.0, 122.0, 40.0
WIDTH, HEIGHT = 1000, 780
MAP_BOX = box(WEST, SOUTH, EAST, NORTH)


# The anchors are recognizable cities used only as seeds.  A generated cell
# is a fictional play area, not a historical administrative division.
ANCHORS = [
    ("重庆", 106.5516, 29.5630),
    ("达州", 107.5045, 31.2140),
    ("恩施", 109.4868, 30.2831),
    ("宜昌", 111.2865, 30.6919),
    ("襄阳", 112.1228, 32.0090),
    ("十堰", 110.7879, 32.6469),
    ("西安", 108.9398, 34.3416),
    ("宝鸡", 107.2379, 34.3619),
    ("汉中", 107.0233, 33.0675),
    ("商洛", 109.9186, 33.8739),
    ("洛阳", 112.4540, 34.6197),
    ("南阳", 112.5283, 32.9908),
    ("郑州", 113.6254, 34.7466),
    ("开封", 114.3414, 34.7970),
    ("新乡", 113.9268, 35.3030),
    ("安阳", 114.3931, 36.0976),
    ("商丘", 115.6564, 34.4140),
    ("周口", 114.6969, 33.6261),
    ("信阳", 114.0913, 32.1470),
    ("太原", 112.5489, 37.8706),
    ("临汾", 111.5190, 36.0880),
    ("运城", 110.9980, 35.0267),
    ("石家庄", 114.5149, 38.0428),
    ("邯郸", 114.5391, 36.6256),
    ("邢台", 114.5048, 37.0706),
    ("保定", 115.4646, 38.8739),
    ("沧州", 116.8387, 38.3044),
    ("北京", 116.4074, 39.9042),
    ("天津", 117.2009, 39.0842),
    ("济南", 117.1201, 36.6512),
    ("泰安", 117.0876, 36.2003),
    ("济宁", 116.5871, 35.4149),
    ("菏泽", 115.4807, 35.2338),
    ("潍坊", 119.1618, 36.7069),
    ("青岛", 120.3826, 36.0671),
    ("烟台", 121.4479, 37.4638),
    ("临沂", 118.3564, 35.1047),
    ("徐州", 117.2841, 34.2058),
    ("连云港", 119.2216, 34.5967),
    ("南京", 118.7969, 32.0603),
    ("扬州", 119.4210, 32.3932),
    ("南通", 120.8943, 31.9802),
    ("合肥", 117.2272, 31.8206),
    ("蚌埠", 117.3897, 32.9163),
    ("芜湖", 118.3765, 31.3263),
    ("武汉", 114.3055, 30.5928),
    ("荆门", 112.2048, 31.0354),
    ("岳阳", 113.1287, 29.3573),
    ("长沙", 112.9388, 28.2282),
    ("九江", 115.9928, 29.7120),
    ("南昌", 115.8582, 28.6829),
    ("上海", 121.4737, 31.2304),
]


def fmt(value: float) -> str:
    """Short, stable SVG number formatting."""

    if abs(value) < 0.005:
        value = 0.0
    return f"{value:.2f}".rstrip("0").rstrip(".")


def project(point: Sequence[float], bounds=(WEST, SOUTH, EAST, NORTH), size=(WIDTH, HEIGHT)) -> tuple[float, float]:
    """Equirectangular map projection, adequate for this compact latitude span."""

    w, s, e, n = bounds
    width, height = size
    lon, lat = point[0], point[1]
    return ((lon - w) / (e - w) * width, (n - lat) / (n - s) * height)


def ring_path(coords: Iterable[Sequence[float]], bounds, size) -> str:
    pts = [project(c, bounds, size) for c in coords]
    if not pts:
        return ""
    return "M" + " ".join(f"{fmt(x)},{fmt(y)}" for x, y in pts) + "Z"


def polygon_path(geom, bounds=(WEST, SOUTH, EAST, NORTH), size=(WIDTH, HEIGHT)) -> str:
    """Convert Polygon/MultiPolygon geometry to a fillable SVG path."""

    if geom is None or geom.is_empty:
        return ""
    if isinstance(geom, Polygon):
        rings = [ring_path(geom.exterior.coords, bounds, size)]
        rings += [ring_path(r.coords, bounds, size) for r in geom.interiors]
        return "".join(rings)
    if isinstance(geom, MultiPolygon):
        return "".join(polygon_path(part, bounds, size) for part in geom.geoms)
    if isinstance(geom, GeometryCollection):
        return "".join(polygon_path(part, bounds, size) for part in geom.geoms)
    return ""


def line_path(geom, bounds=(WEST, SOUTH, EAST, NORTH), size=(WIDTH, HEIGHT)) -> str:
    if geom is None or geom.is_empty:
        return ""
    if isinstance(geom, LineString):
        pts = [project(c, bounds, size) for c in geom.coords]
        if len(pts) < 2:
            return ""
        return "M" + " L".join(f"{fmt(x)},{fmt(y)}" for x, y in pts)
    if isinstance(geom, MultiLineString):
        return "".join(line_path(part, bounds, size) for part in geom.geoms)
    if isinstance(geom, GeometryCollection):
        return "".join(line_path(part, bounds, size) for part in geom.geoms)
    return ""


def polygon_parts(geom) -> list[Polygon]:
    if geom is None or geom.is_empty:
        return []
    if isinstance(geom, Polygon):
        return [geom]
    if isinstance(geom, MultiPolygon):
        return list(geom.geoms)
    if isinstance(geom, GeometryCollection):
        return [part for part in geom.geoms if isinstance(part, Polygon)]
    return []


def clip_half_plane(poly: list[tuple[float, float]], a: tuple[float, float], b: tuple[float, float]) -> list[tuple[float, float]]:
    """Keep the points closer to a than b in a convex polygon."""

    if not poly:
        return []
    # |p-a|² <= |p-b|²  ->  2 p.(b-a) <= |b|² - |a|²
    aa = 2.0 * (b[0] - a[0])
    bb = 2.0 * (b[1] - a[1])
    cc = b[0] * b[0] + b[1] * b[1] - a[0] * a[0] - a[1] * a[1]

    def value(p):
        return aa * p[0] + bb * p[1] - cc

    out: list[tuple[float, float]] = []
    prev = poly[-1]
    prev_value = value(prev)
    prev_inside = prev_value <= 1e-10
    for cur in poly:
        cur_value = value(cur)
        cur_inside = cur_value <= 1e-10
        if cur_inside != prev_inside:
            denominator = prev_value - cur_value
            if abs(denominator) > 1e-14:
                t = prev_value / denominator
                out.append((prev[0] + (cur[0] - prev[0]) * t, prev[1] + (cur[1] - prev[1]) * t))
        if cur_inside:
            out.append(cur)
        prev, prev_value, prev_inside = cur, cur_value, cur_inside
    return out


def voronoi_cell(index: int, coords: list[tuple[float, float]]) -> Polygon:
    # A large rectangle avoids a special case for an infinite Voronoi cell;
    # the actual land crop below removes the unused ocean side.
    poly = [(WEST - 1.0, SOUTH - 1.0), (EAST + 1.0, SOUTH - 1.0), (EAST + 1.0, NORTH + 1.0), (WEST - 1.0, NORTH + 1.0)]
    for j, other in enumerate(coords):
        if index == j:
            continue
        poly = clip_half_plane(poly, coords[index], other)
        if len(poly) < 3:
            return Polygon()
    return Polygon(poly).buffer(0)


def river_features() -> list[dict]:
    targets = {
        "黄河": {"Huang", "Yellow"},
        "长江": {"Chang Jiang", "Yangtze"},
        "汉水": {"Han"},
        "淮河": {"Huai"},
        "渭河": {"Wei"},
        "汾河": {"Fen"},
        "赣江": {"Gan"},
        "湘江": {"Xiang"},
        "嘉陵江": {"Jialing"},
    }
    collected = {name: [] for name in targets}
    reader = shapefile.Reader(str(RIVERS_SHP), encoding="utf-8")
    for record, raw_shape in zip(reader.records(), reader.shapes()):
        geom = shape(raw_shape.__geo_interface__)
        if not geom.intersects(MAP_BOX):
            continue
        zh = (record["name_zh"] or "").strip()
        en = (record["name"] or "").strip()
        for target, names in targets.items():
            if zh == target or en in names:
                clipped = geom.intersection(MAP_BOX)
                if not clipped.is_empty:
                    collected[target].append(clipped)
                break

    result = []
    for name, pieces in collected.items():
        if not pieces:
            continue
        unioned = unary_union(pieces)
        merged = (linemerge(unioned) if not isinstance(unioned, LineString) else unioned).simplify(0.006, preserve_topology=True)
        if isinstance(merged, MultiLineString):
            longest = max(merged.geoms, key=lambda line: line.length)
        else:
            longest = merged
        if not isinstance(longest, LineString) or longest.is_empty:
            continue
        label_point = longest.interpolate(0.52, normalized=True)
        result.append({
            "name": name,
            "path": line_path(merged),
            "label": [round(project(label_point.coords[0])[0], 2), round(project(label_point.coords[0])[1], 2)],
        })
    return result


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    ASSETS.mkdir(parents=True, exist_ok=True)

    source_land = shape(shapefile.Reader(str(LAND_SHP)).shape(0).__geo_interface__)
    land_crop = source_land.intersection(MAP_BOX)

    coords = [(lon, lat) for _, lon, lat in ANCHORS]
    raw_cells = [voronoi_cell(i, coords) for i in range(len(coords))]
    cells: list[Polygon] = []
    discarded_fragments = []
    for i, raw in enumerate(raw_cells):
        clipped = raw.intersection(land_crop)
        parts = sorted(polygon_parts(clipped), key=lambda part: part.area, reverse=True)
        cell = parts[0] if parts else Polygon()
        if cell.is_empty or cell.area < 0.015:
            # Every seed is deliberately on mainland, so an empty cell is a
            # data error rather than a reason to silently make an ocean cell.
            raise RuntimeError(f"anchor {i} {ANCHORS[i][0]} produced no usable land cell: {clipped.wkt[:240]}")
        # GEOS can leave the two copies of a mathematically shared Voronoi
        # edge a few floating-point ulps apart.  A 1e-5 degree precision grid
        # makes those boundaries literally identical in the SVG payload
        # while remaining far below the display resolution.
        cells.append(set_precision(cell.simplify(0.002, preserve_topology=True), grid_size=1e-5))
        for part_index, fragment in enumerate(parts[1:], start=1):
            discarded_fragments.append({
                "source": i,
                "part": part_index,
                "geom": set_precision(fragment.simplify(0.002, preserve_topology=True), grid_size=1e-5),
            })

    # A land intersection can be disconnected when a coastal Voronoi cell
    # crosses a bay or an island chain. Put each discarded connected fragment
    # back on the retained region that shares its longest real edge. A
    # fragment with no retained neighbour remains context background (the
    # unseeded northeast edge is the intentional example).
    retained_cells = list(cells)
    assigned_fragments = []
    unassigned_fragments = []
    fragment_audit = []
    for fragment in discarded_fragments:
        candidates = []
        for target, retained in enumerate(retained_cells):
            if target == fragment["source"]:
                continue
            shared_length = fragment["geom"].boundary.intersection(retained.boundary).length
            if shared_length > 0.001:
                candidates.append((shared_length, target))
        if not candidates:
            unassigned_fragments.append(fragment)
            fragment_audit.append({
                "source": fragment["source"],
                "part": fragment["part"],
                "area": fragment["geom"].area,
                "shared": 0.0,
                "target": None,
            })
            continue
        shared_length, target = max(candidates)
        cells[target] = set_precision(unary_union([cells[target], fragment["geom"]]), grid_size=1e-5)
        assigned_fragments.append({
            "source": fragment["source"],
            "target": target,
            "area": fragment["geom"].area,
            "shared": shared_length,
        })
        fragment_audit.append({
            "source": fragment["source"],
            "part": fragment["part"],
            "area": fragment["geom"].area,
            "shared": shared_length,
            "target": target,
        })

    playable_union = unary_union(cells)
    context_for_path = set_precision(
        land_crop.difference(playable_union).simplify(0.002, preserve_topology=True),
        grid_size=1e-5,
    )

    # Replace mechanical half-plane edges with a single natural contour for
    # each neighbouring pair. Rebuild the whole partition from the shared
    # network so fills, selection outlines and war fronts remain identical.
    label_anchors = [cell.representative_point() for cell in cells]
    cells, boundary_style = organic_cells(cells, (WEST, SOUTH, EAST, NORTH), (WIDTH, HEIGHT))
    playable_union = unary_union(cells)

    # True shared-edge neighbours.  A vertex touch is intentionally excluded.
    neighbors = [[] for _ in cells]
    for i in range(len(cells)):
        for j in range(i + 1, len(cells)):
            shared = cells[i].boundary.intersection(cells[j].boundary)
            if shared.length > 0.001:
                neighbors[i].append(j)
                neighbors[j].append(i)
    for ids in neighbors:
        ids.sort()

    # Preserve the exact shared Voronoi/coastline edge used by each adjacency
    # pair so the UI can draw a dynamic front line without reconstructing the
    # geometry.  The endpoint grid above makes both cells contribute the same
    # edge coordinates.
    borders = []
    for a, ids in enumerate(neighbors):
        for b in ids:
            if b <= a:
                continue
            shared = cells[a].boundary.intersection(cells[b].boundary)
            path = line_path(shared)
            if not path:
                raise RuntimeError(f"adjacent regions {a} and {b} have an empty shared-edge path")
            borders.append({"a": a, "b": b, "path": path})

    # Simple terrain classes are cartographic hints for the game.  They are
    # not a claim about historical boundaries or exact physical geography.
    mountain_names = {"重庆", "达州", "恩施", "十堰", "宝鸡", "汉中", "商洛", "太原", "临汾", "运城", "宜昌", "荆门"}
    river_lines = []  # populated below for nearest-line tests
    rivers = river_features()
    reader = shapefile.Reader(str(RIVERS_SHP), encoding="utf-8")
    # Use the major source linework itself for a small proximity hint.
    major_english = {"Huang", "Yellow", "Chang Jiang", "Yangtze", "Han", "Huai", "Wei", "Fen", "Gan", "Xiang", "Jialing"}
    for record, raw_shape in zip(reader.records(), reader.shapes()):
        if (record["name"] or "").strip() in major_english:
            geom = shape(raw_shape.__geo_interface__).intersection(MAP_BOX)
            if not geom.is_empty:
                river_lines.append(geom)
    river_union = unary_union(river_lines) if river_lines else None

    region_rows = []
    for idx, ((name, lon, lat), cell) in enumerate(zip(ANCHORS, cells)):
        representative = label_anchors[idx]
        if not cell.contains(representative):
            interior = cell.buffer(-0.03)
            representative = nearest_points(interior, representative)[0] if not interior.is_empty else cell.representative_point()
        x, y = project((representative.x, representative.y))
        terrain = "mountain" if name in mountain_names else "plain"
        if river_union is not None and river_union.distance(Point(lon, lat)) < 0.18 and terrain != "mountain":
            terrain = "river"
        fertility = {"plain": 1.08, "river": 1.22, "mountain": 0.88}[terrain]
        # Lowlands near the northern and eastern edge remain productive but
        # less uniform than the central plains.
        if terrain == "plain" and (lat > 38.5 or lon > 120.5):
            fertility = 1.0
        region_rows.append({
            "id": idx,
            "name": name,
            "x": round(x, 2),
            "y": round(y, 2),
            "path": polygon_path(cell),
            "neighbors": neighbors[idx],
            "terrain": terrain,
            "fertility": fertility,
            "center": [round(lon, 4), round(lat, 4)],
        })

    inset_bounds = (73.0, 18.0, 135.0, 54.0)
    inset_size = (220, 150)
    # The locator is a country outline, rather than a generic East-Asia land
    # mask.  It is used only as a geographic locator; the game cells above
    # remain an independent fictional partition.
    country_reader = shapefile.Reader(str(COUNTRIES_SHP), encoding="utf-8")
    china_parts = []
    for record, raw_shape in zip(country_reader.records(), country_reader.shapes()):
        if (record["ADMIN"] or "").strip() == "China" and (record["ADM0_A3"] or "").strip() == "CHN":
            china_parts.append(shape(raw_shape.__geo_interface__))
    if not china_parts:
        raise RuntimeError("Natural Earth admin-0 source did not contain the China outline for inset")
    inset_crop = unary_union(china_parts).intersection(box(*inset_bounds)).simplify(0.05, preserve_topology=True)
    inset_range = {
        "x": round((WEST - inset_bounds[0]) / (inset_bounds[2] - inset_bounds[0]) * inset_size[0], 2),
        "y": round((inset_bounds[3] - NORTH) / (inset_bounds[3] - inset_bounds[1]) * inset_size[1], 2),
        "width": round((EAST - WEST) / (inset_bounds[2] - inset_bounds[0]) * inset_size[0], 2),
        "height": round((NORTH - SOUTH) / (inset_bounds[3] - inset_bounds[1]) * inset_size[1], 2),
    }

    mountains = []
    for name, lon, lat, rotation in [
        ("秦岭", 109.4, 33.7, -8),
        ("太行山", 113.7, 37.2, -65),
        ("燕山", 117.1, 39.75, -15),
        ("伏牛山", 111.6, 33.6, -18),
        ("大别山", 115.6, 31.4, -20),
        ("巫山", 110.3, 30.7, -58),
        ("武陵山", 109.7, 29.4, -35),
        ("鲁中山地", 117.5, 36.4, 10),
    ]:
        x, y = project((lon, lat))
        mountains.append({"name": name, "x": round(x, 2), "y": round(y, 2), "rotation": rotation})

    data = {
        "width": WIDTH,
        "height": HEIGHT,
        "bounds": [WEST, SOUTH, EAST, NORTH],
        "regions": region_rows,
        "borders": borders,
        "boundaryStyle": boundary_style,
        # landPath is the playable union; contextPath is real land left
        # outside all seeded regions and should be drawn in a muted background.
        "landPath": polygon_path(playable_union),
        "contextPath": polygon_path(context_for_path),
        "fragmentAudit": {
            "sharedEdgeTolerance": 0.001,
            "significantArea": 0.05,
            "fragments": [
                {
                    "source": ANCHORS[item["source"]][0],
                    "part": item["part"],
                    "area": round(item["area"], 6),
                    "shared": round(item["shared"], 6),
                    "assignedTo": ANCHORS[item["target"]][0] if item["target"] is not None else None,
                }
                for item in fragment_audit
            ],
        },
        "rivers": rivers,
        "mountains": mountains,
        "inset": {
            "landPath": polygon_path(inset_crop, inset_bounds, inset_size),
            "viewBox": "0 0 220 150",
            "range": inset_range,
        },
        "sources": [
            {
                "title": "Natural Earth 10m physical land (v5.1.1 source archive)",
                "url": "https://naciscdn.org/naturalearth/10m/physical/ne_10m_land.zip",
                "license": "Public domain (Natural Earth; see repository terms)",
            },
            {
                "title": "Natural Earth 10m rivers and lake centerlines (v5.0.0 source archive)",
                "url": "https://naciscdn.org/naturalearth/10m/physical/ne_10m_rivers_lake_centerlines.zip",
                "license": "Public domain (Natural Earth; see repository terms)",
            },
            {
                "title": "Natural Earth Vector official repository",
                "url": "https://github.com/nvkelso/natural-earth-vector",
                "license": "Public domain",
            },
            {
                "title": "Natural Earth 10m Admin-0 countries (China locator outline)",
                "url": "https://naciscdn.org/naturalearth/10m/cultural/ne_10m_admin_0_countries.zip",
                "license": "Public domain (Natural Earth; de facto country layer)",
            },
        ],
        "description": "105–122°E、28–40°N 的中原及周边离线地理底图。大陆轮廓与河流来自 Natural Earth 10m 数据；52 个地名用于生成游戏分区，共享边界经过自然曲折处理，不对应历史或现行行政区。",
    }

    payload = json.dumps(data, ensure_ascii=False, indent=2)
    js = "globalThis.MAP_DATA = " + payload + ";\nif (typeof module !== 'undefined') module.exports = globalThis.MAP_DATA;\n"
    (OUT / "map-data.js").write_text(js, encoding="utf-8")

    print(json.dumps({
        "regions": len(region_rows),
        "land_path_chars": len(data["landPath"]),
        "river_count": len(rivers),
        "river_path_chars": sum(len(r["path"]) for r in rivers),
        "neighbor_edges": sum(len(r["neighbors"]) for r in region_rows) // 2,
        "border_edges": len(borders),
        "boundary_style": boundary_style,
        "assigned_fragments": [
            {
                "source": ANCHORS[item["source"]][0],
                "target": ANCHORS[item["target"]][0],
                "area": round(item["area"], 6),
                "shared": round(item["shared"], 6),
            }
            for item in assigned_fragments
        ],
        "context_area": round(context_for_path.area, 6),
        "isolated_regions": [r["name"] for r in region_rows if not r["neighbors"]],
        "output": str(OUT / "map-data.js"),
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
