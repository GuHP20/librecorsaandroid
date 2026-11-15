"""
Checks of the converters' helpers on small made-up inputs, so they run without any mod source or model:

    python -P scripts/tracks/selftest.py
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import cv2  # noqa: E402
import numpy as np  # noqa: E402

import centreline as cl  # noqa: E402
from surface import Raster  # noqa: E402


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


TESTS = [test_route_start_cut]

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
