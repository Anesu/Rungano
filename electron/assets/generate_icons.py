"""
Generate Rungano icons.

Outputs:
  - electron/assets/icon.ico       (multi-resolution: 16, 32, 48, 64, 128, 256)
  - electron/assets/tray-icon.png   (32x32 transparent, for system tray)

Design:
  - Dark navy background (#0d1117), matching the app theme
  - 7 vertical bars in a cyan/blue gradient (#58a6ff → #1f6feb) — audio waveform
  - Small orange-yellow particle at the center-left — the "Higgs boson" spark
"""
from pathlib import Path
from PIL import Image, ImageDraw

OUT_DIR = Path(__file__).parent
ICON_PATH = OUT_DIR / "icon.ico"
TRAY_PATH = OUT_DIR / "tray-icon.png"

# Brand palette
BG = (13, 17, 23, 255)        # #0d1117
ACCENT_LIGHT = (88, 166, 255)  # #58a6ff
ACCENT_DEEP = (31, 111, 235)   # #1f6feb
SPARK = (245, 158, 11)        # #f59e0b (orange-yellow)
WHITE = (255, 255, 255, 255)


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3)) + (255,)


def draw_icon(size: int) -> Image.Image:
    img = Image.new("RGBA", (size, size), BG)
    draw = ImageDraw.Draw(img)

    # Audio waveform: 7 vertical bars centered
    n_bars = 7
    # Heights in proportion to size
    heights = [0.30, 0.50, 0.75, 1.00, 0.75, 0.50, 0.30]
    bar_w = max(2, size // 12)
    gap = max(1, size // 24)
    total_w = n_bars * bar_w + (n_bars - 1) * gap
    x0 = (size - total_w) // 2
    cy = size // 2
    for i, h_frac in enumerate(heights):
        bar_h = int(size * h_frac * 0.7)
        x = x0 + i * (bar_w + gap)
        y_top = cy - bar_h // 2
        y_bot = cy + bar_h // 2
        # Gradient: lighter on the left, deeper on the right
        t = i / (n_bars - 1)
        color = lerp(ACCENT_LIGHT, ACCENT_DEEP, t)
        # Rounded rectangle look (use rounded corners when bar is tall enough)
        radius = min(bar_w // 2, bar_h // 2)
        draw.rounded_rectangle(
            [x, y_top, x + bar_w, y_bot],
            radius=radius,
            fill=color,
        )

    # Spark particle — small bright dot to the left of the waveform
    spark_r = max(2, size // 12)
    spark_x = int(size * 0.20)
    spark_y = cy
    # Outer glow (slightly larger, low alpha)
    glow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    glow_draw = ImageDraw.Draw(glow)
    for r_factor, alpha in [(2.4, 35), (1.8, 70), (1.3, 130)]:
        glow_draw.ellipse(
            [spark_x - int(spark_r * r_factor), spark_y - int(spark_r * r_factor),
             spark_x + int(spark_r * r_factor), spark_y + int(spark_r * r_factor)],
            fill=(*SPARK, alpha),
        )
    img = Image.alpha_composite(img, glow)
    # Core spark
    draw = ImageDraw.Draw(img)
    draw.ellipse(
        [spark_x - spark_r, spark_y - spark_r, spark_x + spark_r, spark_y + spark_r],
        fill=(*SPARK, 255),
    )

    return img


def draw_tray_icon(size: int = 32) -> Image.Image:
    """Transparent background, white waveform — for the system tray."""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    n_bars = 5
    heights = [0.40, 0.65, 1.00, 0.65, 0.40]
    bar_w = max(1, size // 8)
    gap = max(1, size // 16)
    total_w = n_bars * bar_w + (n_bars - 1) * gap
    x0 = (size - total_w) // 2
    cy = size // 2
    for i, h_frac in enumerate(heights):
        bar_h = int(size * h_frac * 0.8)
        x = x0 + i * (bar_w + gap)
        draw.rounded_rectangle(
            [x, cy - bar_h // 2, x + bar_w, cy + bar_h // 2],
            radius=min(bar_w, bar_h) // 2,
            fill=WHITE,
        )
    return img


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    # ── .ico: multi-resolution ──────────────────────────────────────
    # Pillow's ICO writer in this version drops all but the first size when
    # sizes= and append_images= are combined. Workaround: save the largest
    # image with all sub-sizes encoded via the `sizes` parameter alone.
    sizes = [16, 32, 48, 64, 128, 256]
    largest = draw_icon(256)
    # `sizes` param triggers downsampling to each listed size
    largest.save(ICON_PATH, format="ICO", sizes=[(s, s) for s in sizes])
    print(f"Wrote {ICON_PATH}  ({ICON_PATH.stat().st_size:,} bytes)")

    # Verify
    from PIL import Image as _Im
    ico = _Im.open(ICON_PATH)
    actual_sizes = ico.ico.sizes() if hasattr(ico, "ico") else {ico.size}
    print(f"  Embedded sizes: {sorted(actual_sizes)}")

    # ── Tray PNG ────────────────────────────────────────────────────
    tray = draw_tray_icon(32)
    tray.save(TRAY_PATH, format="PNG")
    print(f"Wrote {TRAY_PATH}  ({TRAY_PATH.stat().st_size:,} bytes)")


if __name__ == "__main__":
    main()
