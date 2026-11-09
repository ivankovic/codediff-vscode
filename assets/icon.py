#!/usr/bin/env python3
"""Draws the extension's Marketplace icon.

The icon is a generated file rather than a hand-drawn one so it can be recoloured or resized
without a design tool: `python3 assets/icon.py` rewrites `icon.png` from here.

The picture is a line of code that left one place and arrived at another - a move, which is the
verdict a line-based differ cannot express and the clearest one-glance statement of what this
extension is for. The colours are the ones the extension actually paints with, so the icon and the
highlighting agree.

Two constraints shaped it, both learned by drawing the alternatives and looking at them small:

* It has to survive 32px. The Marketplace header shows 128, but the extensions sidebar, the tab
  strip and search results show it tiny. Richer pictures - two ASTs side by side with their nodes
  matched, a tree with one branch displaced - say more at 128 and turn to grey noise at 32.
* It has to read on both a white Marketplace page and a dark sidebar, hence the opaque slate tile
  rather than a transparent background.

PIL has no antialiasing, so everything is drawn at 4x and downsampled.
"""

import os

from PIL import Image, ImageDraw

WORKING = 512
PUBLISHED = 128

SLATE = (31, 36, 48)
ORANGE = (255, 140, 26)
DIM = (86, 92, 108)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def quadratic(start, control, end, steps=64):
    """The bezier as a polyline. `ImageDraw` has no curve primitive."""
    points = []
    for step in range(steps + 1):
        t = step / steps
        u = 1 - t
        points.append(
            (
                u * u * start[0] + 2 * u * t * control[0] + t * t * end[0],
                u * u * start[1] + 2 * u * t * control[1] + t * t * end[1],
            )
        )
    return points


def draw():
    image = Image.new('RGBA', (WORKING, WORKING), (0, 0, 0, 0))
    canvas = ImageDraw.Draw(image)
    canvas.rounded_rectangle([0, 0, WORKING - 1, WORKING - 1], radius=112, fill=SLATE)

    # Three lines a side. The moved one is first on the left and last on the right, so the arc has
    # somewhere to travel; the rest are dim, because an icon showing every verdict shows none.
    rows = [150, 256, 362]
    for index, y in enumerate(rows):
        canvas.rounded_rectangle([70, y - 26, 202, y + 26], radius=26,
                                 fill=ORANGE if index == 0 else DIM)
        canvas.rounded_rectangle([310, y - 26, 442, y + 26], radius=26,
                                 fill=ORANGE if index == 2 else DIM)

    curve = quadratic((206, 150), (256, 150), (256, 256))
    curve += quadratic((256, 256), (256, 362), (300, 362))[1:]
    canvas.line(curve, fill=ORANGE, width=24, joint='curve')
    canvas.polygon([(318, 362), (286, 342), (286, 382)], fill=ORANGE)

    return image.resize((PUBLISHED, PUBLISHED), Image.LANCZOS)


if __name__ == '__main__':
    out = os.path.join(ROOT, 'icon.png')
    draw().save(out)
    print(f'wrote {out}')
