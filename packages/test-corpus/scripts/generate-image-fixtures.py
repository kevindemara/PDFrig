"""Generate small, content-free image fixtures for ORG-008 browser/PDF tests."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

from PIL import Image, ImageDraw


FIXTURE_DIRECTORY = Path(__file__).parent.parent / "fixtures" / "images"


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def quadrant_image() -> Image.Image:
    image = Image.new("RGB", (40, 20), "white")
    draw = ImageDraw.Draw(image)
    draw.rectangle((0, 0, 19, 9), fill=(220, 38, 38))
    draw.rectangle((20, 0, 39, 9), fill=(22, 163, 74))
    draw.rectangle((0, 10, 19, 19), fill=(37, 99, 235))
    draw.rectangle((20, 10, 39, 19), fill=(250, 204, 21))
    return image


def main() -> None:
    FIXTURE_DIRECTORY.mkdir(parents=True, exist_ok=True)

    oriented_jpeg = FIXTURE_DIRECTORY / "quadrants-orientation-6.jpg"
    exif = Image.Exif()
    exif[274] = 6
    quadrant_image().save(oriented_jpeg, "JPEG", quality=100, subsampling=0, exif=exif)

    oriented_png = FIXTURE_DIRECTORY / "quadrants-orientation-6.png"
    quadrant_image().save(oriented_png, "PNG", exif=exif)

    webp = FIXTURE_DIRECTORY / "split-colours.webp"
    webp_image = Image.new("RGB", (30, 18), (190, 24, 154))
    ImageDraw.Draw(webp_image).rectangle((15, 0, 29, 17), fill=(8, 145, 178))
    webp_image.save(webp, "WEBP", lossless=True, method=6)

    animated_webp = FIXTURE_DIRECTORY / "animated-two-frame.webp"
    Image.new("RGB", (16, 12), (220, 38, 38)).save(
        animated_webp,
        "WEBP",
        append_images=[Image.new("RGB", (16, 12), (37, 99, 235))],
        duration=100,
        loop=0,
        lossless=True,
        save_all=True,
    )

    fixtures = [
        {
            "encodedHeight": 20,
            "encodedWidth": 40,
            "expectedHeight": 40,
            "expectedOrientation": 6,
            "expectedWidth": 20,
            "featureIds": ["ORG-008", "CREATE-002"],
            "filename": oriented_jpeg.name,
            "license": "CC0-1.0",
            "mimeType": "image/jpeg",
            "origin": "Purpose-created by the PDFMason image fixture generator",
            "sensitivity": "none",
            "sha256": sha256(oriented_jpeg),
        },
        {
            "encodedHeight": 20,
            "encodedWidth": 40,
            "expectedHeight": 40,
            "expectedOrientation": 6,
            "expectedWidth": 20,
            "featureIds": ["ORG-008", "CREATE-002"],
            "filename": oriented_png.name,
            "license": "CC0-1.0",
            "mimeType": "image/png",
            "origin": "Purpose-created by the PDFMason image fixture generator",
            "sensitivity": "none",
            "sha256": sha256(oriented_png),
        },
        {
            "encodedHeight": 18,
            "encodedWidth": 30,
            "expectedHeight": 18,
            "expectedOrientation": 1,
            "expectedWidth": 30,
            "featureIds": ["ORG-008", "CREATE-002"],
            "filename": webp.name,
            "license": "CC0-1.0",
            "mimeType": "image/webp",
            "origin": "Purpose-created by the PDFMason image fixture generator",
            "sensitivity": "none",
            "sha256": sha256(webp),
        },
        {
            "encodedHeight": 12,
            "encodedWidth": 16,
            "expectedError": "UTILITY_IMAGE_ANIMATION_UNSUPPORTED",
            "expectedHeight": 12,
            "expectedOrientation": 1,
            "expectedWidth": 16,
            "featureIds": ["ORG-008", "CREATE-002"],
            "filename": animated_webp.name,
            "license": "CC0-1.0",
            "mimeType": "image/webp",
            "origin": "Purpose-created by the PDFMason image fixture generator",
            "sensitivity": "none",
            "sha256": sha256(animated_webp),
        },
    ]
    manifest = json.dumps({"fixtures": fixtures, "schemaVersion": 1}, indent=2)
    manifest = manifest.replace(
        '"featureIds": [\n        "ORG-008",\n        "CREATE-002"\n      ]',
        '"featureIds": ["ORG-008", "CREATE-002"]',
    )
    with (FIXTURE_DIRECTORY / "manifest.json").open(
        "w", encoding="utf-8", newline="\n"
    ) as manifest_file:
        manifest_file.write(manifest + "\n")


if __name__ == "__main__":
    main()
