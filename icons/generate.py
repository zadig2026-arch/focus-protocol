"""Generate Focus Protocol PWA icons (192 + 512 + maskable 512).
Run: python3 generate.py
"""
from PIL import Image, ImageDraw
import os

HERE = os.path.dirname(os.path.abspath(__file__))

BG = (30, 64, 175)   # #1e40af ocean blue
WHITE = (255, 255, 255)


def make_icon(size, filename, safe_margin=0.0):
    """Draw a focus-target icon. safe_margin = fraction of canvas kept as background (for maskable)."""
    img = Image.new('RGB', (size, size), BG)
    d = ImageDraw.Draw(img)

    # Useable area = size * (1 - 2*safe_margin)
    center = size // 2
    usable = size * (1 - 2 * safe_margin)

    # Outer ring
    outer_r = int(usable * 0.38)
    ring_w = max(2, int(usable * 0.055))
    d.ellipse(
        [center - outer_r, center - outer_r, center + outer_r, center + outer_r],
        outline=WHITE, width=ring_w,
    )

    # Inner ring
    inner_r = int(usable * 0.22)
    d.ellipse(
        [center - inner_r, center - inner_r, center + inner_r, center + inner_r],
        outline=WHITE, width=max(2, int(usable * 0.04)),
    )

    # Center dot
    dot_r = max(3, int(usable * 0.06))
    d.ellipse(
        [center - dot_r, center - dot_r, center + dot_r, center + dot_r],
        fill=WHITE,
    )

    path = os.path.join(HERE, filename)
    img.save(path, 'PNG', optimize=True)
    print(f"  {filename}  {size}x{size}  {os.path.getsize(path) // 1024}KB")


if __name__ == '__main__':
    print('Generating Focus Protocol icons…')
    make_icon(512, 'icon-512.png')
    make_icon(192, 'icon-192.png')
    # Maskable version keeps 10% safe margin (Android adaptive icons)
    make_icon(512, 'icon-512-maskable.png', safe_margin=0.1)
    # Apple touch icon (rounded by iOS automatically — use 180x180 standard size)
    make_icon(180, 'apple-touch-icon.png')
    print('Done.')
