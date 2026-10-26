"""Regenerate gallery stills with Pillow/numpy. No browser, GPU, or downloads.

Reaper is a composition of the existing studio render, tied to the local GLB
by tools/reaper/verification.json. Its geometry and components stay unchanged.
NXP uses the same illustrative lane/edge geometry and S-bend as the supplied
_scratch/tools/nxp.py. It is artwork, not a reconstruction of a race result.
"""
from io import BytesIO
from pathlib import Path
import hashlib
import json
import subprocess

import numpy as np
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parents[2]
MEDIA = ROOT / 'public/media'
SIZE = 1600
SOURCE_REV = '44a624f'


def original(name):
    return subprocess.check_output(
        ['git', 'show', f'{SOURCE_REV}:public/media/{name}'], cwd=ROOT, timeout=15)


def save(name, pixels):
    image = pixels if isinstance(pixels, Image.Image) else Image.fromarray(
        np.uint8(np.clip(pixels, 0, 255)))
    image.convert('RGB').save(MEDIA / name, quality=90, method=6)
    print(f'{name}: {image.size}, {(MEDIA / name).stat().st_size:,} bytes')


def reaper():
    receipt = json.loads((ROOT / 'tools/reaper/verification.json').read_text())
    model = (ROOT / 'public/models/reaper.glb').read_bytes()
    assert hashlib.sha256(model).hexdigest() == receipt['model']['sha256']
    source = original('reaper.webp')
    assert hashlib.sha256(source).hexdigest() == receipt['files']['reaper.webp']['sha256']
    photo = Image.open(BytesIO(source)).convert('RGB')
    rgb = np.asarray(photo, dtype=np.float32)
    luminance = rgb @ np.array([.2126, .7152, .0722], dtype=np.float32)
    # Separate the pale CAD skin from the dark studio floor. Retain the actual
    # surface shading, exposed plywood, seams, and original model silhouette.
    mask = Image.fromarray(np.uint8(np.clip((luminance - 43) / 28, 0, 1) * 255))
    mask = mask.filter(ImageFilter.MinFilter(7)).filter(ImageFilter.MaxFilter(7))
    mask = mask.filter(ImageFilter.MaxFilter(3)).filter(ImageFilter.GaussianBlur(.6))
    h, w = luminance.shape
    yy, xx = np.mgrid[:h, :w].astype(np.float32)
    warm = np.clip(1 - xx / w, 0, 1) * .035
    cool = np.clip(xx / w, 0, 1) * .06
    grade = rgb * np.stack([.96 + warm, 1.01 + cool * .2, 1.04 + cool], axis=-1)
    plane = Image.fromarray(np.uint8(np.clip(grade, 0, 255))).convert('RGBA')
    plane.putalpha(mask)
    plane = plane.crop((45, 220, 1390, 810)).rotate(18, Image.Resampling.BICUBIC, expand=True)
    plane.thumbnail((1190, 910), Image.Resampling.LANCZOS)

    yy, xx = np.mgrid[:SIZE, :SIZE].astype(np.float32) / SIZE
    pool = np.exp(-(((xx - .48) / .48) ** 2 + ((yy - .46) / .33) ** 2) * 2)
    rim = np.exp(-(((xx - .78) / .3) ** 2 + ((yy - .28) / .22) ** 2) * 2)
    floor = np.zeros((SIZE, SIZE, 3), dtype=np.float32)
    floor[:] = [6, 8, 11]
    floor += pool[..., None] * [20, 23, 27] + rim[..., None] * [12, 12, 11]
    # One soft light pool, with no badges, wireframes, or invented hardware.
    canvas = Image.fromarray(np.uint8(floor)).convert('RGBA')
    x, y = (SIZE - plane.width) // 2, 650 - plane.height // 2
    shadow = Image.new('RGBA', (SIZE, SIZE))
    ink = Image.new('RGBA', plane.size, (0, 0, 0, 210))
    ink.putalpha(plane.getchannel('A').point(lambda a: int(a * .75)))
    shadow.alpha_composite(ink, (x + 12, y + 55))
    canvas = Image.alpha_composite(canvas, shadow.filter(ImageFilter.GaussianBlur(24)))
    canvas.alpha_composite(plane, (x, y))
    save('reaper.webp', canvas)


def nxp():
    # Elevated view of the supplied analytic lane. Work in bounded float32
    # arrays; the image is generated once, with no render service or WebGL.
    yy, xx = np.mgrid[:SIZE, :SIZE].astype(np.float32)
    u, v = (xx / SIZE - .5) * 1.1, (yy / SIZE - .5) * 1.1
    camera = np.array([.7, 1.75, -1.8], dtype=np.float32)
    forward = np.array([-.4, -1.75, 4.8], dtype=np.float32)
    forward /= np.linalg.norm(forward)
    right = np.cross(forward, [0, 1, 0]).astype(np.float32)
    right /= np.linalg.norm(right)
    up = np.cross(right, forward)
    rays = forward + u[..., None] * right - v[..., None] * up
    distance = -camera[1] / np.minimum(rays[..., 1], -.0001)
    x = camera[0] + rays[..., 0] * distance
    z = camera[2] + rays[..., 2] * distance
    centre = .55 * np.sin(z * .55 + .4) - .25 * np.sin(z * .23) - .214
    d = np.abs(x - centre)
    # The original lane dimensions, with antialiased edge tape.
    aa = np.clip(distance / SIZE * 1.1, .001, .03)
    lane = np.clip((.27 - d) / aa + .5, 0, 1)
    white = np.clip((.245 - d) / aa + .5, 0, 1)
    pool = np.exp(-((x + .3) / 3.8) ** 2 - ((z - 2.4) / 10) ** 2)
    light = .42 + .58 * pool
    fog = np.exp(-np.maximum(z - 3, 0) * .065)
    floor = np.zeros((SIZE, SIZE, 3), dtype=np.float32)
    floor[:] = [27, 31, 37]
    floor *= (.55 + pool[..., None] * .45)
    # Fine floor joins establish scale without adding UI marks.
    joint = np.maximum(np.exp(-(np.sin(x * np.pi / 1.5) / .007) ** 2),
                       np.exp(-(np.sin(z * np.pi / 1.5) / .007) ** 2))
    floor *= 1 - joint[..., None] * .18
    track = np.zeros_like(floor)
    track[:] = [211, 213, 208]
    track *= light[..., None]
    track *= 1 + (x - centre)[..., None] * .14
    tape = np.zeros_like(floor)
    tape[:] = [4, 5, 7]
    track = tape * (1 - white[..., None]) + track * white[..., None]
    frame = floor * (1 - lane[..., None]) + track * lane[..., None]
    # A single linescan accent, inherited from the supplied art.
    scan = np.exp(-((z - 2.6) / .017) ** 2) * lane
    glow = np.exp(-((z - 2.6) / .12) ** 2) * lane
    frame += scan[..., None] * [120, 3, 8] + glow[..., None] * [24, 0, 2]
    frame *= fog[..., None]
    vignette = np.clip(1 - .42 * ((xx / SIZE - .5) ** 2 + (yy / SIZE - .45) ** 2), .5, 1)
    frame *= vignette[..., None]
    rng = np.random.default_rng(3)
    frame += rng.normal(0, .23, (SIZE, SIZE, 1)).astype(np.float32)
    frame[rays[..., 1] >= 0] = [5, 7, 10]
    save('nxp-track.webp', frame)


if __name__ == '__main__':
    reaper()
    nxp()
    assert sum((MEDIA / name).stat().st_size for name in ('reaper.webp', 'nxp-track.webp')) < 2_000_000
