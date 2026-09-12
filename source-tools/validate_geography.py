#!/usr/bin/env python3
"""Independent checks for the generated, dependency-free map payload."""

import json
import re
from pathlib import Path

from shapely.geometry import LineString, Point, Polygon
from shapely.ops import unary_union


ROOT = Path(__file__).resolve().parent.parent
MAP_FILE = ROOT / "map-data.js"


def read_map():
    text = MAP_FILE.read_text(encoding="utf-8")
    prefix = "globalThis.MAP_DATA = "
    suffix = ";\nif (typeof module !== 'undefined') module.exports = globalThis.MAP_DATA;\n"
    assert text.startswith(prefix) and text.endswith(suffix), "classic global script wrapper missing"
    return json.loads(text[len(prefix) : -len(suffix)])


def path_rings(path):
    rings = []
    for segment in re.findall(r"M([^Z]+)Z", path):
        ring = [tuple(float(value) for value in token.split(",")) for token in segment.split()]
        if len(ring) >= 4:
            rings.append(ring)
    assert rings, "empty path"
    return rings


def path_geometry(path):
    """Rebuild a Polygon/MultiPolygon from the compact SVG ring stream."""

    rings = []
    for ring in path_rings(path):
        raw = Polygon(ring)
        if raw.is_empty or raw.area <= 1e-6:
            continue
        if not raw.is_valid:
            raw = raw.buffer(0)
        if raw.is_empty:
            continue
        if isinstance(raw, Polygon):
            rings.append(list(raw.exterior.coords))
        else:
            rings.extend(list(part.exterior.coords) for part in raw.geoms)
    assert rings, "path has no usable ring"
    ring_polygons = [Polygon(ring) for ring in rings]
    depths = []
    for index, polygon in enumerate(ring_polygons):
        point = polygon.representative_point()
        depths.append(sum(point.within(other) for other_index, other in enumerate(ring_polygons) if other_index != index))
    pieces = []
    for index, (ring, depth) in enumerate(zip(rings, depths)):
        if depth % 2:
            continue
        outer = ring_polygons[index]
        holes = [
            rings[hole_index]
            for hole_index, hole_depth in enumerate(depths)
            if hole_depth == depth + 1 and ring_polygons[hole_index].representative_point().within(outer)
        ]
        piece = Polygon(ring, holes)
        if not piece.is_valid:
            piece = piece.buffer(0)
        if not piece.is_empty:
            pieces.extend(list(piece.geoms) if piece.geom_type == "MultiPolygon" else [piece])
    assert pieces, "path has no exterior ring"
    return unary_union(pieces)


def path_polygon(path):
    # Do not let path_geometry's legacy background repair conceal a newly
    # introduced self-intersection in an interactive region.
    assert all(Polygon(ring).is_valid for ring in path_rings(path)), "self-intersecting region ring"
    geometry = path_geometry(path)
    assert isinstance(geometry, Polygon), "region path must remain one connected polygon"
    return geometry


def main():
    data = read_map()
    regions = data["regions"]
    assert len(regions) == 52
    assert [region["id"] for region in regions] == list(range(52))
    polygons = [path_polygon(region["path"]) for region in regions]
    assert all(p.is_valid and p.area > 1 for p in polygons)
    assert all(0 <= region["x"] <= data["width"] and 0 <= region["y"] <= data["height"] for region in regions)
    assert all(p.buffer(0.01).contains(Point(region["x"], region["y"])) for p, region in zip(polygons, regions))
    assert all(region["terrain"] in {"plain", "mountain", "river"} for region in regions)
    assert all(0.8 <= region["fertility"] <= 1.3 for region in regions)

    edges = set()
    shared_lengths = []
    for region in regions:
        for neighbor in region["neighbors"]:
            assert neighbor != region["id"]
            assert region["id"] in regions[neighbor]["neighbors"], "asymmetric neighbor"
            edge = tuple(sorted((region["id"], neighbor)))
            if edge in edges:
                continue
            edges.add(edge)
            shared = polygons[edge[0]].boundary.intersection(polygons[edge[1]].boundary).length
            assert shared > 0.05, f"neighbor pair {edge} only touches at a vertex"
            shared_lengths.append(shared)

    seen = {0}
    todo = [0]
    while todo:
        index = todo.pop()
        for neighbor in regions[index]["neighbors"]:
            if neighbor not in seen:
                seen.add(neighbor)
                todo.append(neighbor)
    assert len(seen) == len(regions), "neighbor graph is disconnected"

    assert len(data["borders"]) == len(edges), "border count must match unique adjacency count"
    border_pairs = set()
    for border in data["borders"]:
        a, b = border["a"], border["b"]
        assert 0 <= a < len(regions) and 0 <= b < len(regions) and a < b
        assert b in regions[a]["neighbors"] and a in regions[b]["neighbors"]
        assert border["path"]
        border_pairs.add((a, b))
    assert border_pairs == edges, "borders must cover each unique adjacency exactly once"

    actual_edges = set()
    for a, first in enumerate(polygons):
        for b in range(a + 1, len(polygons)):
            second = polygons[b]
            assert first.intersection(second).area < 0.001, f"overlapping regions {a}, {b}"
            if first.boundary.intersection(second.boundary).length > 0.05:
                actual_edges.add((a, b))
    assert actual_edges == edges, "geometry must agree with every engine adjacency"
    for border in data["borders"]:
        pieces = []
        for subpath in border["path"].split("M")[1:]:
            points = [tuple(map(float, point.split(","))) for point in subpath.replace("L", " ").split()]
            if len(points) >= 2:
                pieces.append(LineString(points))
        drawn = unary_union(pieces)
        shared = polygons[border["a"]].boundary.intersection(polygons[border["b"]].boundary)
        assert drawn.equals(shared), f"war front differs from shared border {border['a']}, {border['b']}"

    playable = path_geometry(data["landPath"])
    context = path_geometry(data["contextPath"])
    region_union = unary_union(polygons)
    assert playable.symmetric_difference(region_union).area < 0.01, "landPath must cover exactly the playable regions"
    assert playable.intersection(context).area < 20, "contextPath must stay outside playable land"
    assert context.area > 1, "contextPath must preserve real non-playable land"

    audit = data.get("fragmentAudit")
    assert audit and audit["fragments"], "fragment audit missing"
    tolerance = float(audit["sharedEdgeTolerance"])
    significant = float(audit["significantArea"])
    for fragment in audit["fragments"]:
        if fragment["assignedTo"] is not None:
            assert fragment["shared"] > tolerance and fragment["area"] > 0
        if fragment["area"] >= significant and fragment["shared"] > tolerance:
            assert fragment["assignedTo"] is not None, "significant shared fragment was left outside a region"

    print(json.dumps({
        "regions": len(regions),
        "neighbor_edges": len(edges),
        "border_edges": len(data["borders"]),
        "connected": True,
        "min_shared_edge_px": round(min(shared_lengths), 6),
        "max_shared_edge_px": round(max(shared_lengths), 6),
        "rivers": len(data["rivers"]),
        "mountains": len(data["mountains"]),
        "playable_path_area": round(playable.area, 3),
        "context_path_area": round(context.area, 3),
        "fragment_audit": len(audit["fragments"]),
        "node_wrapper": True,
        "raw_region_rings_valid": True,
        "region_overlaps": 0,
        "uncovered_land_px2": round(playable.difference(region_union).area, 6),
        "front_lines_match_shared_borders": True,
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
