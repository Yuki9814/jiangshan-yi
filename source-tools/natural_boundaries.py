"""Generate one organic line per shared border, then rebuild the planar map.

Coasts stay fixed. Every adjacent pair uses the same line, so waviness cannot
leave gaps or overlapping fills. This is cartographic styling, not admin data.
"""

import math
from collections import defaultdict

from shapely.affinity import affine_transform
from shapely.geometry import LineString, Point, Polygon
from shapely.ops import linemerge, polygonize, unary_union


def lines(geometry):
    if geometry.geom_type == 'LineString':
        return [geometry]
    if hasattr(geometry, 'geoms'):
        return [line for part in geometry.geoms for line in lines(part)]
    return []


def noise(position, seed):
    def value(i):
        n = ((i + 104729) * 374761393 + seed * 668265263) & 0xffffffff
        n = ((n ^ (n >> 13)) * 1274126177) & 0xffffffff
        return ((n ^ (n >> 16)) & 0xffffffff) / 2147483647.5 - 1
    i = math.floor(position)
    t = position - i
    t = t * t * (3 - 2 * t)
    return value(i) * (1 - t) + value(i + 1) * t


def organic_cells(cells, bounds, size):
    west, south, east, north = bounds
    width, height = size
    sx, sy = width / (east - west), height / (north - south)
    forward = [sx, 0, 0, -sy, -west * sx, north * sy]
    inverse = [1 / sx, 0, 0, -1 / sy, west, north]
    original = [affine_transform(cell, forward) for cell in cells]
    land = unary_union(original)
    edge_pairs = set()
    arcs = []
    junctions = defaultdict(list)
    for a, cell in enumerate(original):
        for b in range(a + 1, len(original)):
            shared = cell.boundary.intersection(original[b].boundary)
            if shared.length < 0.055:
                continue
            edge_pairs.add((a, b))
            parts = lines(shared)
            merged = parts[0] if len(parts) == 1 else linemerge(parts)
            for part in lines(merged):
                coords = list(part.coords)
                if tuple(coords[0]) > tuple(coords[-1]):
                    coords.reverse()
                line = LineString(coords)
                arc = {'a': a, 'b': b, 'line': line, 'start': coords[0], 'end': coords[-1]}
                index = len(arcs)
                arcs.append(arc)
                for end, target in [('start', 'end'), ('end', 'start')]:
                    p, q = arc[end], arc[target]
                    angle = math.atan2(q[1] - p[1], q[0] - p[0])
                    arc[end + '_angle'] = angle
                    junctions[p].append((angle, index, end))

    # Relax interior three-way junctions towards 120 degrees. Their shared
    # endpoints remain fixed, while departure tangents lose the needle tips.
    for point, incident in junctions.items():
        if len(incident) != 3 or land.boundary.distance(Point(point)) < 0.03:
            continue
        incident.sort()
        phase = sum(angle - i * math.tau / 3 for i, (angle, _, _) in enumerate(incident)) / 3
        for i, (angle, index, end) in enumerate(incident):
            desired = phase + i * math.tau / 3
            delta = (desired - angle + math.pi) % math.tau - math.pi
            arcs[index][end + '_angle'] = angle + delta * 0.82

    for strength in (1.0, 0.8, 0.6, 0.4, 0.25):
        network = [land.boundary]
        for index, arc in enumerate(arcs):
            source = arc['line']
            p, q = arc['start'], arc['end']
            length = source.length
            chord = math.dist(p, q)
            # Preserve tiny coastal links and already intricate shore-derived
            # boundaries. On larger edges, broad bends carry uneven fine detail.
            if length < 2 or chord < 0.01 or length > chord * 1.14:
                network.append(source)
                continue
            seed = 1597 + arc['a'] * 104729 + arc['b'] * 15485863 + index * 37
            h = min(chord * 0.30, 38)
            sa, ea = arc['start_angle'], arc['end_angle']
            original_angle = math.atan2(q[1] - p[1], q[0] - p[0])
            sa = original_angle + ((sa - original_angle + math.pi) % math.tau - math.pi) * strength
            reverse = original_angle + math.pi
            ea = reverse + ((ea - reverse + math.pi) % math.tau - math.pi) * strength
            c1 = (p[0] + math.cos(sa) * h, p[1] + math.sin(sa) * h)
            c2 = (q[0] + math.cos(ea) * h, q[1] + math.sin(ea) * h)
            nx, ny = -(q[1] - p[1]) / chord, (q[0] - p[0]) / chord
            amount = min(1, chord / 35) * strength
            points = []
            count = max(5, math.ceil(length / 1.35))
            for step in range(count + 1):
                t = step / count
                u = 1 - t
                x = u**3 * p[0] + 3*u*u*t*c1[0] + 3*u*t*t*c2[0] + t**3*q[0]
                y = u**3 * p[1] + 3*u*u*t*c1[1] + 3*u*t*t*c2[1] + t**3*q[1]
                s = t * length
                displacement = (9.0 * noise(s/48 + 0.37, seed)
                                + 5.0 * noise(s/17 + 0.79, seed+11)
                                + 1.9 * noise(s/5.5 + 0.21, seed+23)
                                + 0.55 * noise(s/2.2 + 0.63, seed+47))
                displacement *= math.sin(math.pi*t)**1.3 * amount
                points.append((x+nx*displacement, y+ny*displacement))
            points[0], points[-1] = p, q
            network.append(LineString(points))

        rebuilt = [poly for poly in polygonize(unary_union(network))
                   if poly.area > 0.001 and land.covers(poly.representative_point())]
        if len(rebuilt) != len(cells):
            continue
        # Representative points can sit close to a former straight edge.
        # Match by area overlap rather than letting a moved border reassign an
        # entire region merely because it crosses that incidental label point.
        assigned = [max(rebuilt, key=lambda poly: poly.intersection(cell).area)
                    for cell in original]
        if len(assigned) != len(cells) or len({poly.wkb for poly in assigned}) != len(cells):
            continue
        actual_pairs = {(a,b) for a in range(len(cells)) for b in range(a+1,len(cells))
                        if assigned[a].boundary.intersection(assigned[b].boundary).length > 0.055}
        if actual_pairs != edge_pairs:
            continue
        if not all(poly.is_valid and isinstance(poly, Polygon) for poly in assigned):
            continue
        if unary_union(assigned).symmetric_difference(land).area > 0.01:
            continue
        return [affine_transform(poly, inverse) for poly in assigned], {
            'style': 'organic-shared-borders', 'version': 1,
            'strength': strength, 'arcs': len(arcs), 'sharedEdges': len(edge_pairs),
            'coastlinePreserved': True, 'topologyPreserved': True,
        }
    raise RuntimeError('Could not naturalize borders while preserving the planar map')
