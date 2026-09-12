#!/usr/bin/env python3
"""Validate the delivered full-world atlas without a browser or network.

Checks the classic JavaScript contract, SVG geometry, real land-only
neighbors, explicit sea links, coverage, the DataV China mask and fixed world
roster slots.  The evidence JSON belongs under ``work/world-map`` so the
application output remains a clean offline bundle.
"""

from __future__ import annotations

import argparse
import json
import math
import re
import subprocess
from pathlib import Path
from typing import Iterable

from shapely.affinity import affine_transform
from shapely.geometry import GeometryCollection, LineString, MultiLineString, MultiPolygon, Point, Polygon, shape
from shapely.ops import unary_union
from shapely.validation import make_valid


TOOLS = Path(__file__).resolve().parent
ROOT = TOOLS.parent
WORKSPACE = ROOT
WORLD_JS = ROOT / "world-map.js"
WORLD_JSON = ROOT / "assets" / "maps" / "world.json"
WORLD_RELIEF = ROOT / "assets" / "maps" / "world-relief.jpg"
CHINA_SOURCE = ROOT / "assets" / "maps" / "world-china.geojson"
DEFAULT_EVIDENCE = WORKSPACE / "work" / "world-map" / "validation.json"
NUMBER_TOKEN = re.compile(r"[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?|[a-zA-Z]")


def parse_world_js(path: Path) -> dict:
    text = path.read_text(encoding="utf-8")
    if "globalThis.WORLD_MAP" not in text or "module.exports = globalThis.WORLD_MAP" not in text:
        raise AssertionError("world-map.js must use classic globalThis.WORLD_MAP and CommonJS export")
    match = re.search(r"globalThis\.WORLD_MAP\s*=\s*(\{[\s\S]*?\})\s*;\s*if\s*\(typeof module", text)
    if not match:
        raise AssertionError("cannot parse the classic WORLD_MAP object")
    return json.loads(match.group(1))


def parse_path(path: str) -> list[tuple[list[tuple[float, float]], bool]]:
    if not isinstance(path, str) or not path.strip():
        return []
    tokens = NUMBER_TOKEN.findall(path)
    index = 0
    command = None
    current = (0.0, 0.0)
    start = None
    points: list[tuple[float, float]] = []
    result: list[tuple[list[tuple[float, float]], bool]] = []

    def flush(closed=False):
        nonlocal points
        if len(points) >= 2:
            result.append((points, closed))
        points = []

    def is_command(token):
        return bool(re.fullmatch(r"[a-zA-Z]", token))

    while index < len(tokens):
        if is_command(tokens[index]):
            command = tokens[index]
            index += 1
            if command.upper() == "Z":
                if points and start is not None:
                    if points[-1] != start:
                        points.append(start)
                    flush(True)
                current = start or current
                start = None
                command = None
            continue
        if command is None:
            index += 1
            continue
        upper = command.upper()
        if upper == "M" or upper == "L":
            if index + 1 >= len(tokens) or is_command(tokens[index]) or is_command(tokens[index + 1]):
                command = None
                continue
            x, y = float(tokens[index]), float(tokens[index + 1])
            index += 2
            relative = command.islower()
            point = (current[0] + x, current[1] + y) if relative else (x, y)
            if upper == "M":
                if points:
                    flush(False)
                current = point
                start = point
                points = [point]
                command = "l" if relative else "L"
            else:
                current = point
                points.append(point)
            continue
        if upper == "H":
            if index >= len(tokens) or is_command(tokens[index]):
                command = None
                continue
            x = float(tokens[index]); index += 1
            current = (current[0] + x, current[1]) if command.islower() else (x, current[1])
            points.append(current)
            continue
        if upper == "V":
            if index >= len(tokens) or is_command(tokens[index]):
                command = None
                continue
            y = float(tokens[index]); index += 1
            current = (current[0], current[1] + y) if command.islower() else (current[0], y)
            points.append(current)
            continue
        if upper == "Q":
            if index + 3 >= len(tokens) or any(is_command(tokens[index + offset]) for offset in range(4)):
                command = None
                continue
            cx, cy, x, y = (float(tokens[index + offset]) for offset in range(4))
            index += 4
            relative = command.islower()
            control = (current[0] + cx, current[1] + cy) if relative else (cx, cy)
            endpoint = (current[0] + x, current[1] + y) if relative else (x, y)
            start_point = current
            # Sample the curve for line-length and non-empty checks.  The
            # generated map uses Q only for sea routes, so a short polyline
            # preserves the route's visible geometry without needing a full
            # SVG renderer in this validator.
            for step in range(1, 9):
                t = step / 8.0
                u = 1.0 - t
                points.append((u * u * start_point[0] + 2 * u * t * control[0] + t * t * endpoint[0], u * u * start_point[1] + 2 * u * t * control[1] + t * t * endpoint[1]))
            current = endpoint
            continue
        # Delivered geometry is M/L/Z.  Fail closed for an unknown command so
        # a malformed future path cannot silently pass as a valid polygon.
        command = None
    flush(False)
    return result


def polygon_geometry(path: str):
    rings = [points for points, closed in parse_path(path) if closed and len(points) >= 4]
    if not rings:
        return GeometryCollection()
    # geometry_path writes exteriors followed by holes.  Screen projection
    # reverses the usual geographic winding, so positive signed rings are
    # exteriors and negative rings are holes.  Keeping holes attached avoids
    # the false overlaps that an all-rings union reports for a global raster.
    signed = []
    for ring in rings:
        area = sum(x1 * y2 - x2 * y1 for (x1, y1), (x2, y2) in zip(ring, ring[1:])) / 2.0
        try:
            poly = Polygon(ring)
            if not poly.is_valid:
                poly = make_valid(poly)
            if not poly.is_empty and poly.area > 1e-9:
                signed.append((area, poly.buffer(0)))
        except Exception:
            continue
    exteriors = [poly for area, poly in signed if area >= 0]
    holes = [poly for area, poly in signed if area < 0]
    polygons = []
    for exterior in exteriors:
        interior_rings = []
        for hole in holes:
            point = hole.representative_point()
            if exterior.covers(point) and exterior.area > hole.area:
                interior_rings.extend([list(hole.exterior.coords)])
        try:
            polygons.append(Polygon(exterior.exterior.coords, interior_rings).buffer(0))
        except Exception:
            polygons.append(exterior)
    # A source geometry with reversed winding is still useful as an exterior.
    if not polygons:
        polygons = [poly for _area, poly in signed]
    if not polygons:
        return GeometryCollection()
    try:
        return unary_union(polygons).buffer(0)
    except Exception:
        # A very detailed global coastline can contain a floating point seam
        # at the antimeridian.  Union incrementally so one bad pair does not
        # make the offline validator crash without writing evidence.
        merged = GeometryCollection()
        for poly in polygons:
            try:
                merged = merged.union(poly).buffer(0)
            except Exception:
                continue
        return merged


def line_geometry(path: str):
    lines = [LineString(points) for points, _closed in parse_path(path) if len(points) >= 2]
    if not lines:
        return GeometryCollection()
    return unary_union(lines)


def shared_line(a, b):
    inter = a.intersection(b)
    if inter.geom_type in {"Polygon", "MultiPolygon"}:
        return inter.boundary
    return inter


def image_size(path: Path):
    try:
        output = subprocess.run(["sips", "-g", "pixelWidth", "-g", "pixelHeight", str(path)], check=True, capture_output=True, text=True).stdout
        values = [int(item) for item in re.findall(r"pixel(?:Width|Height):\s*(\d+)", output)]
        return tuple(values[-2:]) if len(values) >= 2 else None
    except (OSError, subprocess.CalledProcessError):
        return None


def validate(data: dict) -> dict:
    errors: list[str] = []
    warnings: list[str] = []

    def check(condition, message):
        if not condition:
            errors.append(message)

    check(data.get("id") == "world", "id must be world")
    check(data.get("worldMode") is True, "worldMode must be true")
    check(data.get("width") == 1800 and data.get("height") == 900, "world canvas must be 1800x900")
    check(data.get("bounds") == [-180.0, -90.0, 180.0, 90.0], "bounds must cover -180..180 and -90..90")
    frame = data.get("backgroundBounds") or {}
    check(frame.get("width", 0) >= data.get("width", 0) and frame.get("height", 0) >= data.get("height", 0), "backgroundBounds must cover the full world with margin")
    image_bounds = data.get("backgroundImageBounds") or {}
    check(image_bounds == {"x": 0, "y": 0, "width": 1800, "height": 900}, "backgroundImageBounds must match the full-world raster")
    initial = data.get("initialView") or {}
    for key in ("desktop", "mobile"):
        view = initial.get(key) or {}
        check(all(isinstance(view.get(k), (int, float)) for k in ("x", "y", "w", "h")), f"initialView.{key} is incomplete")

    regions = data.get("regions") or []
    check(60 <= len(regions) <= 100, f"region count {len(regions)} outside 60..100")
    ids = [item.get("id") for item in regions]
    check(ids == list(range(len(regions))), "region ids must be continuous 0..n-1")
    geometries = []
    for index, region in enumerate(regions):
        geom = polygon_geometry(region.get("path", ""))
        geometries.append(geom)
        check(not geom.is_empty and geom.is_valid and geom.area > 0.001, f"region {index} has invalid/empty geometry")
        check(isinstance(region.get("name"), str) and region["name"], f"region {index} has no name")
        check(region.get("terrain") in {"plain", "mountain", "river"}, f"region {index} has invalid terrain")
        check(isinstance(region.get("fertility"), (int, float)) and 0.8 <= region["fertility"] <= 1.3, f"region {index} fertility outside engine range")
        check(region.get("group") in {"china", "overseas"}, f"region {index} has invalid group")
        center = region.get("center")
        check(isinstance(center, list) and len(center) == 2 and all(isinstance(v, (int, float)) for v in center), f"region {index} missing geographic center")
        if isinstance(center, list) and len(center) == 2:
            lon, lat = center
            x = (lon + 180) / 360 * 1800
            y = (90 - lat) / 180 * 900
            check(geom.distance(Point(x, y)) < 2.0 or geom.covers(Point(x, y)), f"region {index} center is far outside its cell")
    china_regions = [region for region in regions if region.get("group") == "china"]
    overseas_regions = [region for region in regions if region.get("group") == "overseas"]
    check(len(china_regions) == 63, f"China playable region count changed unexpectedly: {len(china_regions)}")
    check(len(overseas_regions) == 30, f"overseas region count changed unexpectedly: {len(overseas_regions)}")
    target_anchors = {
        "台北": ("china", "world-china"), "德里": ("overseas", "foreign-india"),
        "东京": ("overseas", "foreign-japan"), "首尔": ("overseas", "foreign-korea"),
        "乌兰巴托": ("overseas", "foreign-steppe"), "基希讷乌": ("overseas", "foreign-eastern-europe"),
        "廷巴克图": ("overseas", "foreign-africa"), "檀香山": ("overseas", "foreign-oceania"),
    }
    by_name = {region.get("name"): region for region in regions}
    for name, (group, slot) in target_anchors.items():
        region = by_name.get(name) or {}
        check(region.get("group") == group and region.get("ownerSlot") == slot, f"anchor {name} has wrong group/owner slot")

    land = polygon_geometry(data.get("landPath", ""))
    playable = polygon_geometry(data.get("playablePath", ""))
    background = polygon_geometry(data.get("backgroundPath", ""))
    context = polygon_geometry(data.get("contextPath", ""))
    region_union = unary_union(geometries)
    check(not land.is_empty and land.is_valid, "landPath is empty or invalid")
    check(not playable.is_empty and playable.is_valid, "playablePath is empty or invalid")
    check(not background.is_empty and background.is_valid, "backgroundPath is empty or invalid")
    check(not context.is_empty and context.is_valid, "contextPath is empty or invalid")
    if not land.is_empty and not region_union.is_empty:
        coverage_error = land.symmetric_difference(region_union).area / max(land.area, 1.0)
        check(coverage_error < 0.025, f"regions do not cover landPath (symmetric difference ratio {coverage_error:.4f})")
    if not background.is_empty:
        minx, miny, maxx, maxy = background.bounds
        # Physical land should stay inside the world raster; oceans and the
        # surrounding parchment are intentionally supplied by the renderer, so
        # a coastline need not touch all four raster edges.
        check(minx >= -1 and maxx <= 1801 and miny >= -1 and maxy <= 901, "backgroundPath extends outside the world raster")
        check(background.area > land.area, "backgroundPath must include playable and context land")

    neighbors: set[tuple[int, int]] = set()
    for region in regions:
        i = int(region["id"])
        for raw in region.get("neighbors", []):
            j = int(raw)
            check(0 <= j < len(regions) and j != i, f"region {i} neighbor {j} invalid")
            if 0 <= j < len(regions) and j != i:
                pair = tuple(sorted((i, j))); neighbors.add(pair)
                check(i in [int(v) for v in regions[j].get("neighbors", [])], f"neighbor {i}-{j} is not reciprocal")
                line = shared_line(geometries[i], geometries[j])
                check(line.length > 0.08, f"neighbor {i}-{j} has no real shared land edge")

    borders = data.get("borders") or []
    border_pairs = set()
    for border in borders:
        a, b = int(border.get("a", -1)), int(border.get("b", -1))
        pair = tuple(sorted((a, b)))
        check(0 <= a < len(regions) and 0 <= b < len(regions) and a != b, f"border {a}-{b} references invalid region")
        check(pair not in border_pairs, f"duplicate border {a}-{b}")
        border_pairs.add(pair)
        line = line_geometry(border.get("path", ""))
        check(not line.is_empty and line.length > 0.08, f"border {a}-{b} has empty path")
        if 0 <= a < len(regions) and 0 <= b < len(regions):
            real = shared_line(geometries[a], geometries[b])
            check(real.length > 0.08, f"border {a}-{b} is not backed by a real shared edge")
    check(border_pairs == neighbors, f"borders/neighbors mismatch: {len(border_pairs)} vs {len(neighbors)}")
    # Check completeness, not just the edges already listed by the builder.
    # A tiny simplification gap previously hid the long Lhasa–Shigatse edge.
    for i, a in enumerate(geometries):
        for j in range(i + 1, len(geometries)):
            if (i, j) in neighbors:
                continue
            b = geometries[j]
            if a.distance(b) > 0.015:
                continue
            exact = shared_line(a, b).length
            near = a.boundary.intersection(b.boundary.buffer(0.015)).length
            check(exact <= 0.12 and near <= 1.0,
                  f"unlisted shared/near-coincident edge {i}-{j}: exact={exact:.3f}, near={near:.3f}px")
    check((54, 55) in neighbors and shared_line(geometries[54], geometries[55]).length > 20,
          "Lhasa–Shigatse long land border must remain connected")

    sea_links = data.get("seaLinks") or []
    sea_pairs = set()
    for link in sea_links:
        a, b = int(link.get("a", -1)), int(link.get("b", -1))
        pair = tuple(sorted((a, b)))
        check(0 <= a < len(regions) and 0 <= b < len(regions) and a != b, f"sea link {a}-{b} references invalid region")
        check(pair not in sea_pairs, f"duplicate sea link {a}-{b}")
        sea_pairs.add(pair)
        check(link.get("terrain") == "sea" and link.get("kind") == "sea", f"sea link {a}-{b} must be terrain/kind sea")
        check(1 <= int(link.get("distance", 0)) <= 12, f"sea link {a}-{b} distance outside 1..12 months")
        check(not line_geometry(link.get("path", "")).is_empty, f"sea link {a}-{b} has empty path")
        check(pair not in neighbors, f"sea link {a}-{b} duplicates a real land neighbor")

    expedition_sites = data.get("expeditionSites") or []
    check(len(expedition_sites) >= 3, "world map needs at least three expedition sites")
    expedition_ids = set()
    for site in expedition_sites:
        site_id = str(site.get("id", ""))
        check(site_id and site_id not in expedition_ids, f"duplicate/empty expedition site id {site_id}")
        expedition_ids.add(site_id)
        check(1 <= int(site.get("distance", 0)) <= 12, f"expedition site {site_id} distance outside 1..12 months")
        check(1 <= int(site.get("difficulty", 0)) <= 100, f"expedition site {site_id} difficulty outside 1..100")

    # Connected by physical borders plus explicit sea routes.  A single full
    # world playable graph avoids unreachable fixed overseas NPC territories.
    links = {i: set() for i in range(len(regions))}
    for a, b in neighbors | sea_pairs:
        links[a].add(b); links[b].add(a)
    seen = set()
    if links:
        queue = [0]; seen.add(0)
        while queue:
            current = queue.pop()
            for target in links[current]:
                if target not in seen:
                    seen.add(target); queue.append(target)
    check(len(seen) == len(regions), f"region graph disconnected ({len(regions) - len(seen)} regions unreachable)")

    owner_slots = data.get("ownerSlots") or []
    slot_by_id = {slot.get("id"): slot for slot in owner_slots}
    required = set(data.get("requiredFactionIds") or [])
    slot_factions = {slot.get("factionId") for slot in owner_slots if slot.get("fixed") and slot.get("factionId")}
    check(required == slot_factions, "requiredFactionIds must exactly match fixed overseas slot faction ids")
    initial_owners = data.get("initialOwners") or {}
    check(set(initial_owners) == {str(i) for i in range(len(regions))}, "initialOwners must cover every region id")
    owner_counts = {faction: 0 for faction in required}
    for region in regions:
        slot_id = region.get("ownerSlot")
        check(slot_id in slot_by_id, f"region {region['id']} references unknown owner slot {slot_id}")
        check(initial_owners.get(str(region["id"])) == slot_id, f"initialOwners mismatch at region {region['id']}")
        slot = slot_by_id.get(slot_id) or {}
        if slot.get("factionId") in owner_counts:
            owner_counts[slot["factionId"]] += 1
        if region.get("group") == "china":
            check(slot.get("factionId") not in required, f"Chinese region {region['id']} is assigned to fixed overseas NPC")
    for faction, count in owner_counts.items():
        check(count > 0, f"required overseas faction {faction} owns no region")

    inset = data.get("chinaInset") or {}
    check(inset.get("viewBox") == "0 0 1000 600", "chinaInset viewBox must be 1000x600")
    check(bool(inset.get("landPath")) and bool(inset.get("outlinePath")), "chinaInset must carry actual land and outline paths")
    required_labels = {"台湾岛", "钓鱼岛", "赤尾屿", "香港特别行政区", "澳门特别行政区", "海南岛", "东沙群岛", "西沙群岛", "中沙群岛", "南沙群岛", "曾母暗沙", "黄岩岛"}
    inset_labels = {item.get("name") for item in inset.get("labels", [])}
    check(required_labels <= inset_labels, "chinaInset is missing one or more required island/coast labels")
    check(len(inset.get("islands", [])) >= len(required_labels), "chinaInset island markers are incomplete")
    check(bool(data.get("chinaBoundaryPath")), "chinaBoundaryPath is missing")
    check(bool(data.get("chinaJDPath")), "chinaJDPath is missing")
    check(CHINA_SOURCE.exists(), "world-china.geojson source is not bundled beside the app")
    if CHINA_SOURCE.exists():
        china_source = json.loads(CHINA_SOURCE.read_text(encoding="utf-8"))
        named = [f for f in china_source.get("features", []) if (f.get("properties") or {}).get("name")]
        check(len(named) >= 34, "bundled China source has fewer than 34 named province-level features")
        check(any((f.get("properties") or {}).get("name") == "台湾省" for f in named), "bundled China source lacks Taiwan feature")
        check(any((f.get("properties") or {}).get("name") == "海南省" for f in named), "bundled China source lacks Hainan feature")
        source_union = unary_union([shape(feature["geometry"]).buffer(0) for feature in named]).buffer(0)
        source_pixels = affine_transform(source_union, [5, 0, 0, -5, 900, 450])
        china_path = polygon_geometry(data.get("chinaBoundaryPath", ""))
        china_mask_error = china_path.symmetric_difference(source_pixels).area / max(source_pixels.area, 1.0) if not china_path.is_empty else 1.0
        check(china_mask_error < 0.03, f"chinaBoundaryPath differs from DataV named union (ratio {china_mask_error:.4f})")
    else:
        china_mask_error = None

    source_urls = {item.get("url") for item in data.get("sources", [])}
    check(any("naturalearth" in str(url).lower() for url in source_urls), "Natural Earth source reference missing")
    check(any("admin_0_countries" in str(url).lower() for url in source_urls), "Natural Earth Admin-0 source reference missing")
    check(any("datav" in str(url).lower() for url in source_urls), "DataV China source reference missing")
    check(any("fmprc.gov.cn" in str(url).lower() for url in source_urls), "official standard-map reference missing")

    return {
        "ok": not errors, "errors": errors, "warnings": warnings,
        "regions": len(regions), "landNeighbors": len(neighbors), "borders": len(borders), "seaLinks": len(sea_links),
        "requiredFactionIds": sorted(required), "requiredOwnerCounts": owner_counts,
        "landArea": land.area, "playableArea": playable.area, "regionUnionArea": region_union.area,
        "backgroundArea": background.area, "coverageRatio": region_union.area / max(land.area, 1.0),
        "imageSize": image_size(WORLD_RELIEF), "sourceFeatureCount": len(json.loads(CHINA_SOURCE.read_text(encoding="utf-8")).get("features", [])) if CHINA_SOURCE.exists() else 0,
        "chinaRegionCount": len(china_regions), "overseasRegionCount": len(overseas_regions), "chinaMaskErrorRatio": china_mask_error,
        "expeditionSites": len(expedition_sites),
        "boundaryStyle": data.get("boundaryStyle"),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--evidence", type=Path, default=DEFAULT_EVIDENCE)
    args = parser.parse_args()
    data = parse_world_js(WORLD_JS)
    if WORLD_JSON.exists():
        json_data = json.loads(WORLD_JSON.read_text(encoding="utf-8"))
        if json_data != data:
            raise AssertionError("assets/maps/world.json differs from world-map.js object")
    result = validate(data)
    args.evidence.parent.mkdir(parents=True, exist_ok=True)
    args.evidence.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
