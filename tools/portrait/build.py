"""Apply the saved matte to the owner's original Standard pfp.png.

Usage: python tools/portrait/build.py <source-photo>
Requires Pillow. The original photo stays outside the repository.
"""
from pathlib import Path
import hashlib
import json
import sys
from PIL import Image

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
source = Image.open(sys.argv[1]).convert('RGB')
receipt = json.loads((HERE / 'source.json').read_text())
assert list(source.size) == receipt['size']
assert hashlib.sha256(source.tobytes()).hexdigest() == receipt['rgbSha256']
cutout = source.convert('RGBA')
cutout.putalpha(Image.open(HERE / 'matte.png').convert('L'))
cutout.save(ROOT / 'public/media/portrait.webp', quality=91, method=6, exact=True)
cutout.thumbnail((720, 720), Image.Resampling.LANCZOS)
cutout.save(ROOT / 'public/media/portrait-sm.webp', quality=88, method=6, exact=True)
