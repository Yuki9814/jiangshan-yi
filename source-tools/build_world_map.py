#!/usr/bin/env python3
"""Build the offline full-world atlas used by the campaign sandbox.

The world map is deliberately a geographic base rather than an administrative
map.  Natural Earth physical land supplies the coastlines and the bundled Gray
Earth raster supplies continuous relief.  Playable cells are a Voronoi-style
fictional partition around recognisable cities; they are never presented as
modern prefectures, provincial borders, or a historical jurisdiction.

The script is portable inside a copied ``outputs/jiangshan`` directory.  It
only needs the Natural Earth land archive beside the application and either an
existing ``assets/maps/world-relief.jpg`` or the public-domain Gray Earth source
archive in a workspace cache.  Generated files are written atomically so a
double-clicked static page cannot observe half a JavaScript object.
"""

from __future__ import annotations

import json
import math
import os
import re
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Iterable, Sequence
from zipfile import ZipFile

import shapefile
from shapely import make_valid, set_precision
from shapely.affinity import affine_transform
from shapely.geometry import GeometryCollection, LineString, MultiLineString, MultiPolygon, Point, Polygon, box, shape
from shapely.ops import linemerge, polygonize, unary_union


TOOLS = Path(__file__).resolve().parent
ROOT = TOOLS.parent
ASSETS = ROOT / "assets"
MAP_ASSETS = ASSETS / "maps"
WORLD_JS = ROOT / "world-map.js"
WORLD_JSON = MAP_ASSETS / "world.json"
WORKSPACE = ROOT
SCRATCH = WORKSPACE / "work" / "world-map" / "build-cache"

WIDTH, HEIGHT = 1800, 900
WORLD_BOUNDS = (-180.0, -90.0, 180.0, 90.0)
# A symmetric ocean/paper margin keeps the whole equirectangular world visible
# on a 16:9-ish viewport while still giving the pan clamp a real rendered frame.
FRAME = {"x": -140.0, "y": -131.0, "width": 2080.0, "height": 1162.0}

LAND_ARCHIVE = ASSETS / "geography-ne_10m_land.zip"
COUNTRIES_ARCHIVE = ASSETS / "geography-ne_10m_admin_0_countries.zip"
RELIEF_ARCHIVE_CANDIDATES = [
    WORKSPACE / "work" / "campaign-geography" / "GRAY_LR_SR.zip",
    WORKSPACE / "work" / "campaign-ui" / "GRAY_LR_SR.zip",
    MAP_ASSETS / "GRAY_LR_SR.zip",
]
RELIEF_TIF_CANDIDATES = [
    WORKSPACE / "work" / "campaign-ui" / "relief-source" / "GRAY_LR_SR.tif",
    WORKSPACE / "work" / "campaign-geography" / "relief-source" / "GRAY_LR_SR.tif",
]
RELIEF_OUTPUT = MAP_ASSETS / "world-relief.jpg"
CHINA_SOURCE_OUTPUT = MAP_ASSETS / "world-china.geojson"
CHINA_SOURCE_CANDIDATES = [
    CHINA_SOURCE_OUTPUT,
    WORKSPACE / "work" / "world-ui" / "china-datav-full.geojson",
    WORKSPACE / "work" / "world-map" / "sources" / "100000_full.json",
]

SOURCE_URLS = {
    "naturalEarthLand": "https://naciscdn.org/naturalearth/10m/physical/ne_10m_land.zip",
    "naturalEarthCountries": "https://naciscdn.org/naturalearth/10m/cultural/ne_10m_admin_0_countries.zip",
    "naturalEarthGrayEarth": "https://naciscdn.org/naturalearth/10m/raster/GRAY_LR_SR.zip",
    "naturalEarthLicense": "https://github.com/nvkelso/natural-earth-vector/blob/master/LICENSE.md",
    "chinaStandardMap": "https://www.fmprc.gov.cn/web/wjb_673085/zzjg_673183/bjhysws_674671/bhflfg/dtdmxgfl/202303/P020230313585504979937.pdf",
    "tianditu": "https://bzdt.tianditu.gov.cn/",
    "chinaDataV": "https://geo.datav.aliyun.com/areas_v3/bound/100000_full.json",
    "chinaDataVRepository": "https://github.com/wangyang0210/chinaMap/blob/main/100000_full.json",
}

# The foreign cells use country polygons as a geographic guardrail.  Several
# slots intentionally pool neighbouring countries into a broad historical
# region so a mainland graph remains connected, while the selected component
# containing each city keeps an island or distant country from swallowing a
# whole continent.  These are gameplay masks, never claims about a historical
# ruler's actual domain.
FOREIGN_POOL_COUNTRIES = {
    "foreign:eurasia": (
        "ALB", "AND", "AUT", "BEL", "BGR", "BIH", "BLR", "CHE", "CZE", "DEU", "DNK", "ESP", "EST", "FIN",
        "FRA", "GBR", "GRC", "HRV", "HUN", "IRL", "ISL", "ITA", "LTU", "LUX", "LVA", "MDA", "MKD", "MNE",
        "NLD", "NOR", "POL", "PRT", "ROU", "RUS", "SMR", "SRB", "SVK", "SVN", "SWE", "UKR", "VAT",
        "KAZ", "MNG", "UZB", "TKM", "KGZ", "TJK",
    ),
    "foreign:west-asia": ("TUR", "EGY", "CYP", "SYR", "LBN", "ISR", "JOR", "IRQ", "IRN", "SAU", "GEO", "ARM", "AZE"),
    "foreign:india": ("IND", "PAK", "BGD", "NPL", "BTN", "LKA"),
    "foreign:southeast-asia": ("IDN", "MYS", "THA", "VNM", "KHM", "LAO", "MMR", "PHL", "BRN", "TLS", "SGP"),
    "foreign:africa": (
        "DZA", "AGO", "BEN", "BWA", "BFA", "BDI", "CMR", "CAF", "TCD", "COG", "COD", "CIV", "DJI",
        "GNQ", "ERI", "ETH", "GAB", "GMB", "GHA", "GIN", "GNB", "KEN", "LSO", "LBR", "LBY", "MDG", "MWI",
        "MLI", "MRT", "MUS", "MAR", "MOZ", "NAM", "NER", "NGA", "RWA", "STP", "SEN", "SYC", "SLE", "SOM",
        "ZAF", "SSD", "SDN", "SWZ", "TZA", "TGO", "TUN", "UGA", "ZMB", "ZWE", "ESH",
    ),
    "foreign:americas-north": ("CAN", "USA", "MEX", "BLZ", "GTM", "HND", "SLV", "NIC", "CRI", "PAN", "CUB", "HTI", "DOM", "JAM"),
    "foreign:americas-south": ("ARG", "BOL", "BRA", "CHL", "COL", "ECU", "GUY", "PRY", "PER", "SUR", "URY", "VEN", "FLK"),
    "foreign:oceania": ("AUS", "NZL", "PNG", "FJI", "SLB", "VUT", "NCL", "USA"),
    "foreign:japan": ("JPN",),
    "foreign:korea": ("KOR", "PRK"),
}

FOREIGN_SLOT_POOLS = {
    # Continental anchors share an Eurasian mask to retain real land borders;
    # London remains on Britain and Chisinau/Moscow/Ulaanbaatar stay on their
    # own physical components after the anchor cell is selected.
    "foreign-europe": "foreign:eurasia",
    "foreign-steppe": "foreign:eurasia",
    "foreign-eastern-europe": "foreign:eurasia",
    "foreign-west-asia": "foreign:west-asia",
    "foreign-india": "foreign:india",
    "foreign-southeast-asia": "foreign:southeast-asia",
    "foreign-africa": "foreign:africa",
    "foreign-mesoamerica": "foreign:americas-north",
    "foreign-north-america": "foreign:americas-north",
    "foreign-andes": "foreign:americas-south",
    "foreign-south-america": "foreign:americas-south",
    "foreign-oceania": "foreign:oceania",
    "foreign-japan": "foreign:japan",
    "foreign-korea": "foreign:korea",
}


def _line_parts(geometry):
    """Return connected line pieces after merging split GEOS segments.

    Clipping a Voronoi cell against two independently simplified coast masks
    can make one logical shared edge arrive as a MultiLineString of many
    short chords.  Perturbing those chords separately leaves the visible
    boundary almost straight and can lose the reciprocal edge.  Flatten the
    line-bearing parts, then linemerge them so one connected edge gets one
    shared low-frequency curve.
    """
    if geometry is None or geometry.is_empty:
        return []

    def collect(item):
        if item is None or item.is_empty:
            return []
        if isinstance(item, LineString):
            return [item]
        if isinstance(item, MultiLineString):
            return list(item.geoms)
        if isinstance(item, (Polygon, MultiPolygon)):
            return collect(item.boundary)
        if isinstance(item, GeometryCollection):
            result = []
            for child in item.geoms:
                result.extend(collect(child))
            return result
        return []

    lines = collect(geometry)
    if not lines:
        return []
    if len(lines) == 1:
        return lines
    merged = linemerge(unary_union(lines))
    if isinstance(merged, LineString):
        return [merged]
    if isinstance(merged, MultiLineString):
        return list(merged.geoms)
    return collect(merged)


def naturalize_cells(cells: Sequence[Polygon], bounds=WORLD_BOUNDS, size=(WIDTH, HEIGHT), anchors: Sequence[Point] | None = None):
    """Curve shared Voronoi edges while rebuilding a planar partition.

    The accepted campaign helper assumed exact boundary intersections.  World
    cells are clipped by two independently sourced land masks, so GEOS can
    represent a shared edge as a zero-area sliver Polygon.  This version uses
    that sliver's boundary, keeps the same line for both regions, and validates
    the polygonized topology before accepting the wavy pass.
    """
    if len(cells) < 2:
        return list(cells), {"style": "organic-shared-borders", "version": 1, "strength": 1.0, "arcs": 0, "sharedEdges": 0, "coastlinePreserved": True, "topologyPreserved": True}
    west, south, east, north = bounds
    width, height = size
    sx, sy = width / (east - west), height / (north - south)
    forward = [sx, 0, 0, -sy, -west * sx, north * sy]
    inverse = [1 / sx, 0, 0, -1 / sy, west, north]
    # Work on a common pixel grid before looking for shared edges.  The input
    # cells have already been rounded in geographic coordinates, but a
    # 0.001-degree grid corresponds to 0.005 projected pixels.  Round away
    # affine floating-point noise, then clear precision metadata so GEOS can
    # preserve the much finer curved arcs during polygonization.  The shared
    # masks below prevent independent simplification from opening long gaps.
    original = [set_precision(set_precision(affine_transform(cell, forward), 0.005, mode="valid_output"), 0) for cell in cells]
    land = unary_union(original)
    edge_pairs = set()
    arcs = []
    for a in range(len(original)):
        for b in range(a + 1, len(original)):
            shared = original[a].intersection(original[b])
            # A snapped clipped pair can overlap by a small polygon rather
            # than report a zero-area line.  Its boundary is still the only
            # useful partition edge; ignoring it merges the two cells during
            # polygonization (notably Tianjin beside the Bohai coast).
            shared_line = shared.boundary if shared.geom_type in {"Polygon", "MultiPolygon"} else shared
            parts = _line_parts(shared_line)
            for part in parts:
                # Keep even very short city-coast contacts in the
                # polygonization network.  They may not become gameplay
                # neighbours, but dropping one can merge two adjacent cells
                # and move a city anchor into a different polygon.
                if part.length < 0.01:
                    continue
                edge_pairs.add((a, b))
                coords = list(part.coords)
                if tuple(coords[0]) > tuple(coords[-1]):
                    coords.reverse()
                p, q = coords[0], coords[-1]
                chord = math.dist(p, q)
                if chord < 0.01:
                    continue
                arcs.append({"a": a, "b": b, "line": LineString(coords), "start": p, "end": q})

    if not arcs:
        return list(cells), {"style": "organic-shared-borders", "version": 1, "strength": 0.0, "arcs": 0, "sharedEdges": 0, "coastlinePreserved": True, "topologyPreserved": True}

    # Keep coastline and each internal edge in one polygonization network.
    for strength in (1.0, 0.85, 0.7, 0.55, 0.4, 0.25, 0.1, 0.0):
        network = [land.boundary]
        for index, arc in enumerate(arcs):
            source = arc["line"]
            p, q = arc["start"], arc["end"]
            length, chord = source.length, math.dist(p, q)
            if length < 1.0 or chord < 0.25 or length > chord * 1.20:
                network.append(source)
                continue
            seed = 1597 + arc["a"] * 104729 + arc["b"] * 15485863 + index * 37
            h = min(chord * 0.28, 38.0)
            angle = math.atan2(q[1] - p[1], q[0] - p[0])
            c1 = (p[0] + math.cos(angle) * h, p[1] + math.sin(angle) * h)
            c2 = (q[0] - math.cos(angle) * h, q[1] - math.sin(angle) * h)
            nx, ny = -(q[1] - p[1]) / chord, (q[0] - p[0]) / chord
            amount = min(1.0, chord / 40.0) * strength
            points = []
            count = max(5, math.ceil(length / 2.2))
            for step in range(count + 1):
                t = step / count
                u = 1 - t
                x = u**3 * p[0] + 3 * u*u*t*c1[0] + 3 * u*t*t*c2[0] + t**3*q[0]
                y = u**3 * p[1] + 3 * u*u*t*c1[1] + 3 * u*t*t*c2[1] + t**3*q[1]
                # Low-frequency undulation reads as a geographic boundary at
                # world zoom; it is shared exactly because the arc is inserted
                # once into the network.
                s = t * length
                long_edge = min(1.0, max(0.0, (chord - 32.0) / 105.0))
                displacement = (
                    (5.5 + 5.0 * long_edge) * _noise(s / 48 + 0.37, seed)
                    + (2.8 + 2.0 * long_edge) * _noise(s / 17 + 0.79, seed + 11)
                    + (1.0 + 0.8 * long_edge) * _noise(s / 5.5 + 0.21, seed + 23)
                ) * math.sin(math.pi * t) ** 1.28 * amount
                points.append((x + nx * displacement, y + ny * displacement))
            points[0], points[-1] = p, q
            network.append(LineString(points))
        rebuilt = [poly for poly in polygonize(unary_union(network)) if poly.area > 0.003 and land.covers(poly.representative_point())]
        if len(rebuilt) < len(cells):
            continue
        # Match the polygonized pieces to input cells one-to-one.  A tiny
        # coastal sliver can make two cells choose the same maximum overlap;
        # greedy descending scores keeps each real territory represented once.
        scores = sorted(
            ((
                1 if anchors and (poly.covers(anchors[cell_index]) or poly.distance(anchors[cell_index]) < 1e-7) else 0,
                poly.intersection(cell).area,
                cell_index,
                poly_index,
            )
             for cell_index, cell in enumerate(original)
             for poly_index, poly in enumerate(rebuilt)),
            reverse=True,
        )
        assigned_by_cell = {}
        used_polygons = set()
        # Reserve the polygon containing each city anchor before greedy
        # overlap assignment.  Without this reservation two nearly coincident
        # coastline pieces can make a tiny sliver win a cell, moving its label
        # dozens of pixels away from the city while the union still looks
        # superficially complete.
        if anchors:
            candidate_map = {}
            for cell_index, anchor in enumerate(anchors):
                candidates = []
                for poly_index, poly in enumerate(rebuilt):
                    if poly.covers(anchor) or poly.distance(anchor) < 1e-7:
                        candidates.append((poly.intersection(original[cell_index]).area, poly_index))
                candidate_map[cell_index] = candidates
            for cell_index in sorted(candidate_map, key=lambda item: (len(candidate_map[item]), item)):
                candidates = [(score, poly_index) for score, poly_index in candidate_map[cell_index] if poly_index not in used_polygons]
                if candidates:
                    _score, poly_index = max(candidates)
                    assigned_by_cell[cell_index] = rebuilt[poly_index]
                    used_polygons.add(poly_index)
        for _contains_anchor, score, cell_index, poly_index in scores:
            if cell_index in assigned_by_cell or poly_index in used_polygons:
                continue
            assigned_by_cell[cell_index] = rebuilt[poly_index]
            used_polygons.add(poly_index)
            if len(assigned_by_cell) == len(cells):
                break
        if len(assigned_by_cell) != len(cells):
            continue
        assigned = [assigned_by_cell[index] for index in range(len(cells))]
        if anchors and any(poly.distance(anchor) > 2.0 for poly, anchor in zip(assigned, anchors)):
            continue
        actual_pairs = set()
        for a in range(len(assigned)):
            for b in range(a + 1, len(assigned)):
                inter = assigned[a].intersection(assigned[b])
                line = inter.boundary if inter.geom_type == "Polygon" and inter.area < 1e-5 else inter
                if line.length > 0.12:
                    actual_pairs.add((a, b))
        rebuilt_union = unary_union(assigned)
        if rebuilt_union.symmetric_difference(land).area > 1.0:
            continue
        return [affine_transform(poly, inverse) for poly in assigned], {
            "style": "organic-shared-borders", "version": 1, "strength": strength, "arcs": len(arcs), "sharedEdges": len(edge_pairs), "recomputedSharedEdges": len(actual_pairs), "coastlinePreserved": True, "topologyPreserved": True,
        }
    return list(cells), {"style": "organic-shared-borders", "version": 1, "strength": 0.0, "arcs": len(arcs), "sharedEdges": len(edge_pairs), "coastlinePreserved": True, "topologyPreserved": False}


def _noise(position: float, seed: int) -> float:
    def value(index: int) -> float:
        n = ((index + 104729) * 374761393 + seed * 668265263) & 0xFFFFFFFF
        n = ((n ^ (n >> 13)) * 1274126177) & 0xFFFFFFFF
        return ((n ^ (n >> 16)) & 0xFFFFFFFF) / 2147483647.5 - 1
    index = math.floor(position)
    t = position - index
    t = t * t * (3 - 2 * t)
    return value(index) * (1 - t) + value(index + 1) * t


def fmt(value: float) -> str:
    if abs(value) < 0.0005:
        value = 0.0
    return f"{float(value):.3f}".rstrip("0").rstrip(".")


def project(point: Sequence[float], bounds: Sequence[float] = WORLD_BOUNDS, size=(WIDTH, HEIGHT)) -> tuple[float, float]:
    west, south, east, north = bounds
    lon, lat = float(point[0]), float(point[1])
    return ((lon - west) / (east - west) * size[0], (north - lat) / (north - south) * size[1])


def project_ring(coords: Iterable[Sequence[float]], bounds=WORLD_BOUNDS, size=(WIDTH, HEIGHT)) -> list[tuple[float, float]]:
    return [project(c, bounds, size) for c in coords]


def ring_path(coords: Iterable[Sequence[float]], bounds=WORLD_BOUNDS, size=(WIDTH, HEIGHT)) -> str:
    points = project_ring(coords, bounds, size)
    if not points:
        return ""
    return "M" + " ".join(f"{fmt(x)},{fmt(y)}" for x, y in points) + "Z"


def geometry_path(geometry, bounds=WORLD_BOUNDS, size=(WIDTH, HEIGHT), tolerance=0.0) -> str:
    """Serialize polygon exteriors and holes as an SVG path."""
    if geometry is None or geometry.is_empty:
        return ""
    if tolerance:
        geometry = geometry.simplify(tolerance, preserve_topology=True)
    polygons = list(iter_polygons(geometry))
    chunks: list[str] = []
    for polygon in polygons:
        chunks.append(ring_path(polygon.exterior.coords, bounds, size))
        for interior in polygon.interiors:
            chunks.append(ring_path(interior.coords, bounds, size))
    return " ".join(chunk for chunk in chunks if chunk)


def line_geometry_path(geometry, bounds=WORLD_BOUNDS, size=(WIDTH, HEIGHT), tolerance=0.0) -> str:
    """Serialize LineString/MultiLineString geometry for rivers and JD lines."""
    if geometry is None or geometry.is_empty:
        return ""
    if tolerance:
        geometry = geometry.simplify(tolerance, preserve_topology=True)
    lines = []
    if isinstance(geometry, LineString):
        lines = [geometry]
    elif isinstance(geometry, MultiLineString):
        lines = list(geometry.geoms)
    elif isinstance(geometry, Polygon):
        lines = [geometry.boundary]
    elif isinstance(geometry, MultiPolygon):
        lines = [polygon.boundary for polygon in geometry.geoms]
    elif isinstance(geometry, GeometryCollection):
        for part in geometry.geoms:
            if isinstance(part, LineString):
                lines.append(part)
            elif isinstance(part, MultiLineString):
                lines.extend(list(part.geoms))
            elif isinstance(part, Polygon):
                lines.append(part.boundary)
            elif isinstance(part, MultiPolygon):
                lines.extend(polygon.boundary for polygon in part.geoms)
    return " ".join("M" + " ".join(f"{fmt(x)},{fmt(y)}" for x, y in project_ring(line.coords, bounds, size)) for line in lines if len(line.coords) >= 2)


def iter_polygons(geometry):
    if geometry is None or geometry.is_empty:
        return
    if isinstance(geometry, Polygon):
        yield geometry
    elif isinstance(geometry, MultiPolygon):
        for polygon in geometry.geoms:
            yield polygon
    elif isinstance(geometry, GeometryCollection):
        for part in geometry.geoms:
            yield from iter_polygons(part)


def largest_polygon(geometry, anchor: Point | None = None):
    polygons = [p for p in iter_polygons(geometry) if p.area > 1e-8]
    if not polygons:
        return None
    if anchor is not None:
        containing = [p for p in polygons if p.covers(anchor)]
        if containing:
            return max(containing, key=lambda p: p.area)
    return max(polygons, key=lambda p: p.area)


def clip_half_plane(points: list[tuple[float, float]], a: float, b: float, c: float) -> list[tuple[float, float]]:
    """Sutherland–Hodgman clip for a*x+b*y <= c."""
    if not points:
        return []
    out: list[tuple[float, float]] = []
    epsilon = 1e-10
    for start, end in zip(points, points[1:] + points[:1]):
        s_value = a * start[0] + b * start[1] - c
        e_value = a * end[0] + b * end[1] - c
        s_inside = s_value <= epsilon
        e_inside = e_value <= epsilon
        if s_inside and e_inside:
            out.append(end)
        elif s_inside and not e_inside:
            denominator = e_value - s_value
            if abs(denominator) > epsilon:
                t = -s_value / denominator
                out.append((start[0] + (end[0] - start[0]) * t, start[1] + (end[1] - start[1]) * t))
        elif not s_inside and e_inside:
            denominator = e_value - s_value
            if abs(denominator) > epsilon:
                t = -s_value / denominator
                out.append((start[0] + (end[0] - start[0]) * t, start[1] + (end[1] - start[1]) * t))
            out.append(end)
    return out


def voronoi_cell(anchor: tuple[float, float], anchors: Sequence[tuple[float, float]]) -> Polygon | None:
    points = [(WORLD_BOUNDS[0], WORLD_BOUNDS[1]), (WORLD_BOUNDS[2], WORLD_BOUNDS[1]),
              (WORLD_BOUNDS[2], WORLD_BOUNDS[3]), (WORLD_BOUNDS[0], WORLD_BOUNDS[3])]
    px, py = anchor
    for qx, qy in anchors:
        if qx == px and qy == py:
            continue
        # |X-P|² <= |X-Q|² -> 2(Q-P)·X <= |Q|²-|P|².
        aa, bb = 2.0 * (qx - px), 2.0 * (qy - py)
        cc = qx * qx + qy * qy - px * px - py * py
        points = clip_half_plane(points, aa, bb, cc)
        if len(points) < 3:
            return None
    try:
        polygon = Polygon(points)
        return polygon if polygon.is_valid and polygon.area > 1e-8 else polygon.buffer(0)
    except Exception:
        return None


def parse_classic_map(path: Path) -> dict:
    text = path.read_text(encoding="utf-8")
    match = re.search(r"globalThis\.MAP_DATA\s*=\s*(\{[\s\S]*?\})\s*;\s*if\s*\(typeof module", text)
    if not match:
        raise RuntimeError(f"cannot parse classic MAP_DATA from {path}")
    return json.loads(match.group(1))


def stage_land() -> tuple[Path, Path]:
    if not LAND_ARCHIVE.exists():
        raise FileNotFoundError(f"missing bundled land archive: {LAND_ARCHIVE}")
    SCRATCH.mkdir(parents=True, exist_ok=True)
    run = Path(tempfile.mkdtemp(prefix="run-", dir=str(SCRATCH)))
    dest = run / "land"
    dest.mkdir()
    with ZipFile(LAND_ARCHIVE) as zipped:
        zipped.extractall(dest)
    shp = dest / "ne_10m_land.shp"
    if not shp.exists():
        raise FileNotFoundError(f"land archive has no {shp.name}")
    return shp, run


def stage_countries(run_dir: Path) -> Path:
    """Extract the bundled Natural Earth admin-0 archive for country masks."""
    if not COUNTRIES_ARCHIVE.exists():
        raise FileNotFoundError(f"missing bundled country archive: {COUNTRIES_ARCHIVE}")
    dest = run_dir / "countries"
    dest.mkdir()
    with ZipFile(COUNTRIES_ARCHIVE) as zipped:
        zipped.extractall(dest)
    shp = dest / "ne_10m_admin_0_countries.shp"
    if not shp.exists():
        raise FileNotFoundError(f"country archive has no {shp.name}")
    return shp


def load_country_masks(run_dir: Path, non_china_land) -> dict[str, object]:
    """Return Natural Earth country unions clipped away from the China mask."""
    reader = shapefile.Reader(str(stage_countries(run_dir)))
    parts_by_code: dict[str, list[object]] = {}
    for raw_shape, record in zip(reader.iterShapes(), reader.iterRecords()):
        fields = record.as_dict()
        code = str(fields.get("ADM0_A3") or fields.get("ISO_A3") or "").strip()
        if not code or code == "-99":
            continue
        item = shape(raw_shape.__geo_interface__).buffer(0)
        if not item.is_empty:
            parts_by_code.setdefault(code, []).append(item)
    masks = {}
    for code, parts in parts_by_code.items():
        merged = unary_union(parts).buffer(0).intersection(non_china_land).buffer(0)
        if not merged.is_empty:
            masks[code] = merged
    return masks


def build_pool_masks(country_masks: dict[str, object], non_china_land) -> dict[str, object]:
    """Union the country members of each macro pool for fictional cells."""
    result = {}
    for pool_key, codes in FOREIGN_POOL_COUNTRIES.items():
        members = [country_masks[code] for code in codes if code in country_masks]
        if not members:
            raise RuntimeError(f"no Natural Earth country geometry found for {pool_key}")
        merged = unary_union(members).buffer(0).intersection(non_china_land).buffer(0)
        if merged.is_empty:
            raise RuntimeError(f"empty non-China mask for {pool_key}")
        result[pool_key] = merged
    return result


def load_china_geometry() -> tuple[object, object, Path]:
    """Load the cached DataV province geometry and separate its JD line."""
    source = next((path for path in CHINA_SOURCE_CANDIDATES if path.exists()), None)
    if source is None:
        raise FileNotFoundError("missing China province geometry; expected assets/maps/world-china.geojson")
    MAP_ASSETS.mkdir(parents=True, exist_ok=True)
    if source != CHINA_SOURCE_OUTPUT:
        # Keep the exact input beside the app so the static deliverable has no
        # hidden network dependency.  It is copied once and then reused.
        shutil.copy2(source, CHINA_SOURCE_OUTPUT)
    payload = json.loads(source.read_text(encoding="utf-8"))
    polygons = []
    jd_lines = []
    for feature in payload.get("features", []):
        props = feature.get("properties") or {}
        geometry = feature.get("geometry")
        if not geometry:
            continue
        if props.get("adchar") == "JD" or str(props.get("adcode", "")).endswith("_JD"):
            jd_lines.append(shape(geometry))
            continue
        if not props.get("name"):
            continue
        item = shape(geometry).buffer(0)
        if not item.is_empty:
            polygons.append(item)
    if not polygons:
        raise RuntimeError("China DataV geometry contains no named province polygons")
    china = unary_union(polygons).buffer(0)
    jd = unary_union(jd_lines) if jd_lines else GeometryCollection()
    return china, jd, CHINA_SOURCE_OUTPUT


def ensure_relief() -> str:
    """Return the project-relative URL, creating a compact full-world JPEG."""
    MAP_ASSETS.mkdir(parents=True, exist_ok=True)
    if RELIEF_OUTPUT.exists():
        return "assets/maps/world-relief.jpg"
    tif: Path | None = next((p for p in RELIEF_TIF_CANDIDATES if p.exists()), None)
    extracted: Path | None = None
    if tif is None:
        archive = next((p for p in RELIEF_ARCHIVE_CANDIDATES if p.exists()), None)
        if archive is None:
            raise FileNotFoundError("no Gray Earth source archive/TIF and no existing world-relief.jpg")
        temp = Path(tempfile.mkdtemp(prefix="relief-", dir=str(SCRATCH)))
        with ZipFile(archive) as zipped:
            zipped.extractall(temp)
        candidates = list(temp.rglob("GRAY_LR_SR.tif"))
        if not candidates:
            raise FileNotFoundError("Gray Earth archive has no GRAY_LR_SR.tif")
        tif, extracted = candidates[0], temp
    if shutil.which("sips") is None:
        raise RuntimeError("macOS sips is required to rasterise Gray Earth to world-relief.jpg")
    tmp = MAP_ASSETS / ".world-relief.jpg.tmp"
    if tmp.exists():
        tmp.unlink()
    subprocess.run(["sips", "-z", str(HEIGHT), str(WIDTH), "-s", "format", "jpeg", "-s", "formatOptions", "78", str(tif), "--out", str(tmp)], check=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    os.replace(tmp, RELIEF_OUTPUT)
    if extracted is not None:
        shutil.rmtree(extracted, ignore_errors=True)
    return "assets/maps/world-relief.jpg"


def central_anchors() -> list[dict]:
    """Reuse the accepted 52 Chinese city anchors by name and coordinates."""
    source = ROOT / "map-data.js"
    data = parse_classic_map(source)
    result = []
    for item in data.get("regions", []):
        center = item.get("center")
        if not isinstance(center, list) or len(center) != 2:
            raise RuntimeError(f"central region {item.get('id')} has no geographic center")
        result.append({"name": item["name"], "lon": float(center[0]), "lat": float(center[1]), "group": "china", "poolKey": "china", "ownerSlot": "world-china", "regionKey": f"china-{item['name']}"})
    if len(result) != 52:
        raise RuntimeError(f"expected 52 central anchors, found {len(result)}")
    return result


def all_anchors() -> list[dict]:
    anchors = central_anchors()
    anchors.extend([
        {"name": "乌鲁木齐", "lon": 87.6168, "lat": 43.8256, "group": "china", "poolKey": "china", "ownerSlot": "world-china-border", "regionKey": "china-乌鲁木齐"},
        {"name": "喀什", "lon": 75.9898, "lat": 39.4704, "group": "china", "poolKey": "china", "ownerSlot": "world-china-border", "regionKey": "china-喀什"},
        {"name": "拉萨", "lon": 91.1409, "lat": 29.6456, "group": "china", "poolKey": "china", "ownerSlot": "world-china-border", "regionKey": "china-拉萨"},
        {"name": "日喀则", "lon": 88.8980, "lat": 29.2700, "group": "china", "poolKey": "china", "ownerSlot": "world-china-border", "regionKey": "china-日喀则"},
        {"name": "呼和浩特", "lon": 111.7500, "lat": 40.8400, "group": "china", "poolKey": "china", "ownerSlot": "world-china-border", "regionKey": "china-呼和浩特"},
        {"name": "沈阳", "lon": 123.4300, "lat": 41.8000, "group": "china", "poolKey": "china", "ownerSlot": "world-china-border", "regionKey": "china-沈阳"},
        {"name": "哈尔滨", "lon": 126.6400, "lat": 45.7600, "group": "china", "poolKey": "china", "ownerSlot": "world-china-border", "regionKey": "china-哈尔滨"},
        {"name": "台北", "lon": 121.5654, "lat": 25.0330, "group": "china", "poolKey": "china", "ownerSlot": "world-china", "regionKey": "china-台北"},
        {"name": "海口", "lon": 110.1999, "lat": 20.0440, "group": "china", "poolKey": "china", "ownerSlot": "world-china", "regionKey": "china-海口"},
        {"name": "南宁", "lon": 108.3200, "lat": 22.8200, "group": "china", "poolKey": "china", "ownerSlot": "world-china-border", "regionKey": "china-南宁"},
        {"name": "昆明", "lon": 102.8329, "lat": 24.8801, "group": "china", "poolKey": "china", "ownerSlot": "world-china-border", "regionKey": "china-昆明"},
    ])
    foreign = [
        ("伦敦", -0.1276, 51.5072, "foreign-europe", "foreign-london", ("GBR",)),
        ("巴黎", 2.3522, 48.8566, "foreign-europe", "foreign-paris", ("FRA",)),
        ("罗马", 12.4964, 41.9028, "foreign-europe", "foreign-rome", ("ITA",)),
        ("伊斯坦布尔", 28.9784, 41.0082, "foreign-west-asia", "foreign-istanbul", ("TUR",)),
        ("莫斯科", 37.6173, 55.7558, "foreign-steppe", "foreign-moscow", ("RUS",)),
        ("乌兰巴托", 106.9057, 47.8864, "foreign-steppe", "foreign-ulaanbaatar", ("MNG",)),
        ("开罗", 31.2357, 30.0444, "foreign-west-asia", "foreign-cairo", ("EGY",)),
        ("内罗毕", 36.8219, -1.2921, "foreign-africa", "foreign-nairobi", ("KEN",)),
        ("开普敦", 18.4241, -33.9249, "foreign-africa", "foreign-capetown", ("ZAF",)),
        ("廷巴克图", -3.0026, 16.7666, "foreign-africa", "foreign-timbuktu", ("MLI",)),
        ("德里", 77.2090, 28.6139, "foreign-india", "foreign-delhi", ("IND",)),
        ("孟买", 72.8777, 19.0760, "foreign-india", "foreign-mumbai", ("IND",)),
        ("雅加达", 106.8456, -6.2088, "foreign-southeast-asia", "foreign-jakarta", ("IDN",)),
        ("东京", 139.6917, 35.6895, "foreign-japan", "foreign-tokyo", ("JPN",)),
        ("首尔", 126.9780, 37.5665, "foreign-korea", "foreign-seoul", ("KOR", "PRK")),
        ("河内", 105.8342, 21.0278, "foreign-southeast-asia", "foreign-hanoi", ("VNM",)),
        ("吴哥", 103.8667, 13.4125, "foreign-southeast-asia", "foreign-angkor", ("KHM",)),
        ("马尼拉", 120.9842, 14.5995, "foreign-southeast-asia", "foreign-manila", ("PHL",)),
        ("悉尼", 151.2093, -33.8688, "foreign-oceania", "foreign-sydney", ("AUS",)),
        ("奥克兰", 174.7633, -36.8485, "foreign-oceania", "foreign-auckland", ("NZL",)),
        ("檀香山", -157.8583, 21.3069, "foreign-oceania", "foreign-honolulu", ("USA",)),
        ("纽约", -74.0060, 40.7128, "foreign-north-america", "foreign-new-york", ("USA",)),
        ("墨西哥城", -99.1332, 19.4326, "foreign-mesoamerica", "foreign-mexico-city", ("MEX",)),
        ("洛杉矶", -118.2437, 34.0522, "foreign-north-america", "foreign-los-angeles", ("USA",)),
        ("里约热内卢", -43.1729, -22.9068, "foreign-south-america", "foreign-rio", ("BRA",)),
        ("利马", -77.0428, -12.0464, "foreign-andes", "foreign-lima", ("PER",)),
        ("库斯科", -71.9675, -13.5319, "foreign-andes", "foreign-cusco", ("PER",)),
        ("布宜诺斯艾利斯", -58.3816, -34.6037, "foreign-south-america", "foreign-buenos-aires", ("ARG",)),
        ("圣地亚哥", -70.6693, -33.4489, "foreign-andes", "foreign-santiago", ("CHL",)),
        ("基希讷乌", 28.8353, 47.0105, "foreign-eastern-europe", "foreign-chisinau", ("MDA",)),
    ]
    for name, lon, lat, slot, key, country_codes in foreign:
        pool_key = FOREIGN_SLOT_POOLS[slot]
        anchors.append({
            "name": name, "lon": lon, "lat": lat, "group": "overseas", "ownerSlot": slot,
            "regionKey": key, "countryCodes": list(country_codes), "countryMaskCodes": list(FOREIGN_POOL_COUNTRIES[pool_key]),
            "poolKey": pool_key,
        })
    return anchors


MOUNTAIN_REGIONS = {
    "乌鲁木齐", "喀什", "拉萨", "日喀则", "昆明", "西安", "宝鸡", "汉中", "商洛", "太原", "临汾", "运城",
    "伊斯坦布尔", "莫斯科", "乌兰巴托", "内罗毕", "开普敦", "德里", "东京", "首尔", "墨西哥城", "利马", "圣地亚哥",
}
RIVER_REGIONS = {
    "重庆", "宜昌", "武汉", "九江", "南京", "上海", "郑州", "开封", "济南", "伦敦", "巴黎", "罗马", "开罗",
    "德里", "河内", "雅加达", "纽约", "里约热内卢", "布宜诺斯艾利斯", "莫斯科",
}


def terrain_for(anchor: dict) -> tuple[str, float]:
    name = anchor["name"]
    if name in MOUNTAIN_REGIONS:
        terrain = "mountain"
    elif name in RIVER_REGIONS:
        terrain = "river"
    else:
        terrain = "plain"
    # Deterministic regional fertility variation, kept inside the engine's
    # accepted range and intentionally unrelated to modern boundaries.
    value = 1.0 + 0.10 * math.sin(math.radians(anchor["lon"] * 2.7 + anchor["lat"] * 5.3))
    if terrain == "river":
        value += 0.05
    if terrain == "mountain":
        value -= 0.10
    return terrain, round(max(0.8, min(1.3, value)), 2)


def line_path_between(a: dict, b: dict, curvature=0.14) -> str:
    ac, bc = a.get("center", (a.get("lon"), a.get("lat"))), b.get("center", (b.get("lon"), b.get("lat")))
    ax, ay = project(ac)
    bx, by = project(bc)
    dx, dy = bx - ax, by - ay
    length = max(math.hypot(dx, dy), 1.0)
    # A small perpendicular bulge keeps sea routes legible without pretending
    # to be a measured shipping lane.
    mx, my = (ax + bx) / 2, (ay + by) / 2
    nx, ny = -dy / length, dx / length
    bulge = min(80.0, length * curvature)
    cx, cy = mx + nx * bulge, my + ny * bulge
    return f"M{fmt(ax)},{fmt(ay)} Q{fmt(cx)},{fmt(cy)} {fmt(bx)},{fmt(by)}"


def make_sea_links(regions: list[dict], by_name: dict[str, int]) -> list[dict]:
    pairs = [
        ("上海", "台北", 6, "台湾海峡"),
        ("南宁", "海口", 4, "琼州海峡"),
        ("台北", "东京", 7, "东海航路"),
        ("台北", "马尼拉", 6, "吕宋海路"),
        ("东京", "首尔", 5, "东海海路"),
        ("檀香山", "洛杉矶", 10, "北太平洋航路"),
        ("伦敦", "巴黎", 3, "英吉利海峡"),
        ("伦敦", "纽约", 9, "北大西洋航路"),
        ("罗马", "开罗", 5, "地中海航路"),
        ("伊斯坦布尔", "开罗", 6, "东地中海航路"),
        ("孟买", "雅加达", 8, "印度洋航路"),
        ("雅加达", "悉尼", 8, "南洋航路"),
        ("悉尼", "奥克兰", 5, "塔斯曼海航路"),
        ("纽约", "里约热内卢", 10, "大西洋航路"),
        ("里约热内卢", "开普敦", 10, "南大西洋航路"),
        ("里约热内卢", "布宜诺斯艾利斯", 5, "南美东岸航路"),
        ("马尼拉", "雅加达", 8, "南海航路"),
        ("洛杉矶", "东京", 11, "北太平洋航路"),
    ]
    links = []
    for idx, (name_a, name_b, distance, label) in enumerate(pairs):
        if name_a not in by_name or name_b not in by_name:
            continue
        a, b = regions[by_name[name_a]], regions[by_name[name_b]]
        links.append({
            "id": f"sea-{idx:02d}", "a": a["id"], "b": b["id"], "path": line_path_between(a, b),
            "distance": distance, "terrain": "sea", "kind": "sea", "label": label,
        })
    return links


def make_expedition_sites() -> list[dict]:
    """Static chapter objectives; they never create a territorial edge."""
    raw = [
        ("world-silk-pass", "葱岭关隘", "丝路西进方向", 76.2, 39.0, "frontier", 5, 52, {"grain": 32, "troops": 18, "morale": 0.06}, "越过葱岭关隘，争取西域商路的补给。"),
        ("world-north-frontier", "北境边寨", "草原北进方向", 111.0, 48.0, "frontier", 4, 44, {"grain": 28, "troops": 22, "fort": 1.4}, "在北境边寨整备骑军，探查草原交通线。"),
        ("world-med-fortress", "地中海堡垒", "西方远征方向", 35.0, 36.0, "fortress", 8, 68, {"grain": 42, "troops": 26, "development": 1.4}, "远征地中海沿岸堡垒，取得西方航路情报。"),
        ("world-south-route", "南海商路", "南方远征方向", 115.0, 16.0, "league", 7, 58, {"grain": 36, "troops": 20, "morale": 0.08}, "沿南海商路会合地方联盟，换取航路与粮秣。"),
    ]
    sites = []
    for site_id, name, subtitle, lon, lat, kind, distance, difficulty, rewards, description in raw:
        x, y = project((lon, lat))
        sites.append({
            "id": site_id, "name": name, "subtitle": subtitle, "lon": lon, "lat": lat,
            "kind": kind, "x": round(x, 2), "y": round(y, 2), "distance": distance,
            "difficulty": difficulty, "rewards": rewards, "cooldownMonths": 12, "description": description,
        })
    return sites


def inset_project(lon: float, lat: float) -> tuple[float, float]:
    return project((lon, lat), (70.0, 3.0, 145.0, 55.0), (1000, 600))


def make_china_inset(china_geometry, jd_line) -> dict:
    inset_bounds = (70.0, 3.0, 145.0, 55.0)
    # This is the actual cached province geometry, unioned and clipped only to
    # the locator's geographic window.  It includes Taiwan, Hainan, Hong Kong,
    # Macau and the source's associated islands; no hand-drawn outline stands
    # in for a country boundary.
    physical = china_geometry.intersection(box(*inset_bounds))
    labels = [
        {"name": "台湾岛", "lon": 121.1, "lat": 23.6, "dx": 18, "dy": 9, "anchor": "start", "kind": "island"},
        {"name": "钓鱼岛", "lon": 123.48, "lat": 25.75, "dx": 18, "dy": -6, "anchor": "start", "kind": "island"},
        {"name": "赤尾屿", "lon": 124.55, "lat": 25.93, "dx": 18, "dy": 10, "anchor": "start", "kind": "island"},
        {"name": "香港特别行政区", "lon": 114.17, "lat": 22.32, "dx": 17, "dy": -7, "anchor": "start", "kind": "coast"},
        {"name": "澳门特别行政区", "lon": 113.54, "lat": 22.20, "dx": -15, "dy": 15, "anchor": "end", "kind": "coast"},
        {"name": "海南岛", "lon": 110.2, "lat": 19.2, "dx": 16, "dy": 12, "anchor": "start", "kind": "island"},
        {"name": "东沙群岛", "lon": 116.7, "lat": 20.7, "dx": 16, "dy": -5, "anchor": "start", "kind": "island"},
        {"name": "西沙群岛", "lon": 112.0, "lat": 16.7, "dx": 16, "dy": 1, "anchor": "start", "kind": "island"},
        {"name": "中沙群岛", "lon": 114.0, "lat": 15.5, "dx": 16, "dy": 7, "anchor": "start", "kind": "island"},
        {"name": "南沙群岛", "lon": 115.0, "lat": 10.5, "dx": 16, "dy": 8, "anchor": "start", "kind": "island"},
        {"name": "曾母暗沙", "lon": 112.3, "lat": 4.0, "dx": 16, "dy": 3, "anchor": "start", "kind": "island"},
        {"name": "黄岩岛", "lon": 117.75, "lat": 15.1, "dx": 16, "dy": -3, "anchor": "start", "kind": "island"},
        {"name": "澎湖列岛", "lon": 119.6, "lat": 23.6, "dx": -16, "dy": 12, "anchor": "end", "kind": "island"},
        {"name": "金门", "lon": 118.4, "lat": 24.45, "dx": 16, "dy": 3, "anchor": "start", "kind": "island"},
        {"name": "马祖列岛", "lon": 119.95, "lat": 26.15, "dx": 16, "dy": -2, "anchor": "start", "kind": "island"},
    ]
    islands = []
    for idx, label in enumerate(labels):
        x, y = inset_project(label["lon"], label["lat"])
        islands.append({
            "id": f"china-inset-{idx:02d}", "name": label["name"], "x": round(x, 2), "y": round(y, 2),
            "r": 5 if label["name"] in {"台湾岛", "海南岛"} else 3.5,
            "group": "china", "kind": label["kind"], "label": {"x": round(x + label["dx"], 2), "y": round(y + label["dy"], 2), "anchor": label["anchor"]},
        })
    # Marker-only South China Sea groups are intentionally separate: no island
    # is connected to mainland regions by a fake land edge.
    return {
        "viewBox": "0 0 1000 600",
        "landPath": geometry_path(physical, inset_bounds, (1000, 600), tolerance=0.01),
        "outlinePath": line_geometry_path(china_geometry.boundary.intersection(box(*inset_bounds)), inset_bounds, (1000, 600), tolerance=0.01),
        # The DataV 100000_JD feature is delivered as thin closed polygons;
        # render their outlines as a separate dashed locator layer, never as
        # playable land or a neighbor edge.
        "jdPath": geometry_path(jd_line.intersection(box(*inset_bounds)), inset_bounds, (1000, 600), tolerance=0.01),
        "islands": islands,
        "labels": [{"name": item["name"], **item["label"], "kind": item["kind"]} for item in islands],
        "title": "中国与重要岛屿定位附图",
        "note": "本附图用于中国区域与重要岛屿定位；边界表现遵循公开标准地图资料的标注要求，不构成审图或现代行政疆界声明。",
    }


def make_rivers() -> list[dict]:
    rivers = {
        "尼罗河": [(31.5, 31.2), (31.0, 29.5), (32.0, 26.0), (33.5, 22.0), (32.5, 16.0), (30.0, 10.5), (31.0, 2.0)],
        "亚马孙河": [(-74.0, -4.0), (-69.0, -3.0), (-64.0, -3.5), (-58.0, -2.5), (-52.0, -1.5), (-49.0, -1.0)],
        "密西西比河": [(-95.0, 47.0), (-92.0, 42.0), (-91.0, 37.0), (-90.0, 32.0), (-89.0, 29.0)],
        "长江": [(91.0, 31.0), (99.0, 30.5), (105.0, 30.0), (111.0, 30.5), (116.0, 31.0), (121.0, 31.2)],
        "黄河": [(95.0, 35.0), (101.0, 37.0), (108.0, 37.5), (112.0, 35.5), (115.0, 36.0), (119.0, 37.0)],
        "恒河": [(78.0, 31.0), (82.0, 28.0), (88.0, 25.5), (92.0, 24.0)],
        "多瑙河": [(8.0, 48.0), (14.0, 48.5), (20.0, 47.5), (25.0, 45.0), (29.0, 45.2)],
        "伏尔加河": [(50.0, 57.0), (47.0, 53.0), (45.0, 49.0), (47.0, 46.0)],
        "刚果河": [(25.0, -5.0), (21.0, -3.0), (17.0, -4.0), (13.0, -6.0)],
        "湄公河": [(97.0, 32.0), (101.0, 25.0), (104.0, 19.0), (105.0, 14.0), (106.0, 10.0)],
    }
    labels = {"尼罗河": (31.0, 22.0), "亚马孙河": (-60.0, -2.0), "密西西比河": (-91.0, 38.0), "长江": (111.0, 30.2), "黄河": (111.0, 37.0), "恒河": (87.0, 25.2), "多瑙河": (20.0, 47.2), "伏尔加河": (47.0, 51.0), "刚果河": (18.0, -4.0), "湄公河": (103.0, 18.0)}
    result = []
    for name, coords in rivers.items():
        points = [project(c) for c in coords]
        path = "M" + " ".join(f"{fmt(x)},{fmt(y)}" for x, y in points)
        lx, ly = project(labels[name])
        result.append({"name": name, "path": path, "label": [round(lx, 1), round(ly, 1)]})
    return result


def make_mountains() -> list[dict]:
    data = [
        ("喜马拉雅山脉", 86.9, 31.0, -10), ("天山山脉", 82.0, 42.5, -18), ("昆仑山脉", 88.0, 36.0, -12),
        ("安第斯山脉", -72.0, -18.0, -15), ("落基山脉", -114.0, 42.0, -18), ("阿尔卑斯山脉", 10.5, 46.4, -15),
        ("高加索山脉", 43.0, 43.2, -20), ("东非高原", 35.0, -2.0, -10), ("大分水岭", 146.0, -27.0, -20),
    ]
    result = []
    for name, lon, lat, rotation in data:
        x, y = project((lon, lat))
        result.append({"name": name, "x": round(x, 1), "y": round(y, 1), "rotation": rotation})
    return result


def build_world() -> dict:
    land_shp, run_dir = stage_land()
    try:
        reader = shapefile.Reader(str(land_shp))
        # The physical archive stores several polygon records (mainland,
        # islands, Antarctic and polar fragments).  Union every valid record;
        # relying on shape(0) silently drops background land at this scale.
        land_parts = []
        for raw_shape in reader.iterShapes():
            item = shape(raw_shape.__geo_interface__).buffer(0)
            if not item.is_empty:
                land_parts.append(item)
        raw_land = unary_union(land_parts).buffer(0)
        if raw_land.is_empty:
            raise RuntimeError("Natural Earth land geometry is empty")
        # Keep coastline detail while avoiding an enormous static string.  The
        # original archive remains the source of truth for rebuilding.
        land = raw_land.simplify(0.012, preserve_topology=True)
        land_background = land.simplify(0.06, preserve_topology=True)
        china_source_geometry, china_jd_line, _china_source = load_china_geometry()
        china_source_geometry = china_source_geometry.simplify(0.003, preserve_topology=True)
        # Province polygons can describe coastal administrative water while
        # the playable layer must remain physical land.  Keep both forms:
        # the source union drives the boundary/inset display, while this
        # Natural Earth intersection drives playable coverage and Voronoi
        # clipping.
        china_geometry = china_source_geometry.intersection(land).buffer(0).simplify(0.003, preserve_topology=True)
        non_china_land = land.difference(china_geometry)
        # Overseas anchors are clipped to Natural Earth admin-0 geometry (or
        # a documented macro union of those countries).  This prevents an
        # India cell from being expanded by a global Voronoi plane into
        # Siberia while retaining real continental borders between nearby
        # foreign anchors.
        country_masks = load_country_masks(run_dir, non_china_land)
        pool_masks = build_pool_masks(country_masks, non_china_land)
        anchors = all_anchors()
        # Keep China and each foreign macro pool independent.  A nearby
        # overseas anchor must not steal a strip of Chinese land before the
        # mask is applied, and vice versa at a national coast.
        coords_by_pool: dict[str, list[tuple[float, float]]] = {}
        for anchor in anchors:
            coords_by_pool.setdefault(anchor["poolKey"], []).append((anchor["lon"], anchor["lat"]))
        # Simplify the common land masks once.  Independently simplifying
        # clipped cells can move just one end of a shared straight edge,
        # creating a sliver between otherwise adjacent territories.
        simplified_masks = {
            key: set_precision(make_valid(mask.simplify(0.008, preserve_topology=True)), 0.001)
            for key, mask in {**pool_masks, "china": china_geometry}.items()
        }
        regions: list[dict] = []
        geometries = []
        for idx, anchor in enumerate(anchors):
            cell = voronoi_cell((anchor["lon"], anchor["lat"]), coords_by_pool[anchor["poolKey"]])
            # China anchors are clipped to the cached DataV province union so
            # fictional Voronoi cells cannot cross the Chinese outer mask;
            # overseas cells use Natural Earth country/macro masks.  Neither
            # path adds modern internal administrative lines to gameplay.
            land_mask = simplified_masks["china" if anchor["group"] == "china" else anchor["poolKey"]]
            candidate = land_mask.intersection(cell) if cell is not None else GeometryCollection()
            point = Point(anchor["lon"], anchor["lat"])
            selected = largest_polygon(candidate, point)
            if selected is None:
                # Coastal city points can sit a fraction outside a 10m land
                # polygon.  Preserve its geographic anchor and use the nearest
                # valid cell component as the playable shape.
                selected = largest_polygon(candidate)
            if selected is None or selected.area < 1e-5:
                raise RuntimeError(f"anchor {anchor['name']} has no playable land cell")
            # Snap every clipped cell to one geographic millidegree grid.  The
            # same Voronoi edge then has identical endpoints on both sides,
            # which makes shared-edge adjacency and border rendering robust
            # across GEOS versions and the rounded static SVG coordinates.
            selected = set_precision(selected, 0.001, mode="valid_output")
            geometries.append(selected)
            terrain, fertility = terrain_for(anchor)
            x, y = project((anchor["lon"], anchor["lat"]))
            regions.append({
                "id": idx, "name": anchor["name"], "x": round(x, 2), "y": round(y, 2),
                "path": geometry_path(selected, WORLD_BOUNDS, (WIDTH, HEIGHT)),
                "neighbors": [], "terrain": terrain, "fertility": fertility,
                "center": [anchor["lon"], anchor["lat"]], "group": anchor["group"],
                "ownerSlot": anchor["ownerSlot"], "regionKey": anchor["regionKey"],
                "poolKey": anchor["poolKey"], "countryCodes": anchor.get("countryCodes", []),
                "countryMaskCodes": anchor.get("countryMaskCodes", []),
                "labelScale": "detail" if anchor["group"] == "china" else "macro",
            })

        pool_styles = {}
        group_styles = {}
        # Naturalize each mask separately so the actual China outer geometry
        # remains a hard coastline and no overseas cell can bend into it.
        for pool_key, ids in ((pool, [i for i, anchor in enumerate(anchors) if anchor["poolKey"] == pool]) for pool in coords_by_pool):
            organic, style = naturalize_cells(
                [geometries[i] for i in ids],
                anchors=[Point(*project((anchors[i]["lon"], anchors[i]["lat"]))) for i in ids],
            )
            if style.get("topologyPreserved") and len(organic) == len(ids):
                for i, cell in zip(ids, organic):
                    geometries[i] = set_precision(cell, 0.001, mode="valid_output")
            pool_styles[pool_key] = style
            group = anchors[ids[0]]["group"]
            group_entry = group_styles.setdefault(group, {"style": "organic-shared-borders", "pools": {}, "coastlinePreserved": True, "topologyPreserved": True})
            group_entry["pools"][pool_key] = style
            group_entry["coastlinePreserved"] = bool(group_entry["coastlinePreserved"] and style.get("coastlinePreserved"))
            group_entry["topologyPreserved"] = bool(group_entry["topologyPreserved"] and style.get("topologyPreserved"))
        boundary_style = {
            "style": "organic-shared-borders", "version": 1,
            "groups": group_styles, "pools": pool_styles,
            "coastlinePreserved": all(item.get("coastlinePreserved") for item in group_styles.values()),
            "topologyPreserved": all(item.get("topologyPreserved") for item in group_styles.values()),
        }

        for region, geometry in zip(regions, geometries):
            region["path"] = geometry_path(geometry, WORLD_BOUNDS, (WIDTH, HEIGHT))

        # Shared-edge adjacency is derived from the actual clipped polygons.
        edge_lengths: dict[tuple[int, int], float] = {}
        border_geometries: dict[tuple[int, int], object] = {}
        for i in range(len(geometries)):
            for j in range(i + 1, len(geometries)):
                # Exact cell boundaries are shared before rounding; the
                # tolerance only suppresses point contacts and tiny coast
                # artifacts that should not create a route.
                shared = geometries[i].intersection(geometries[j])
                # A pair can be represented as a zero-area Polygon after
                # snapping.  Its boundary is the actual common line; using
                # the raw boundary intersection would lose such lines when
                # GEOS stores one endpoint with a sub-millidegree epsilon.
                shared_line = shared.boundary if shared.geom_type == "Polygon" and shared.area < 1e-6 else shared
                length = float(shared_line.length)
                if length > 0.025:
                    edge_lengths[(i, j)] = length
                    border_geometries[(i, j)] = shared_line
                    regions[i]["neighbors"].append(j)
                    regions[j]["neighbors"].append(i)
        for region in regions:
            region["neighbors"].sort()

        playable = unary_union(geometries).buffer(0)
        context = land.difference(playable)
        by_name = {region["name"]: region["id"] for region in regions}
        # A strategic route is only a sea edge when the final land geometry
        # does not already share a physical border.  Broad South American
        # masks can make a coastal pair land-adjacent, and it must not be
        # double-listed as a sea route.
        sea_links = [
            link for link in make_sea_links(regions, by_name)
            if link["b"] not in regions[link["a"]]["neighbors"]
            and link["a"] not in regions[link["b"]]["neighbors"]
        ]

        initial_owners = {str(region["id"]): region["ownerSlot"] for region in regions}
        owner_slots = [
            {"id": "world-china", "label": "中国战区", "kind": "china", "factionId": None, "fixed": False},
            {"id": "world-china-border", "label": "中国边地", "kind": "china-border", "factionId": None, "fixed": False},
            {"id": "foreign-korea", "label": "朝鲜半岛历史势力", "kind": "foreign", "factionId": "gwanggaeto", "fixed": True},
            {"id": "foreign-japan", "label": "日本历史势力", "kind": "foreign", "factionId": "ieyasu", "fixed": True},
            {"id": "foreign-india", "label": "印度历史势力", "kind": "foreign", "factionId": "ashoka", "fixed": True},
            {"id": "foreign-europe", "label": "欧洲历史势力", "kind": "foreign", "factionId": "richard", "fixed": True},
            {"id": "foreign-west-asia", "label": "西亚历史势力", "kind": "foreign", "factionId": "saladin", "fixed": True},
            {"id": "foreign-steppe", "label": "草原历史势力", "kind": "foreign", "factionId": "genghiskhan", "fixed": True},
            {"id": "foreign-eastern-europe", "label": "东欧历史势力", "kind": "foreign", "factionId": "stefan", "fixed": True},
            {"id": "foreign-southeast-asia", "label": "东南亚历史势力", "kind": "foreign", "factionId": "jayavarman7", "fixed": True},
            {"id": "foreign-africa", "label": "非洲历史势力", "kind": "foreign", "factionId": "mansamusa", "fixed": True},
            {"id": "foreign-mesoamerica", "label": "中美历史势力", "kind": "foreign", "factionId": "moctezuma2", "fixed": True},
            {"id": "foreign-andes", "label": "安第斯历史势力", "kind": "foreign", "factionId": "pachacuti", "fixed": True},
            {"id": "foreign-north-america", "label": "北美历史势力", "kind": "foreign", "factionId": "moctezuma2", "fixed": True},
            {"id": "foreign-south-america", "label": "南美历史势力", "kind": "foreign", "factionId": "pachacuti", "fixed": True},
            {"id": "foreign-oceania", "label": "大洋洲历史势力", "kind": "foreign", "factionId": "kamehameha", "fixed": True},
        ]
        china_union = unary_union([geom for geom, anchor in zip(geometries, anchors) if anchor["group"] == "china"])
        china_inset = make_china_inset(china_geometry, china_jd_line)
        focus_china = {"x": round(project((70, 55))[0] - 32, 1), "y": round(project((70, 55))[1] - 28, 1), "width": 390.0, "height": 340.0, "label": "中国与重要岛屿"}

        data = {
            "id": "world", "name": "天下纵横", "subtitle": "全球山海 · 中国精细分区", "worldMode": True,
            "width": WIDTH, "height": HEIGHT, "bounds": list(WORLD_BOUNDS), "backgroundBounds": FRAME,
            "backgroundImageBounds": {"x": 0, "y": 0, "width": WIDTH, "height": HEIGHT},
            "backgroundImage": "assets/maps/world-relief.jpg", "backgroundFill": "#d9dccd", "backgroundStroke": "#8fa495",
            "initialView": {
                "desktop": {"x": FRAME["x"], "y": FRAME["y"], "w": FRAME["width"], "h": FRAME["height"]},
                "mobile": {"x": FRAME["x"], "y": FRAME["y"], "w": FRAME["width"], "h": FRAME["height"]},
            },
            "regions": regions, "boundaryStyle": boundary_style,
            "borders": [{"a": i, "b": j, "path": line_geometry_path(border_geometries[(i, j)], WORLD_BOUNDS, (WIDTH, HEIGHT))} for i, j in sorted(edge_lengths)],
            "landPath": geometry_path(playable, WORLD_BOUNDS, (WIDTH, HEIGHT)),
            "playablePath": geometry_path(playable, WORLD_BOUNDS, (WIDTH, HEIGHT)),
            "backgroundPath": geometry_path(land_background, WORLD_BOUNDS, (WIDTH, HEIGHT)),
            "contextPath": geometry_path(context, WORLD_BOUNDS, (WIDTH, HEIGHT)),
            "chinaBoundaryPath": geometry_path(china_geometry, WORLD_BOUNDS, (WIDTH, HEIGHT), tolerance=0.003),
            "chinaJDPath": geometry_path(china_jd_line, WORLD_BOUNDS, (WIDTH, HEIGHT), tolerance=0.01),
            "contextFill": "#bdc8bb", "seaLinks": sea_links, "expeditionSites": make_expedition_sites(),
            "initialOwners": initial_owners, "ownerSlots": owner_slots,
            # Fixed overseas representatives are supplied by world-characters.js;
            # Chinese player factions remain selectable through the normal pool.
            "requiredFactionIds": ["gwanggaeto", "ieyasu", "ashoka", "saladin", "richard", "genghiskhan", "stefan", "jayavarman7", "mansamusa", "moctezuma2", "pachacuti", "kamehameha"],
            "focusAreas": {"china": focus_china},
            "worldLabels": [
                {"name": "亚洲", "x": 1150, "y": 360, "scale": "macro"}, {"name": "欧洲", "x": 1010, "y": 205, "scale": "macro"},
                {"name": "非洲", "x": 875, "y": 510, "scale": "macro"}, {"name": "北美洲", "x": 350, "y": 335, "scale": "macro"},
                {"name": "南美洲", "x": 560, "y": 640, "scale": "macro"}, {"name": "大洋洲", "x": 1470, "y": 690, "scale": "macro"},
                {"name": "南极大陆", "x": 900, "y": 865, "scale": "macro"},
            ],
            "rivers": make_rivers(), "mountains": make_mountains(),
            "seaLabels": [
                {"name": "太平洋", "x": 1600, "y": 410, "rotation": 8}, {"name": "大西洋", "x": 590, "y": 330, "rotation": -9},
                {"name": "印度洋", "x": 1150, "y": 610, "rotation": -4}, {"name": "北冰洋", "x": 900, "y": 75, "rotation": 0},
            ],
            "chinaInset": china_inset,
            "inset": {"viewBox": china_inset["viewBox"], "landPath": china_inset["landPath"], "range": {"x": 0, "y": 0, "width": 1000, "height": 600}, "label": "中国与重要岛屿定位"},
            "sources": [
                {"title": "Natural Earth 10m Physical Land", "url": SOURCE_URLS["naturalEarthLand"], "license": "Public domain (Natural Earth)"},
                {"title": "Natural Earth 10m Admin-0 Countries", "url": SOURCE_URLS["naturalEarthCountries"], "license": "Public domain (Natural Earth)"},
                {"title": "Natural Earth Gray Earth relief", "url": SOURCE_URLS["naturalEarthGrayEarth"], "license": "Public domain (Natural Earth)"},
                {"title": "Natural Earth license", "url": SOURCE_URLS["naturalEarthLicense"], "license": "Public domain"},
                {"title": "DataV 中国省级几何（离线副本）", "url": SOURCE_URLS["chinaDataV"], "license": "来源数据的公开项目许可口径；本项目仅作本地游戏几何补充"},
                {"title": "DataV 中国地图数据仓库说明", "url": SOURCE_URLS["chinaDataVRepository"], "license": "公开仓库参考"},
                {"title": "2023年版标准地图规范（公开参考）", "url": SOURCE_URLS["chinaStandardMap"], "license": "公开规范参考；本项目未声明审图"},
                {"title": "自然资源部标准地图服务（公开参考）", "url": SOURCE_URLS["tianditu"], "license": "公开服务参考；本项目未声明审图"},
            ],
            "description": "全球单幅等经纬离线沙盘。Natural Earth 物理陆地与 Gray Earth 浅色地形提供连续背景；93 个城市锚点生成虚构战区。中国 52 个原有城市分区继续承担主线，并补充西部、高原、东北、台湾、海南等定位；海外战区按 Natural Earth 国家几何组成文化区域掩膜，固定角色槽位已由 world-characters.js 绑定。regions.neighbors 只表示真实陆地共边，seaLinks 记录可攻打的跨海线路，不把海岛伪接为陆地；expeditionSites 是不改变主地图归属的远征副本。chinaInset 依据公开标准地图资料的岛屿名称与表示规则制作定位附图；它不是现代行政边界或审图结论。",
        }
        return data
    finally:
        shutil.rmtree(run_dir, ignore_errors=True)


def atomic_write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f".{path.name}.tmp")
    tmp.write_text(text, encoding="utf-8")
    os.replace(tmp, path)


def main() -> None:
    relief_url = ensure_relief()
    data = build_world()
    # Keep the generated object internally self-describing if a caller moves
    # the JPEG beside the script.
    data["backgroundImage"] = relief_url
    payload = json.dumps(data, ensure_ascii=False, indent=2) + "\n"
    atomic_write(WORLD_JSON, payload)
    classic = "globalThis.WORLD_MAP = " + payload + ";\nif (typeof module !== 'undefined') module.exports = globalThis.WORLD_MAP;\n"
    atomic_write(WORLD_JS, classic)
    print(json.dumps({
        "worldJs": str(WORLD_JS), "worldJson": str(WORLD_JSON), "relief": str(RELIEF_OUTPUT),
        "regions": len(data["regions"]), "landBorders": len(data["borders"]), "seaLinks": len(data["seaLinks"]),
        "playablePathChars": len(data["playablePath"]), "backgroundPathChars": len(data["backgroundPath"]),
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
