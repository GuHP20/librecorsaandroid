"""
Checks of the converters' helpers on small made-up inputs, so they run without any mod source or model:

    python -P scripts/tracks/selftest.py
"""
import contextlib
import io
import json
import os
import struct
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import cv2  # noqa: E402
import numpy as np  # noqa: E402

import build_track as bt  # noqa: E402
import centreline as cl  # noqa: E402
from surface import Raster  # noqa: E402


class Glb:
    """A GLB put together by hand: arrays go into one buffer, each with its own view"""

    def __init__(self):
        self.j = {'asset': {'version': '2.0'}, 'scene': 0, 'scenes': [{'nodes': []}], 'nodes': [], 'meshes': [],
                  'accessors': [], 'bufferViews': [], 'materials': []}
        self.bin = bytearray()

    def view(self, arr, target=None):
        while len(self.bin) % 4:
            self.bin += b'\0'
        v = {'buffer': 0, 'byteOffset': len(self.bin), 'byteLength': arr.nbytes}
        if target:
            v['target'] = target
        self.j['bufferViews'].append(v)
        self.bin += arr.tobytes()
        return len(self.j['bufferViews']) - 1

    def accessor(self, arr, typ, target=None):
        comp = {np.dtype(np.float32): 5126, np.dtype(np.uint32): 5125, np.dtype(np.uint16): 5123}[arr.dtype]
        a = {'bufferView': self.view(arr, target), 'componentType': comp, 'count': len(arr), 'type': typ}
        if typ == 'VEC3':
            a['min'] = arr.min(0).tolist()
            a['max'] = arr.max(0).tolist()
        self.j['accessors'].append(a)
        return len(self.j['accessors']) - 1

    def mesh(self, name, V, F, material):
        prim = {'attributes': {'POSITION': self.accessor(np.asarray(V, np.float32), 'VEC3', 34962)},
                'indices': self.accessor(np.asarray(F, np.uint32).reshape(-1), 'SCALAR', 34963), 'material': material}
        self.j['meshes'].append({'name': name, 'primitives': [prim]})
        self.j['nodes'].append({'name': name, 'mesh': len(self.j['meshes']) - 1})
        self.j['scenes'][0]['nodes'].append(len(self.j['nodes']) - 1)
        return prim

    def save(self, path):
        self.j['buffers'] = [{'byteLength': len(self.bin)}]
        js = json.dumps(self.j).encode()
        js += b' ' * ((4 - len(js) % 4) % 4)
        bn = bytes(self.bin) + b'\0' * ((4 - len(self.bin) % 4) % 4)
        with open(path, 'wb') as f:
            f.write(struct.pack('<III', 0x46546C67, 2, 28 + len(js) + len(bn)))
            f.write(struct.pack('<II', len(js), 0x4E4F534A) + js)
            f.write(struct.pack('<II', len(bn), 0x004E4942) + bn)


def oval_masks(apart):
    """A narrow oval's masks: straights `apart` m apart (the start one on z = 0), 12 m wide, and a road-only apron
    beside the start"""
    R = Raster(np.array([-200.0, -200.0]), np.array([200.0, 200.0]), 0.5)
    trace = R.zeros()
    rad = apart / 2
    pts = [[x, 0.0] for x in np.linspace(-100, 100, 201)]
    pts += [[100 + rad * np.sin(a), rad - rad * np.cos(a)] for a in np.linspace(0, np.pi, 60)[1:]]
    pts += [[x, apart] for x in np.linspace(100, -100, 201)[1:]]
    pts += [[-100 - rad * np.sin(a), rad + rad * np.cos(a)] for a in np.linspace(0, np.pi, 60)[1:-1]]
    cv2.polylines(trace, [np.round(R.to_px(np.array(pts))).astype(np.int32)], True, 255, 24)
    road = trace.copy()
    apron = np.round(R.to_px(np.array([[-30, -6], [30, -6], [30, -11], [-30, -11]]))).astype(np.int32)
    cv2.fillConvexPoly(road, apron, 255)
    return R, trace, road


def test_route_start_cut():
    """With no waypoints the road is cut across the start. The cut ends 3 m past the paving, also with `bridgeCost`
    (every cell finite), so the back straight 40 m away stays open and the lap is routed on the road"""
    for apart in (40.0, 120.0):
        R, trace, road = oval_masks(apart)
        for bridge in (None, 400):
            path = cl.route(R, trace, road, [0.0, 0.0], [10.0, 0.0], [], bridge_cost=bridge)
            on_road = (R.sample(road, path) > 0).mean()
            assert on_road > 0.99, f'straights {apart} m apart, bridgeCost {bridge}: {on_road:.0%} of the route on the road'


def stadium(r0, half, n=2000):
    """A stadium's centre line driven anticlockwise seen from above (left turns, the outside on the right): straights
    on z = -r0 and z = r0 from x = -half to half. Returns its points, their right vectors and the distance along it"""
    L1, La = 2 * half, np.pi * r0
    s = np.linspace(0, 2 * L1 + 2 * La, n, endpoint=False)
    P, T = np.empty((n, 2)), np.empty((n, 2))
    for i, v in enumerate(s):
        if v < L1:
            P[i], T[i] = (half - v, -r0), (-1, 0)
        elif v < L1 + La:
            a = (v - L1) / r0
            P[i], T[i] = (-half - r0 * np.sin(a), -r0 * np.cos(a)), (-np.cos(a), np.sin(a))
        elif v < 2 * L1 + La:
            P[i], T[i] = (-half + v - L1 - La, r0), (1, 0)
        else:
            a = (v - 2 * L1 - La) / r0
            P[i], T[i] = (half + r0 * np.sin(a), r0 * np.cos(a)), (np.cos(a), -np.sin(a))
    return P, np.stack([-T[:, 1], T[:, 0]], 1), s


def band(P, Rt, a, b, keep=None):
    """Quads round the loop P between two lines, each (offset to the right, height); `keep` the quads to make"""
    n = len(P)
    V = np.empty((2 * n, 3))
    for k, (o, y) in enumerate((a, b)):
        V[k::2] = np.column_stack([P[:, 0] + Rt[:, 0] * o, np.full(n, y), P[:, 1] + Rt[:, 1] * o])
    i = np.nonzero(np.ones(n, bool) if keep is None else keep)[0]
    j = (i + 1) % n
    return V, np.stack([2 * i, 2 * j, 2 * i + 1, 2 * i + 1, 2 * j, 2 * j + 1], 1)


def test_wall_lane_oval():
    """build_track.py on an oval with `wallLaneWidthM`: 24 m paving, the outside wall flush with its edge and a 30 m
    hole in that wall. The lane is laid off the wall all round (across the hole too), and the model is scaled so the
    lane, the lap the circuit gets, matches `realLengthM`"""
    r0, half, real = 120.0, 200.0, 1680.0
    P, Rt, s = stadium(r0, half)
    hole = (s > 2 * half + np.pi * r0 + 150) & (s < 2 * half + np.pi * r0 + 180)
    g = Glb()
    g.j['materials'] = [{'name': name, 'pbrMetallicRoughness': {'baseColorFactor': rgb + [1.0]}}
                        for name, rgb in (('asphalt', [0.25] * 3), ('wall', [0.6] * 3), ('grass', [0.2, 0.5, 0.15]))]
    g.mesh('Road', *band(P, Rt, (-12.0, 0.0), (12.0, 0.0)), 0)
    g.mesh('Wall', *band(P, Rt, (12.0, 0.0), (12.0, 1.2), keep=~hole), 1)
    g.mesh('GrassIn', *band(P, Rt, (-40.0, -0.02), (-12.0, -0.02)), 2)
    g.mesh('GrassOut', *band(P, Rt, (12.0, -0.02), (40.0, -0.02)), 2)
    with tempfile.TemporaryDirectory() as tmp:
        g.save(os.path.join(tmp, 'oval.glb'))
        cfg = {'src': os.path.join(tmp, 'oval.glb'), 'trace': [0], 'start': [0.0, -r0], 'ahead': [-10.0, -r0],
               'realLengthM': real, 'wallLaneWidthM': 10.0, 'kerb': [], 'cornerKerbs': False, 'name': 'Oval',
               'layout': 'Oval', 'country': '', 'city': '',
               'credit': {'title': '', 'author': '', 'url': '', 'short': None, 'license': '', 'licenseUrl': ''}}
        with open(os.path.join(tmp, 'tracks.json'), 'w', encoding='utf-8') as f:
            json.dump({'oval': cfg}, f)
        # the build reads its settings next to itself and writes under the repository: both in the temporary folder
        saved = bt.HERE, bt.ROOT, sys.argv
        bt.HERE, bt.ROOT, sys.argv = tmp, tmp, ['build_track.py', 'oval', '--no-glb', '--no-line-opt']
        try:
            with contextlib.redirect_stdout(io.StringIO()):
                bt.main()
        finally:
            bt.HERE, bt.ROOT, sys.argv = saved
        with open(os.path.join(tmp, 'public', 'tracks', 'oval', 'track_data.json'), encoding='utf-8') as f:
            d = json.load(f)
    m = d['metadata']
    assert abs(m['lengthMeters'] / real - 1) < 0.012, f"lap {m['lengthMeters']} m, official {real} m"
    # in the model's own units, the lane's distance from the stadium's spine stays within the wall raster's steps all
    # round the lap (a wall distance of 0 m across the hole put the lane over 4 m left there)
    xz = (np.array([q['p'] for q in d['samples']]) - np.array(m['modelOffset']))[:, [0, 2]] / m['modelScale']
    dist = np.hypot(np.maximum(np.abs(xz[:, 0]) - half, 0.0), xz[:, 1])
    assert dist.max() - dist.min() < 2.5, f'lane {dist.min() - r0:.1f}..{dist.max() - r0:.1f} m right of the centre line'


TESTS = [test_route_start_cut, test_wall_lane_oval]

if __name__ == '__main__':
    failed = 0
    for t in TESTS:
        try:
            t()
            print('PASS', t.__name__)
        except AssertionError as e:
            failed += 1
            print('FAIL', t.__name__, e)
    print(f'{failed} failed' if failed else 'all passed')
    sys.exit(1 if failed else 0)
