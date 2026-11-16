"""Draws the app icons for the installed website (Improvements 1, #9).

    python scripts/make-icons.py        (from engine/frontend, needs Pillow)

It writes public/icons/: icon-192.png and icon-512.png (the mark on a rounded Navy square, for
browsers that draw the icon as it is), icon-maskable-512.png (the mark on a full Navy square, with
the mark inside the middle 60% so a phone may cut it to a circle or a squircle), and
apple-touch-icon.png (180px, a full square: iOS rounds it itself).

The mark is the one in public/favicon.svg: two contour lines, in Contour's cream, on Navy
(#233A56, `--primary`). The colours are the tokens' (tokens.css), written here once because an
image cannot read a stylesheet. Run it again only if the mark or Navy changes: the files are kept in
git, and the build does not need Python.
"""

from pathlib import Path

from PIL import Image, ImageDraw

NAVY = (35, 58, 86)  # #233A56, tokens.css --primary
CREAM = (251, 251, 248)  # #FBFBF8, the card colour: the lines of favicon.svg
SCALE = 4  # drawn four times too big and cut down, so the edges are smooth

# favicon.svg is drawn in a 32 x 32 box. Each line is a chain of two cubic curves (SVG "c" then "s").
UPPER = [(6, 21), (10, 13), (14, 13), (16, 18), (18, 23), (22, 23), (26, 16)]
LOWER = [(6, 15), (10, 9), (14, 9), (16, 13), (18, 17), (22, 17), (26, 11)]
STROKE = 2  # in the 32 box


def bezier(p0, p1, p2, p3, steps=48):
    points = []
    for step in range(steps + 1):
        t = step / steps
        u = 1 - t
        points.append(
            (
                u**3 * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t**3 * p3[0],
                u**3 * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t**3 * p3[1],
            )
        )
    return points


def line(control):
    """The two cubic curves of one line, from its 7 points (start, c1, c2, mid, c3, c4, end)."""
    first = bezier(control[0], control[1], control[2], control[3])
    second = bezier(control[3], control[4], control[5], control[6])
    return first + second[1:]


def mark(size, fit):
    """The mark alone, on a transparent square `size` wide, filling `fit` of it, centred."""
    big = size * SCALE
    layer = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    # The lines run from x 6 to 26 and y 9 to 23 of the 32 box: centre them, then scale.
    cx, cy = 16, 16
    unit = big * fit / 20  # the lines are 20 wide in the box
    width = max(1, round(STROKE * unit))
    for control in (UPPER, LOWER):
        points = [((x - cx) * unit + big / 2, (y - cy) * unit + big / 2) for x, y in line(control)]
        # A round dot at every point of the curve: no seams where two bits of line meet, and round
        # ends for free.
        radius = width / 2
        for x, y in points:
            draw.ellipse((x - radius, y - radius, x + radius, y + radius), fill=CREAM)
    return layer.resize((size, size), Image.LANCZOS)


def icon(size, *, rounded, fit):
    big = size * SCALE
    base = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    draw = ImageDraw.Draw(base)
    if rounded:
        draw.rounded_rectangle((0, 0, big - 1, big - 1), radius=round(big * 0.22), fill=NAVY)
    else:
        draw.rectangle((0, 0, big, big), fill=NAVY)
    done = base.resize((size, size), Image.LANCZOS)
    done.alpha_composite(mark(size, fit))
    return done


def main() -> None:
    out = Path(__file__).resolve().parent.parent / "public" / "icons"
    out.mkdir(parents=True, exist_ok=True)
    # The mark fills about 56% of an icon drawn as it is, and about 44% of a maskable one, which a
    # phone may cut to a circle: its safe zone is the middle 80%, and 60% leaves a margin inside it.
    icon(192, rounded=True, fit=0.56).save(out / "icon-192.png", optimize=True)
    icon(512, rounded=True, fit=0.56).save(out / "icon-512.png", optimize=True)
    icon(512, rounded=False, fit=0.44).save(out / "icon-maskable-512.png", optimize=True)
    # iOS rounds the corners itself and wants no transparency.
    icon(180, rounded=False, fit=0.5).convert("RGB").save(out / "apple-touch-icon.png", optimize=True)
    print("wrote", ", ".join(sorted(path.name for path in out.glob("*.png"))))


main()
