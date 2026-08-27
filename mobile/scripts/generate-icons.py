"""
Generate every app icon the employee app ships from the one brand mark.

The icons in assets/ were the Expo template's blue chevron — placeholder art
that had survived into a shippable Android build. This regenerates all of them
from frontend/public/brand/chefotech-logo.png, which is the same mark the web
app renders, so the thing an employee taps on their home screen is the thing
their HR team sees in the browser.

Run from the mobile/ directory:

    python scripts/generate-icons.py

Requires Pillow. It is not a project dependency — this is a one-off design
step, run when the mark changes, not part of the build.

Each target has a different job, which is why they are not one image resized:

  icon.png                  iOS/store. Must be opaque; iOS applies its own
                            rounded mask and renders alpha as black.
  android-icon-foreground   Drawn inside Android's adaptive mask, which crops
                            to a shape the manufacturer chooses. Content has
                            to sit well inside the safe zone or a circular
                            mask clips the outer nodes off the hexagon.
  android-icon-background   The plate behind it. White, because the mark is
                            multicolour and was drawn for white — on the
                            indigo this previously used, the navy nodes
                            disappeared into the background.
  android-icon-monochrome   Android themed icons tint a silhouette with the
                            user's wallpaper colours, so only coverage matters.
  splash-icon / -dark       The splash runs on white in light mode and on
                            #0F172A in dark. The mark's darkest navy is
                            #011E38, near-invisible on that, so the dark
                            variant sits on a light plate rather than being
                            recoloured — a brand mark should not change hue
                            because of a theme.

── Why this stays in RGB ────────────────────────────────────────────────────

The obvious approach is to lift the mark off its white background into alpha
and composite it wherever it is needed. That was tried and is wrong for this
artwork.

Recovering alpha from a flat PNG means assuming each pixel is the mark
composited over white, and solving for coverage — which requires assuming the
true colour has a channel at zero. This mark has gradients and light tints, so
that assumption breaks: measured across the file, mean recovered alpha came out
at 123/255 rather than the ~215 the solid colours imply. Compositing straight
back over white still reproduces it exactly, so the error is invisible until
the image is *resampled* — at which point un-premultiplying near-transparent
pixels amplifies rounding error and the mark comes back visibly washed out.
Average saturation fell from 178 to 146 doing it that way.

Every surface the mark lands on here is white, so none of that is necessary:
resize the opaque artwork in RGB and paste it. Alpha is derived only for the
monochrome silhouette, where colour is discarded anyway and only coverage is
read.
"""

from pathlib import Path
from PIL import Image, ImageChops, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT.parent / "frontend" / "public" / "brand" / "chefotech-logo.png"
OUT = ROOT / "assets"

WHITE = (255, 255, 255)


def load_mark() -> Image.Image:
    """The mark as opaque RGB, trimmed to its own edges.

    The source sits on near-white rather than pure white, so the trim tests
    distance from white with a small tolerance instead of equality.
    """
    im = Image.open(SOURCE).convert("RGB")
    distance = ImageChops.difference(im, Image.new("RGB", im.size, WHITE)).convert("L")
    box = distance.point(lambda v: 255 if v > 2 else 0).getbbox()
    return im.crop(box) if box else im


def coverage_mask(mark: Image.Image) -> Image.Image:
    """How much of each pixel the mark covers, for the silhouette.

    Distance from white, steepened so the thin connecting lines read as solid
    shape rather than a faint grey web — a themed icon is tinted flat by the
    launcher, and anything only partly covered simply disappears at 48px.
    """
    difference = ImageChops.difference(mark, Image.new("RGB", mark.size, WHITE))
    red, green, blue = difference.split()

    # The largest channel difference, not the luminance-weighted one. Amber is
    # far from white in blue and barely at all in red, so a luminance average
    # scores it around 76/255 and the yellow arms of the hexagon come out a
    # washed grey against solid black elsewhere. Taking the strongest channel
    # judges every hue by how far it is from white in the direction it
    # actually differs.
    distance = ImageChops.lighter(ImageChops.lighter(red, green), blue)
    return distance.point(lambda v: min(255, int(v * 1.6)))


def fit(mark: Image.Image, canvas: int, coverage: float, background=WHITE) -> Image.Image:
    """Centre the mark on a square canvas, occupying `coverage` of its width."""
    target = round(canvas * coverage)
    ratio = min(target / mark.width, target / mark.height)
    size = (max(1, round(mark.width * ratio)), max(1, round(mark.height * ratio)))

    layer = Image.new("RGB", (canvas, canvas), background)
    layer.paste(mark.resize(size, Image.LANCZOS), ((canvas - size[0]) // 2, (canvas - size[1]) // 2))
    return layer


def fit_transparent(mark: Image.Image, canvas: int, coverage: float) -> Image.Image:
    """Same placement, but the white ground becomes transparent.

    Used where the asset genuinely must not carry its own background. The mask
    is resized alongside the artwork rather than recovered afterwards, so the
    colours never pass through an un-premultiply step.
    """
    target = round(canvas * coverage)
    ratio = min(target / mark.width, target / mark.height)
    size = (max(1, round(mark.width * ratio)), max(1, round(mark.height * ratio)))

    art = mark.resize(size, Image.LANCZOS)
    mask = coverage_mask(mark).resize(size, Image.LANCZOS)

    layer = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
    layer.paste(art, ((canvas - size[0]) // 2, (canvas - size[1]) // 2), mask)
    return layer


def silhouette(mark: Image.Image, canvas: int, coverage: float) -> Image.Image:
    """Shape only — Android supplies the colour."""
    target = round(canvas * coverage)
    ratio = min(target / mark.width, target / mark.height)
    size = (max(1, round(mark.width * ratio)), max(1, round(mark.height * ratio)))

    mask = coverage_mask(mark).resize(size, Image.LANCZOS)
    layer = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
    layer.paste(Image.new("RGBA", size, (0, 0, 0, 255)), ((canvas - size[0]) // 2, (canvas - size[1]) // 2), mask)
    return layer


def rounded_plate(size: int, radius_ratio: float = 0.22) -> Image.Image:
    plate = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    ImageDraw.Draw(plate).rounded_rectangle(
        (0, 0, size - 1, size - 1), radius=round(size * radius_ratio), fill=(255, 255, 255, 255)
    )
    return plate


def write(image: Image.Image, name: str) -> None:
    path = OUT / name
    image.save(path, "PNG", optimize=True)
    print(f"  {name:34} {image.width}x{image.height}  {path.stat().st_size:>9,} bytes")


def main() -> None:
    if not SOURCE.exists():
        raise SystemExit(f"Brand mark not found at {SOURCE}")

    mark = load_mark()
    print(f"Source mark trimmed to {mark.width}x{mark.height}\nWriting into {OUT}:")

    # Opaque: iOS renders any alpha in the app icon as black.
    write(fit(mark, 1024, 0.72), "icon.png")

    # Conservative coverage — a circular adaptive mask crops hard, and the
    # hexagon's outer nodes are the first thing to be cut off.
    write(fit_transparent(mark, 512, 0.56), "android-icon-foreground.png")
    write(Image.new("RGB", (512, 512), WHITE), "android-icon-background.png")
    write(silhouette(mark, 432, 0.56), "android-icon-monochrome.png")

    write(fit_transparent(mark, 1024, 0.62), "splash-icon.png")

    dark = rounded_plate(1024)
    dark.alpha_composite(fit_transparent(mark, 1024, 0.46))
    write(dark, "splash-icon-dark.png")

    write(fit(mark, 48, 0.86), "favicon.png")

    # The mark for use inside the app — beside the wordmark on login and the
    # intro header. Separate from icon.png, which the login screen used to
    # borrow: that one is deliberately opaque and carries 28% padding for the
    # launcher, so on the dark-mode login screen it rendered as a white square
    # with a mark too small for the space it occupied.
    write(fit_transparent(mark, 512, 1.0), "logo.png")

    print("Done. Rebuild the native project for icon changes to take effect.")


if __name__ == "__main__":
    main()
