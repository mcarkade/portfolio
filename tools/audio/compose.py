#!/usr/bin/env python3
"""
Original soundtrack generator for the portfolio site. Everything is synthesised here:
no samples, loops or third-party audio.

    python compose.py intro      # intro.mp3 + intro_cues.json
    python compose.py sfx        # tick.mp3, whoosh.mp3, lock.mp3
    python compose.py loop       # loop.mp3 (+ loop.ogg if smaller)
    python compose.py all
    python compose.py qa         # decode the delivered files, spectrograms, RMS, seam checks

Needs numpy, scipy, soundfile, matplotlib (qa only) and ffmpeg on PATH.
Scratch WAVs/PNGs go to MC_AUDIO_SCRATCH (default: <temp>/mc-audio), never into this folder.
Tweak the constants in the "LOOP ARRANGEMENT" and "INTRO" sections, then re-run.
"""
import json
import math
import os
import re
import subprocess
import sys
import tempfile

import numpy as np
import scipy.signal as sg
import soundfile as sf
from scipy.ndimage import minimum_filter1d, uniform_filter1d

SR = 44100
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(os.path.dirname(os.path.dirname(HERE)), "public", "audio")
SCRATCH = os.environ.get("MC_AUDIO_SCRATCH", os.path.join(tempfile.gettempdir(), "mc-audio"))
os.makedirs(SCRATCH, exist_ok=True)

# ----------------------------------------------------------------------------------------
# DSP CORE
# ----------------------------------------------------------------------------------------


def mtof(m):
    return 440.0 * 2.0 ** ((np.asarray(m, float) - 69.0) / 12.0)


def dbv(d):
    return 10.0 ** (np.asarray(d, float) / 20.0)


def pan_gains(p):
    a = (np.asarray(p, float) + 1.0) * np.pi / 4.0
    return np.cos(a), np.sin(a)


def stereo(x, p=0.0):
    l, r = pan_gains(p)
    return np.stack([x * l, x * r], -1)


def _blep(t, dt):
    dt = np.broadcast_to(dt, t.shape)
    y = np.zeros_like(t)
    m = t < dt
    if m.any():
        x = t[m] / dt[m]
        y[m] = x + x - x * x - 1.0
    m = t > 1.0 - dt
    if m.any():
        x = (t[m] - 1.0) / dt[m]
        y[m] = x * x + x + x + 1.0
    return y


def saw(ph, dt):
    """PolyBLEP band-limited sawtooth."""
    return 2.0 * ph - 1.0 - _blep(ph, dt)


def pulse(ph, dt, pw=0.5):
    return saw(ph, dt) - saw((ph + pw) % 1.0, dt)


def phase(f, n, ph0=0.0):
    if np.ndim(f) == 0:
        dt = float(f) / SR
        return (ph0 + dt * np.arange(n)) % 1.0, dt
    dt = np.asarray(f, float) / SR
    return (ph0 + np.cumsum(dt) - dt) % 1.0, dt


def unison(freq, n, voices, cents, spread, rng, wave="saw", pw=0.5):
    """Detuned unison stack (PolyBLEP), pan-spread. freq may be a scalar or per-sample array."""
    out = np.zeros((n, 2))
    offs = np.linspace(-1, 1, voices) if voices > 1 else np.zeros(1)
    for o in offs:
        f = freq * 2.0 ** (o * cents / 1200.0)
        ph, dt = phase(f, n, rng.random())
        s = saw(ph, dt) if wave == "saw" else pulse(ph, dt, pw)
        l, r = pan_gains(o * spread)
        out[:, 0] += s * l
        out[:, 1] += s * r
    return out / np.sqrt(voices)


def sine_phase(f, n):
    if np.ndim(f) == 0:
        return 2 * np.pi * float(f) * np.arange(n) / SR
    return 2 * np.pi * np.cumsum(np.asarray(f, float)) / SR


def white(n, rng, ch=None):
    return rng.standard_normal(n if ch is None else (n, ch))


def pink(n, rng):
    b = [0.049922035, -0.095993537, 0.050612699, -0.004408786]
    a = [1, -2.494956002, 2.017265875, -0.522189400]
    y = sg.lfilter(b, a, rng.standard_normal(n + 2000))[2000:]
    return y / y.std()


def bq(x, kind, fc, order=2, periodic=False):
    """Static Butterworth filter. fc scalar, or (lo, hi) for bandpass."""
    wn = np.asarray(fc, float) / (SR / 2)
    sos = sg.butter(order, wn, btype=kind, output="sos")
    if periodic:
        pad = min(len(x), 4 * SR)
        xx = np.concatenate([x[-pad:], x])
        return sg.sosfilt(sos, xx, axis=0)[pad:]
    return sg.sosfilt(sos, x, axis=0)


def _rbj_lp(fc, q):
    w0 = 2 * np.pi * np.clip(fc, 20, SR * 0.45) / SR
    c, s = np.cos(w0), np.sin(w0)
    al = s / (2 * q)
    a0 = 1 + al
    return np.stack([(1 - c) / 2 / a0, (1 - c) / a0, (1 - c) / 2 / a0, -2 * c / a0, (1 - al) / a0], -1)


def lp_tv(x, fc, q=0.8, block=32, stages=2, q2=0.6, drive=0.0):
    """Resonant lowpass with time-varying cutoff (24 dB/oct with stages=2), block-wise biquads
    with carried state. fc is a scalar or a per-sample array."""
    x = np.asarray(x, float)
    mono = x.ndim == 1
    X = x[:, None] if mono else x
    if drive:
        X = np.tanh(X * drive) / np.tanh(drive)
    n, ch = X.shape
    nb = (n + block - 1) // block
    fc = np.broadcast_to(np.asarray(fc, float), (n,))
    fcb = fc[np.minimum(np.arange(nb) * block + block // 2, n - 1)]
    Y = X
    for st in range(stages):
        co = _rbj_lp(fcb, q if st == 0 else q2)
        zi = np.zeros((2, ch))
        out = np.empty_like(Y)
        for b in range(nb):
            s0, s1 = b * block, min(n, (b + 1) * block)
            c = co[b]
            y, zi = sg.lfilter(c[:3], [1.0, c[3], c[4]], Y[s0:s1], axis=0, zi=zi)
            out[s0:s1] = y
        Y = out
    return Y[:, 0] if mono else Y


def total_n(gate, r):
    return int(round(gate * SR)) + int(round(r * SR))


def env_adsr(gate, a, d, s, r):
    """Smooth ADSR (d = decay time constant). Total length gate + r seconds."""
    ng, nr = int(round(gate * SR)), int(round(r * SR))
    t = np.arange(ng) / SR
    att = np.clip(t / max(a, 1e-4), 0, 1)
    att = att * att * (3 - 2 * att)
    e = att * (s + (1 - s) * np.exp(-np.maximum(t - a, 0) / max(d, 1e-4)))
    last = e[-1] if ng else 0.0
    rel = last * np.exp(-np.arange(nr) * 5.0 / (max(r, 1e-4) * SR))
    out = np.concatenate([e, rel])
    k = min(len(out), int(0.004 * SR))
    out[-k:] *= np.linspace(1, 0, k)
    return out


def taper(x, ms=6.0):
    k = min(len(x), int(ms * SR / 1000))
    x = x.copy()
    x[-k:] *= (np.linspace(1, 0, k) if x.ndim == 1 else np.linspace(1, 0, k)[:, None])
    return x


class Bus:
    """Stereo accumulation buffer that is longer than the loop so tails can be folded back."""

    def __init__(self, n):
        self.b = np.zeros((n, 2))

    def add(self, x, t, gain=1.0, pan=0.0):
        if x.ndim == 1:
            x = stereo(x, pan)
        s = int(round(t * SR))
        if s < 0:
            x, s = x[-s:], 0
        e = min(s + len(x), len(self.b))
        if e > s:
            self.b[s:e] += x[: e - s] * gain


def mono_sum(x):
    return x.mean(axis=1)


# ---- reverb ----------------------------------------------------------------------------


def make_ir(rt60, predelay=0.015, hf_rt=0.4, lf_rt=1.1, onset=0.012, highcut=11000, lowcut=120, seed=1, early=True):
    """Algorithmic stereo impulse response: decorrelated noise with band-dependent decay
    (dark tail), soft onset, optional sparse early reflections."""
    rng = np.random.default_rng(seed)
    L = int((rt60 * 1.4 + predelay) * SR)
    t = np.arange(L) / SR
    ir = np.zeros((L, 2))
    dec = lambda rt: np.exp(-6.9078 * t / rt)
    for c in range(2):
        w = rng.standard_normal(L)
        lo = bq(w, "low", 350)
        hi = bq(w, "high", 3500)
        mid = w - lo - hi
        y = lo * dec(rt60 * lf_rt) + mid * dec(rt60) + hi * dec(rt60 * hf_rt)
        ir[:, c] = y * (1 - np.exp(-t / onset))
    if early:
        for i in range(12):
            d = int((0.006 + rng.random() * 0.075) * SR)
            amp = (0.9 - i * 0.045) * rng.choice([-1, 1]) * 0.6
            p = rng.uniform(-1, 1)
            l, r = pan_gains(p)
            if d < L:
                ir[d, 0] += amp * l * 6
                ir[d, 1] += amp * r * 6
    sh = int(predelay * SR)
    ir = np.concatenate([np.zeros((sh, 2)), ir])[:L]
    ir = bq(ir, "low", highcut)
    ir = bq(ir, "high", lowcut)
    ir = taper(ir, 30)
    return ir / np.sqrt((ir ** 2).sum(axis=0).mean())


def conv_periodic(x, ir):
    """Convolve a loop-periodic mono signal with a stereo IR; exact steady-state result."""
    N, L = len(x), len(ir)
    pre = np.tile(x, int(np.ceil(L / N)))[-L:]
    xx = np.concatenate([pre, x])
    return np.stack([sg.oaconvolve(xx, ir[:, c])[L : L + N] for c in range(2)], -1)


def conv_oneshot(x, ir, out_len=None):
    n = out_len or len(x)
    y = np.stack([sg.oaconvolve(x, ir[:, c]) for c in range(2)], -1)
    y = y[:n] if len(y) >= n else np.pad(y, ((0, n - len(y)), (0, 0)))
    return y


def pingpong_periodic(x, time, fb=0.5, taps=8, damp=3200):
    """Ping-pong delay on a loop-periodic signal (circular shifts, so it wraps exactly)."""
    D = int(round(time * SR))
    m = mono_sum(x)
    out = np.zeros((len(x), 2))
    cur = m
    for k in range(1, taps + 1):
        cur = bq(cur, "low", damp, 1, periodic=True)
        out += stereo(np.roll(cur, k * D), -0.8 if k % 2 else 0.8) * fb ** k
    return out


# ---- master-bus tools ---------------------------------------------------------------------


def glue_comp(x, thr_db=-20.0, ratio=1.8, att_ms=30.0, rel_ms=280.0, blk=512, periodic=True):
    n = len(x)
    nb = n // blk
    ms = (x[: nb * blk] ** 2).mean(axis=1).reshape(nb, blk).mean(axis=1)
    lv = 10 * np.log10(ms + 1e-12)
    seq = np.tile(lv, 3) if periodic else lv
    ca, cr = 1 - np.exp(-blk / (SR * att_ms / 1000)), 1 - np.exp(-blk / (SR * rel_ms / 1000))
    gr, out = 0.0, np.empty(len(seq))
    for i, l in enumerate(seq):
        tgt = max(0.0, (l - thr_db) * (1 - 1 / ratio))
        gr += (tgt - gr) * (ca if tgt > gr else cr)
        out[i] = gr
    grb = out[nb : 2 * nb] if periodic else out
    cen = (np.arange(nb) + 0.5) * blk
    g = np.interp(np.arange(n), cen, grb, period=nb * blk) if periodic else np.interp(np.arange(n), cen, grb)
    return x * (10 ** (-g / 20))[:, None]


def tp_env(x, periodic):
    P = 256
    xp = np.concatenate([x[-P:], x, x[:P]]) if periodic else np.pad(x, ((P, P), (0, 0)))
    up = sg.resample_poly(xp, 4, 1, axis=0)
    m = np.abs(up).max(axis=1)[4 * P : 4 * P + 4 * len(x)].reshape(-1, 4).max(axis=1)
    return np.maximum(m, np.abs(x).max(axis=1))


def limiter(x, ceil_db, look_ms=4.0, periodic=False):
    """Look-ahead true-peak limiter (windowed min + boxcar, so no recursion; wraps for loops)."""
    pk = tp_env(x, periodic)
    g = np.minimum(1.0, dbv(ceil_db) / np.maximum(pk, 1e-9))
    L = max(2, int(look_ms * SR / 1000))
    mode = "wrap" if periodic else "nearest"
    gs = uniform_filter1d(minimum_filter1d(g, size=2 * L + 1, mode=mode), size=L + 1, mode=mode)
    return x * gs[:, None]


def soft_limit_bus(x, ceil=0.9):
    """Percussion-bus peak control before the master (cheap, non-pumping)."""
    return x if np.abs(x).max() <= ceil else limiter(x, 20 * np.log10(ceil), look_ms=2.0, periodic=True)


# ---- measurement / encode ----------------------------------------------------------------


def run(cmd):
    p = subprocess.run(cmd, capture_output=True, text=True)
    if p.returncode:
        raise RuntimeError(" ".join(cmd) + "\n" + p.stderr[-2000:])
    return p.stderr


def write_wav(path, x):
    sf.write(path, x, SR, subtype="PCM_24")


def ebur(path):
    err = run(["ffmpeg", "-nostats", "-hide_banner", "-i", path, "-af", "ebur128=peak=true", "-f", "null", "-"])
    I = float(re.findall(r"I:\s+(-?[\d.]+) LUFS", err)[-1])
    tp = re.findall(r"Peak:\s+(-?[\d.]+|-inf) dBFS", err)[-1]
    lra = re.findall(r"LRA:\s+(-?[\d.]+) LU", err)[-1]
    return I, float(tp), float(lra)


def encode_mp3(wav, mp3):
    run(["ffmpeg", "-y", "-loglevel", "error", "-i", wav, "-c:a", "libmp3lame", "-b:a", "160k", "-ar", str(SR), "-ac", "2", mp3])


def decode(path, wav):
    run(["ffmpeg", "-y", "-loglevel", "error", "-i", path, "-c:a", "pcm_s24le", wav])
    y, sr = sf.read(wav)
    return y


def finalize(name, x, target_lufs, ceil_db=-1.6, periodic=False):
    """Gain to the loudness target through the true-peak limiter, encode MP3 at 160 kbps,
    decode it again and make sure the DELIVERED stream stays <= -1.0 dBTP."""
    wav = os.path.join(SCRATCH, name + "_master.wav")
    mp3 = os.path.join(OUT, name + ".mp3")
    offset = 0.0  # codec loudness shift, learned from the decoded stream
    for attempt in range(5):
        g = 0.0
        for _ in range(6):
            y = limiter(x * dbv(g), ceil_db, periodic=periodic)
            write_wav(wav, y)
            I, tp, _ = ebur(wav)
            if abs(I - (target_lufs + offset)) < 0.05:
                break
            g += target_lufs + offset - I
        encode_mp3(wav, mp3)
        dec = decode(mp3, os.path.join(SCRATCH, name + "_dec.wav"))
        I2, tp2, lra2 = ebur(os.path.join(SCRATCH, name + "_dec.wav"))
        if tp2 > -1.05:
            ceil_db -= (tp2 + 1.0) + 0.1
            continue
        if abs(I2 - target_lufs) > 0.12:
            offset += target_lufs - I2
            continue
        break
    stats = dict(file=name + ".mp3", lufs_wav=round(I, 2), tp_wav=tp, lufs_mp3=round(I2, 2), tp_mp3=tp2, lra=lra2,
                 bytes=os.path.getsize(mp3), seconds=round(len(dec) / SR, 4), ceil_used=round(ceil_db, 2))
    return y, stats


# ----------------------------------------------------------------------------------------
# INSTRUMENTS
# ----------------------------------------------------------------------------------------


def kick(vel, rng):
    n = int(0.9 * SR)
    t = np.arange(n) / SR
    f = 47 + 105 * np.exp(-t / 0.026)
    body = np.sin(sine_phase(f, n)) * np.exp(-t / 0.2) * np.minimum(t / 0.0015, 1)
    body = np.tanh(1.9 * body) / np.tanh(1.9)  # harmonics so it translates on small speakers
    click = bq(white(n, rng), "low", 3500) * np.exp(-t / 0.003) * 0.22
    return taper((body + click) * vel, 10)


def clap(vel, rng):
    n = int(0.6 * SR)
    t = np.arange(n) / SR
    env = sum(np.exp(-np.maximum(t - d, 0) / 0.006) * (t >= d) for d in (0.0, 0.011, 0.022)) * 0.55
    env = env + np.exp(-np.maximum(t - 0.03, 0) / 0.09) * (t >= 0.03)
    noise = bq(white(n, rng), "bandpass", (900, 3600)) * env
    body = np.sin(sine_phase(175 + 70 * np.exp(-t / 0.02), n)) * np.exp(-t / 0.07) * 0.45
    return taper(bq(noise + body, "low", 7000) * vel * 1.4, 10)


def hat(vel, rng):
    n = int(0.14 * SR)
    t = np.arange(n) / SR
    y = bq(white(n, rng), "bandpass", (5200, 9000)) * np.exp(-t / 0.017) * np.minimum(t / 0.002, 1)
    return taper(bq(y, "low", 9500, 1) * vel, 5)


def rim(vel, rng):
    n = int(0.12 * SR)
    t = np.arange(n) / SR
    y = np.sin(sine_phase(1650, n)) * np.exp(-t / 0.011) + bq(white(n, rng), "bandpass", (1500, 4200)) * np.exp(-t / 0.006) * 0.6
    return taper(y * vel * 0.8, 5)


def boom(vel, rng):
    n = int(2.0 * SR)
    t = np.arange(n) / SR
    f = 40 + 70 * np.exp(-t / 0.09)
    y = np.sin(sine_phase(f, n)) * np.exp(-t / 0.55) * np.minimum(t / 0.004, 1)
    y = np.tanh(1.5 * y) / np.tanh(1.5)
    y += bq(white(n, rng), "low", 600) * np.exp(-t / 0.05) * 0.25
    return taper(y * vel, 20)


def bell(freq, vel, rng):
    n = int(3.5 * SR)
    t = np.arange(n) / SR
    idx = 2.0 * np.exp(-t / 0.35) + 0.15
    car = np.sin(2 * np.pi * freq * t + idx * np.sin(2 * np.pi * freq * 3.5 * t))
    y = car * np.exp(-t / 0.95) + 0.22 * np.sin(2 * np.pi * freq * 2.0 * t) * np.exp(-t / 0.4)
    y *= np.minimum(t / 0.004, 1)
    return taper(bq(y, "low", 8000) * vel, 30)


def bass_note(midi, gate, vel):
    f = float(mtof(midi))
    r = 0.14
    n = total_n(gate, r)
    ph = sine_phase(f, n)
    sub = np.sin(ph) + 0.28 * np.sin(2 * ph + 0.3) + 0.10 * np.sin(3 * ph + 0.6)
    sub = np.tanh(1.3 * sub) / np.tanh(1.3)
    env = env_adsr(gate, 0.006, 0.35, 0.8, r)
    t = np.arange(n) / SR
    p, dt = phase(f, n, 0.0)
    mid = lp_tv(saw(p, dt), 170 + 650 * np.exp(-t / 0.12), q=1.4, block=32)
    return (sub * 0.9 + mid * 0.3) * env * vel


_arp_cache = {}


def arp_note(midi, gate, cut, vel, rng):
    key = (int(midi), round(gate, 3), int(round(cut / 100.0)), round(vel, 1))
    if key in _arp_cache:
        return _arp_cache[key]
    f = float(mtof(midi))
    r = 0.2
    n = total_n(gate, r)
    t = np.arange(n) / SR
    x = np.zeros(n)
    for c in (-7, 7):
        ph, dt = phase(f * 2 ** (c / 1200), n, rng.random())
        x += saw(ph, dt) * 0.5
    ph, dt = phase(f / 2, n, rng.random())
    x += pulse(ph, dt, 0.32) * 0.35
    y = lp_tv(x, key[2] * 100.0 * (0.35 + 1.9 * np.exp(-t / 0.11)), q=2.6, block=24, drive=1.3)
    y = y * env_adsr(gate, 0.002, 0.15, 0.25, r) * vel
    _arp_cache[key] = y
    return y


def lead_note(midi, gate, rng):
    f0 = float(mtof(midi))
    r = 1.5
    n = total_n(gate, r)
    t = np.arange(n) / SR
    f = f0 * (1 + np.minimum(t / 0.9, 1) * 0.0035 * np.sin(2 * np.pi * 5.2 * t))
    x = unison(f, n, 3, 9, 0.5, rng)
    x += stereo(np.sin(sine_phase(f, n)), 0) * 0.6
    y = lp_tv(x, 1400 + 1700 * np.exp(-t / 0.45), q=1.1, block=64)
    return y * env_adsr(gate, 0.09, 0.6, 0.65, r)[:, None]


def pad_chord(notes, gate, t0, cut_fn, rng):
    r = 2.4
    n = total_n(gate, r)
    x = np.zeros((n, 2))
    for m in notes:
        x += unison(float(mtof(m)), n, 6, 10, 0.9, rng)
    t = np.arange(n) / SR
    y = lp_tv(x, cut_fn(t0 + t), q=0.9, block=128)
    return y * env_adsr(gate, 1.1, 1.0, 1.0, r)[:, None] * 0.16


def riser(dur, rng, lo=300.0, hi=9000.0, curve=2.2, tail=0.5):
    nd, nt = int(dur * SR), int(tail * SR)
    n = nd + nt
    t = np.arange(n) / SR
    u = np.minimum(t / dur, 1.0)
    w = np.stack([pink(n, rng), pink(n, rng)], -1)
    y = lp_tv(w, lo * (hi / lo) ** u, q=2.0, block=64)
    y = bq(y, "high", 220)
    env = u ** curve
    env[nd:] *= np.cos(np.linspace(0, np.pi / 2, nt)) ** 2
    return y * env[:, None]


# ----------------------------------------------------------------------------------------
# LOOP ARRANGEMENT
# ----------------------------------------------------------------------------------------
BPM = 100
BEAT = 60.0 / BPM
S16 = BEAT / 4
BAR = BEAT * 4
BARS = 32  # 76.8 s
N = int(round(BARS * BAR * SR))  # 3,386,880 = 2940 MP3 frames exactly
TAIL = int(8 * SR)
LOOP_S = N / SR

# D natural minor: Dm9 | Bbmaj7 | Gm7 | Am7, two bars each, 4 x 8 bars
CHORDS = [
    dict(root=38, pad=[50, 53, 57, 60, 64]),
    dict(root=34, pad=[46, 53, 57, 62, 65]),
    dict(root=31, pad=[43, 50, 53, 58, 62]),
    dict(root=33, pad=[45, 52, 55, 60, 64]),
]
LEAD = [  # (beat offset in the 2-bar chord, midi, beats)
    [(0, 69, 3.0), (3, 74, 5.0)],
    [(0, 72, 2.0), (2, 74, 2.0), (4, 77, 4.0)],
    [(0, 74, 3.0), (3, 70, 1.0), (4, 72, 4.0)],
    [(0, 76, 3.0), (3, 72, 1.0), (4, 69, 4.0)],
]
PAT_A = [0, 2, 4, 2, 1, 3, 5, 3, 0, 2, 4, 2, 1, 3, 5, 3]
PAT_B = [0, 1, 2, 3, 4, 3, 2, 1, 0, 2, 3, 5, 4, 3, 2, 1]


def tstep(bar, step):
    return (bar * 16 + step) * S16


def chord_of(bar):
    return CHORDS[(bar // 2) % 4]


def curve(points):
    xs = np.array([p[0] for p in points], float) * BAR
    ys = np.array([p[1] for p in points], float)
    return lambda t: np.interp(np.mod(t, LOOP_S), xs, ys)


PAD_LEVEL = curve([(0, .7), (8, .85), (16, 1.0), (24, 1.0), (28, .9), (32, .7)])
PAD_CUT = lambda t: 480 + 1500 * PAD_LEVEL(t) + 380 * np.sin(2 * np.pi * t / 19.2) + 220 * np.sin(2 * np.pi * t / 38.4 + 1.0)
ARP_CUT = curve([(0, 600), (4, 800), (8, 1200), (12, 1700), (16, 2300), (20, 3000), (24, 1100), (28, 1800), (31.5, 4200), (32, 600)])
ARP_LEVEL = curve([(0, 0), (4, .0), (4.01, .35), (8, .6), (16, .75), (24, .5), (28, .75), (32, .75)])


def section(bar):
    return "A" if bar < 8 else "B" if bar < 16 else "C" if bar < 24 else "D1" if bar < 28 else "D2"


def duck_curve(events, tau=0.17, att=0.004):
    g = np.ones(N)
    for te, depth in events:
        for shift in (0.0, -LOOP_S, LOOP_S):
            i0 = int(round((te + shift - att) * SR))
            L = int(1.0 * SR)
            a, b = max(i0, 0), min(i0 + L, N)
            if b <= a:
                continue
            tt = (np.arange(a, b) - i0) / SR
            shape = np.where(tt < att, 0.5 - 0.5 * np.cos(np.pi * np.clip(tt / att, 0, 1)), np.exp(-(tt - att) / tau))
            g[a:b] *= 1 - depth * shape
    return g


def fold(bus):
    out = bus.b[:N].copy()
    tail = bus.b[N:]
    out[: len(tail)] += tail
    return out


STEM_DB = dict(pad=-4.5, bass=-7.5, arp=-5.0, lead=-6.5, bell=-8.0, kick=-8.5, snare=-7.0, hat=-3.0, rim=-7.0, fx=-9.0, air=-27.0)


def build_loop(seed=11):
    rng = np.random.default_rng(seed)
    nx = N + TAIL
    B = {k: Bus(nx) for k in STEM_DB}
    duck = []

    # --- pads (every chord, two bars each) ---
    for bar in range(0, BARS, 2):
        B["pad"].add(pad_chord(chord_of(bar)["pad"], 2 * BAR + 0.05, bar * BAR, PAD_CUT, rng), bar * BAR)

    for bar in range(BARS):
        sec, ch, par = section(bar), chord_of(bar), bar % 2
        root = ch["root"]
        # --- bass ---
        if sec == "A":
            for st, v in ((0, .95), (4, .6), (8, .8), (12, .6)):
                B["bass"].add(bass_note(root, 3.2 * S16, v), tstep(bar, st))
        elif sec == "D1":
            B["bass"].add(bass_note(root, 14.5 * S16, .9), tstep(bar, 0))
        else:
            for st in range(0, 16, 2):
                hi = st in (6, 14)
                v = (.95 if st % 4 == 0 else .7) * (.55 if hi else 1.0)
                B["bass"].add(bass_note(root + (12 if hi else 0), 1.6 * S16, v), tstep(bar, st))
        # --- kick ---
        ks = {"A": [(0, .85), (8, .7)], "B": [(0, 1), (4, .8), (8, .9), (12, .8)],
              "C": [(0, 1), (4, .8), (8, .9), (12, .8)] + ([(14, .45)] if par else []),
              "D1": [], "D2": [(0, 1), (4, .8), (8, .9), (12, .8)]}[sec]
        for st, v in ks:
            B["kick"].add(kick(v, rng), tstep(bar, st))
        # --- clap/snare ---
        if (sec == "B" and bar >= 10) or sec in ("C", "D2"):
            for st, v in ((4, .8), (12, .85)):
                B["snare"].add(clap(v, rng), tstep(bar, st))
            if sec == "C" and par:
                B["snare"].add(clap(.3, rng), tstep(bar, 15))
        if bar == 31:  # build into the loop point
            for st, v in ((8, .3), (10, .38), (12, .5), (13, .55), (14, .65), (15, .75)):
                B["snare"].add(clap(v, rng), tstep(bar, st))
        # --- hats and rim ---
        if 12 <= bar < 24 or bar >= 28:
            for st in range(16):
                B["hat"].add(hat([.12, .10, .35, .10][st % 4] * (1.2 if st % 8 == 6 else 1), rng), tstep(bar, st))
        if (8 <= bar < 24) or bar >= 28:
            for st in (3, 10):
                B["rim"].add(rim(.5, rng), tstep(bar, st))
        # --- arp ---
        lvl = float(ARP_LEVEL(tstep(bar, 0)))
        if lvl > 0:
            cut_b = float(ARP_CUT(tstep(bar, 0)))
            pool = sorted(set([m + 12 for m in ch["pad"]] + [ch["pad"][0] + 24]))
            pat = PAT_A if par == 0 else PAT_B
            half = sec in ("A", "D1")
            for st in range(16):
                if half and st % 2:
                    continue
                v = 1.0 if st % 4 == 0 else .8 if st % 2 == 0 else .6
                cut = float(ARP_CUT(tstep(bar, st)))
                y = arp_note(pool[pat[st]], 0.11 if not half else 0.2, cut, v, rng)
                B["arp"].add(y, tstep(bar, st), lvl, pan=0.28 if st % 2 else -0.28)
                if sec == "C" and st % 4 == 3:
                    B["arp"].add(arp_note(pool[pat[st]] + 12, 0.09, cut * 1.3, .6, rng), tstep(bar, st), lvl * .55, pan=.5 if st % 8 == 3 else -.5)

    # --- lead (sections C and D1) ---
    for bar in range(16, 28, 2):
        for off, m, beats in LEAD[(bar // 2) % 4]:
            sh = 12 if section(bar) == "D1" else 0
            B["lead"].add(lead_note(m + sh, beats * BEAT * .96, rng), bar * BAR + off * BEAT, 1.0 if sh == 0 else .85)
            if sh:
                B["lead"].add(lead_note(m, beats * BEAT * .96, rng), bar * BAR + off * BEAT, .5)

    # --- bell sparkle ---
    for bar in list(range(0, 16, 2)) + [24, 26]:
        p = chord_of(bar)["pad"]
        for i, (m, bt, v, pn) in enumerate(((p[4] + 12, 0.0, 1.0, -.4), (p[2] + 24, 1.5, .8, .35), (p[3] + 24, 3.0, .7, -.2))):
            B["bell"].add(bell(float(mtof(m)), v, rng), bar * BAR + bt * BEAT, pan=pn)

    # --- fx: loop-point boom, section booms, risers ---
    for bar, v in ((0, .9), (8, .7), (16, .8), (24, .6)):
        B["fx"].add(boom(v, rng), bar * BAR)
    for b0, b1, c in ((14, 16, 2.4), (22, 24, 2.4), (30, 32, 2.0)):
        B["fx"].add(riser((b1 - b0) * BAR, rng, curve=c), b0 * BAR, 1.0 if b0 == 30 else .7)

    # --- air texture (periodic by construction) ---
    n = N
    w = np.stack([pink(n, rng), pink(n, rng)], -1)
    w = bq(bq(w, "high", 500, 2, periodic=True), "low", 5200, 2, periodic=True)
    t = np.arange(n) / SR
    am = (0.6 + 0.4 * np.sin(2 * np.pi * t / 12.8)) * (0.7 + 0.3 * np.sin(2 * np.pi * t / 19.2 + 2))
    B["air"].b[:N] += w * am[:, None]

    # --- sidechain events ---
    for bar in range(BARS):
        s = section(bar)
        for beat in range(4):
            if s == "A":
                depth = .45 if beat % 2 == 0 else .12
            elif s == "D1":
                depth = .2
            else:
                depth = .5
            duck.append((bar * BAR + beat * BEAT, depth))

    return {k: fold(v) for k, v in B.items()}, duck


def mix_loop(stems, duck):
    g_mid = duck_curve(duck)
    g_bass = duck_curve([(t, min(.85, d * 1.45)) for t, d in duck], tau=0.2)
    S = {k: v * dbv(STEM_DB[k]) for k, v in stems.items()}
    for k in ("pad", "arp", "lead", "air"):
        S[k] = S[k] * g_mid[:, None]
    S["bass"] = S["bass"] * g_bass[:, None]
    S["bell"] = S["bell"] * (0.5 + 0.5 * g_mid)[:, None]
    perc = soft_limit_bus(S["kick"] + S["snare"] + S["hat"] + S["rim"])

    ir_hall = make_ir(4.2, predelay=0.025, hf_rt=0.3, lf_rt=1.0, seed=3)
    ir_plate = make_ir(1.3, predelay=0.006, hf_rt=0.6, lf_rt=0.8, onset=0.004, seed=5, early=False)
    delay = pingpong_periodic(S["arp"] * 0.55 + S["lead"] * 0.6, 3 * S16, fb=0.5)
    hall_in = mono_sum(S["pad"] * .45 + S["arp"] * .3 + S["lead"] * .55 + S["bell"] * .8 + S["fx"] * .5 + S["bass"] * 0.0) + mono_sum(delay) * .3
    hall_in = bq(bq(hall_in, "high", 200, 2, periodic=True), "low", 8000, 2, periodic=True)
    hall = conv_periodic(hall_in, ir_hall)
    plate = conv_periodic(mono_sum(S["snare"]) * .8 + mono_sum(S["hat"]) * .25 + mono_sum(S["rim"]) * .4, ir_plate)
    dry = S["pad"] + S["bass"] + S["arp"] + S["lead"] + S["bell"] + S["fx"] + S["air"] + perc
    mix = dry + hall * 0.7 + plate * 0.45 + delay * 0.6
    return mix, S, dict(hall=hall * .7, plate=plate * .45, delay=delay * .6)


def high_shelf(x, fc, gain_db, periodic=True):
    A = 10 ** (gain_db / 40)
    w0 = 2 * np.pi * fc / SR
    c, sn = np.cos(w0), np.sin(w0)
    al = sn / 2 * np.sqrt(2)
    sa = 2 * np.sqrt(A) * al
    b = [A * ((A + 1) + (A - 1) * c + sa), -2 * A * ((A - 1) + (A + 1) * c), A * ((A + 1) + (A - 1) * c - sa)]
    a = [(A + 1) - (A - 1) * c + sa, 2 * ((A - 1) - (A + 1) * c), (A + 1) - (A - 1) * c - sa]
    pad = min(len(x), 2 * SR)
    xx = np.concatenate([x[-pad:], x]) if periodic else x
    y = sg.lfilter(np.array(b) / a[0], np.array(a) / a[0], xx, axis=0)
    return y[pad:] if periodic else y


def widen(x, amt=1.4, hp=250):
    """Mid/side widener on everything above hp Hz (keeps bass and kick mono)."""
    side = (x[:, 0] - x[:, 1]) / 2
    sh = bq(side, "high", hp, 2, periodic=True) * (amt - 1)
    return x + np.stack([sh, -sh], -1)


def master_loop(mix):
    x = bq(mix, "high", 28, 2, periodic=True)
    x = bq(x, "low", 17500, 2, periodic=True)
    x = high_shelf(x, 5500, 2.5)
    x = widen(x, 1.5, 250)
    x = glue_comp(x, thr_db=-21.0, ratio=1.8)
    return x


# ----------------------------------------------------------------------------------------
# INTRO
# ----------------------------------------------------------------------------------------
HIT = 4.40
INTRO_LEN = 6.5
PRE_GAIN = 0.30  # build-up level relative to the slam
HIT_DRIVE = 1.5
INTRO_CHORD = [38, 45, 50, 57, 62, 65, 69, 74]  # D2 A2 D3 A3 D4 F4 A4 D5: open D minor
INTRO_SHIMMER = [587.33, 880.0, 1174.66, 1396.91, 1760.0, 2349.3]


def tick_times(hit=HIT, r0=8.0, r1=24.0, pw=1.7):
    tt = np.linspace(0, hit, 200001)
    rate = r0 + (r1 - r0) * (tt / hit) ** pw
    Nc = np.concatenate([[0], np.cumsum((rate[1:] + rate[:-1]) / 2 * np.diff(tt))])
    ks = np.arange(0, int(Nc[-1]) + 1)
    times = np.interp(Nc[-1] - ks, Nc, tt)
    return times[times > 0.12][::-1]


def flick(vel, pitch, rng):
    n = int(0.04 * SR)
    t = np.arange(n) / SR
    nz = bq(white(n, rng), "bandpass", (1400 * pitch, min(5200 * pitch, 15000)), 2) * np.exp(-t / 0.0035)
    thock = np.sin(sine_phase(260 * pitch * np.exp(-t / 0.01) + 120, n)) * np.exp(-t / 0.006) * 0.6
    return taper((nz * 0.9 + thock) * vel, 3)


def build_intro(seed=21):
    rng = np.random.default_rng(seed)
    n = int(8.0 * SR)
    t = np.arange(n) / SR
    pre = np.zeros((n, 2))  # everything before the hit
    u = np.clip(t / HIT, 0, 1)
    dip = np.clip(1 - 0.92 * np.clip((t - 4.335) / 0.02, 0, 1), 0.08, 1)
    dip[t >= HIT] = 0.0

    # sub swell (D2 is where it lands)
    f = 44 * (73.42 / 44) ** u
    ph = sine_phase(f, n)
    sub = (np.sin(ph) + 0.35 * np.sin(2 * ph) + 0.15 * np.sin(3 * ph))
    sub = np.tanh(1.2 * sub) * (0.05 + 0.95 * u ** 2.2)
    pre += stereo(sub * 0.55, 0) * dip[:, None]

    # dissonant semitone cluster gliding up an octave, filter opening
    f = 146.83 * 2 ** u
    cl = unison(f, n, 5, 12, 0.7, rng) + unison(f * 1.0595, n, 5, 12, 0.7, rng)
    cl = lp_tv(cl, 250 * (3500 / 250) ** u, q=1.5, block=64, drive=1.4)
    pre += cl * (0.5 * u ** 2.0 * dip)[:, None] * 0.28

    # filtered noise riser
    w = np.stack([pink(n, rng), pink(n, rng)], -1)
    ris = lp_tv(w, 250 * (10000 / 250) ** u, q=2.2, block=64)
    ris = bq(ris, "high", 150)
    pre += ris * (u ** 2.0 * dip)[:, None] * 0.8
    air = bq(white(n, rng, 2), "high", 6500) * (u ** 3.0 * dip)[:, None] * 0.12
    pre += air

    # accelerating frame-flip ticks (8 -> 24 per second), last one lands on the hit
    ticks = tick_times()
    for tk in ticks:
        uu = tk / HIT
        s = int(round(tk * SR))
        y = flick(0.2 + 0.8 * uu ** 1.2, 0.85 + 0.9 * uu, rng)
        pre[s : s + len(y)] += stereo(y, rng.uniform(-.3, .3)) * 0.5

    # ---- the hit ----
    h0 = int(round(HIT * SR))
    m = n - h0
    th = np.arange(m) / SR
    hit = np.zeros((m, 2))
    f = 31 + 85 * np.exp(-th / 0.11)
    sd = np.tanh(1.6 * np.sin(sine_phase(f, m))) * np.exp(-th / 1.0) * np.minimum(th / 0.001, 1)
    hit += stereo(sd * 0.62, 0)
    thump = bq(white(m, rng), "low", 220) * np.exp(-th / 0.07) * 0.9
    hit += stereo(thump * 0.8, 0)

    brass = np.zeros((m, 2))
    for note in INTRO_CHORD:
        brass += unison(float(mtof(note)), m, 5, 13, 0.95, rng) * (1.0 if note < 60 else .75)
    brass = lp_tv(brass, 700 + 7500 * np.exp(-th / 0.45), q=1.2, block=32, drive=1.6)
    brass *= (np.exp(-th / 1.0) * (0.55 + 0.45 * np.exp(-th / 0.12)) * np.minimum(th / 0.004, 1))[:, None]
    hit += brass * 0.36

    ratios = [1.0, 1.59, 2.14, 2.30, 2.65, 3.16, 4.07, 5.43, 6.8]
    metal = np.zeros((m, 2))
    for i, r in enumerate(ratios):
        for c, det in enumerate((1.0, 1.003)):
            metal[:, c] += np.sin(2 * np.pi * 520 * r * det * th + rng.random() * 6.28) * np.exp(-th / (1.3 / r ** 0.9)) / r ** 0.5
    metal += bq(white(m, rng, 2), "high", 2500) * np.exp(-th / 0.025)[:, None] * 0.9
    hit += bq(metal, "low", 10000) * 0.17
    hit += bq(white(m, rng, 2), "bandpass", (3000, 12000)) * (np.exp(-th / 0.8) * np.minimum(th / 0.02, 1))[:, None] * 0.07

    sh = np.zeros((m, 2))
    for i, fr in enumerate(INTRO_SHIMMER):
        for c, det in enumerate((2 ** (-2.5 / 1200), 2 ** (2.5 / 1200))):
            trem = 0.7 + 0.3 * np.sin(2 * np.pi * (4.3 + 0.4 * i) * th + i + c * 1.7)
            sh[:, c] += np.sin(2 * np.pi * fr * det * th) * trem / (1 + 0.3 * i)
    sh *= (np.exp(-th / 1.1) * (1 - np.exp(-th / 0.2)))[:, None]
    hit += sh * 0.045

    ir = make_ir(3.4, predelay=0.012, hf_rt=0.35, lf_rt=1.0, seed=9)
    wet_in = mono_sum(bq(brass * 0.36 + metal * 0.17 + sh * 0.05, "high", 140))
    hit += conv_oneshot(wet_in, ir, m) * 0.9

    out = pre * PRE_GAIN
    hit = np.tanh(HIT_DRIVE * hit) / HIT_DRIVE  # glue + density for the slam
    out[h0:] += hit
    out = out[: int(INTRO_LEN * SR)]
    tt = np.arange(len(out)) / SR
    fade = np.where(tt < 4.9, 1.0, 0.5 * (1 + np.cos(np.pi * np.clip((tt - 4.9) / (INTRO_LEN - 4.9), 0, 1)))) ** 1.5
    out *= fade[:, None]
    out = bq(out, "high", 25, 2)
    return out


# ----------------------------------------------------------------------------------------
# SFX
# ----------------------------------------------------------------------------------------


def peak_to(x, db):
    return x * (dbv(db) / np.abs(x).max())


def build_tick(seed=31):
    rng = np.random.default_rng(seed)
    n = int(0.06 * SR)
    t = np.arange(n) / SR
    y = bq(white(n, rng), "bandpass", (2500, 7000)) * np.exp(-t / 0.0015) * 0.5
    y += np.sin(sine_phase(2100, n)) * np.exp(-t / 0.006) * 0.8 + np.sin(sine_phase(1050, n)) * np.exp(-t / 0.009) * 0.45
    y = bq(bq(y, "low", 8000, 1), "high", 150, 2)
    y = y[: int(0.042 * SR)]
    y = taper(y, 12)
    return peak_to(stereo(y, 0), -10.0)


def build_whoosh(seed=41):
    rng = np.random.default_rng(seed)
    n = int(1.2 * SR)
    dur = 0.9
    t = np.arange(n) / SR
    u = np.clip(t / dur, 0, 1)
    env = (u ** 1.7) * ((1 - u) ** 2.3)
    env = env / env.max()
    env[t > dur] = 0
    w = np.stack([pink(n, rng), pink(n, rng)], -1)
    bodyf = 450 * 12 ** np.sin(np.pi * np.clip(u, 0, 1) ** 0.85)
    y = lp_tv(w, bodyf, q=1.7, block=48)
    y = bq(y, "high", 320)
    turb = 0.75 + 0.25 * bq(pink(n, rng), "low", 18)
    y = y * (env * turb)[:, None]
    y += bq(white(n, rng, 2), "high", 5000) * (env ** 2 * 0.22)[:, None]
    tone = unison(180 * 1.8 ** u, n, 3, 14, 0.6, rng)
    y += lp_tv(tone, 900, q=1.0, block=64) * (env ** 1.5 * 0.09)[:, None]
    sub = np.sin(sine_phase(75 - 30 * u, n)) * env ** 1.3 * 0.05
    y += stereo(sub, 0)
    gl, gr = pan_gains(-0.65 + 1.3 * u)
    y = y * np.stack([gl * 1.25, gr * 1.25], -1)
    ir = make_ir(0.8, predelay=0.004, hf_rt=0.5, onset=0.006, seed=7, early=False)
    y = y + conv_oneshot(mono_sum(y), ir, n) * 0.22
    y = y[: int(0.95 * SR)]
    k = int(0.08 * SR)
    y[:int(0.01 * SR)] *= np.linspace(0, 1, int(0.01 * SR))[:, None]
    y[-k:] *= np.linspace(1, 0, k)[:, None] ** 2
    return peak_to(y, -4.0)


def build_lock(seed=51):
    rng = np.random.default_rng(seed)
    n = int(0.5 * SR)
    y = np.zeros(n)

    def beep(f, t0, gate=0.075, r=0.07):
        m = total_n(gate, r)
        t = np.arange(m) / SR
        fr = f * (1 + 0.03 * np.exp(-t / 0.008))
        ph = sine_phase(fr, m)
        s = np.sin(ph) + 0.18 * np.sin(3 * ph) + 0.08 * np.sin(2 * ph)
        s += 0.35 * np.sin(2 * ph) * np.exp(-t / 0.03)
        e = env_adsr(gate, 0.002, 0.05, 0.6, r)
        s = s[: len(e)] * e[: len(s)]
        i = int(t0 * SR)
        y[i : i + len(s)] += s

    beep(1174.66, 0.0)
    beep(1760.0, 0.125)
    y = bq(y, "low", 9000, 1)
    st = stereo(y, 0)
    D = int(0.095 * SR)
    for k in range(1, 3):
        st += np.roll(stereo(bq(y, "low", 4000, 1), 0.7 if k % 2 else -0.7), k * D, axis=0) * 0.22 ** k * 2.2
    ir = make_ir(0.6, predelay=0.003, hf_rt=0.4, onset=0.004, seed=13, early=False)
    st += conv_oneshot(mono_sum(st), ir, n) * 0.1
    st = st[: int(0.42 * SR)]
    k = int(0.06 * SR)
    st[-k:] *= np.linspace(1, 0, k)[:, None]
    return peak_to(st, -6.0)


# ----------------------------------------------------------------------------------------
# QA
# ----------------------------------------------------------------------------------------


def band_report(x):
    m = mono_sum(x)
    f, p = sg.welch(m, SR, nperseg=8192)
    bands = [("sub 20-60", 20, 60), ("bass 60-250", 60, 250), ("lowmid 250-1k", 250, 1000), ("mid 1-4k", 1000, 4000),
             ("high 4-10k", 4000, 10000), ("air 10k+", 10000, 22050)]
    tot = p[(f >= 20)].sum()
    return {n_: round(10 * np.log10(p[(f >= lo) & (f < hi)].sum() / tot + 1e-12), 1) for n_, lo, hi in bands}


def rms_db(x):
    return 20 * np.log10(np.sqrt((x ** 2).mean()) + 1e-12)


def seam_report(x, label):
    """Concatenate 3 copies; compare the seam against the rest of the file."""
    L = len(x)
    t3 = np.concatenate([x, x, x])
    d = np.abs(np.diff(t3, axis=0)).max(axis=1)
    idx = np.array([L - 1, 2 * L - 1])
    mask = np.ones(len(d), bool)
    for i in idx:
        mask[max(0, i - 200) : i + 200] = False
    seam_jump = float(d[idx].max())
    p999, mx = float(np.percentile(d[mask], 99.9)), float(d[mask].max())
    mono = mono_sum(t3)
    hp = sg.sosfilt(sg.butter(4, 6000 / (SR / 2), "high", output="sos"), mono)
    w = int(0.002 * SR)
    e = np.sqrt(uniform_filter1d(hp ** 2, w))
    seam_e = float(max(e[L - w : L + w].max(), e[2 * L - w : 2 * L + w].max()))
    others = e[w : L - 4 * w]
    # spectral flux over frames that straddle the seam vs everywhere else
    f_, tt, Z = sg.stft(mono, SR, nperseg=2048, noverlap=1536)
    mag = np.log10(np.abs(Z[f_ < 16000]) + 1e-7)  # codec passband only: the MP3 lowpass leaves >16 kHz empty (log-unstable)
    flux = np.sqrt((np.diff(mag, axis=1) ** 2).mean(axis=0))
    fr_seam = [int(round(L / 512)) - 1 + k for k in (-2, -1, 0, 1, 2)]
    seam_flux = float(max(flux[i] for i in fr_seam if 0 <= i < len(flux)))
    # reference: the same measures at the other riser-to-downbeat points (bars 16 and 24) of the middle copy
    ref_flux = [float(max(flux[int(round((L + k * BAR * SR) / 512)) + j] for j in (-2, -1, 0, 1, 2))) for k in (16, 24)]
    ref_hf = [float(e[L + int(k * BAR * SR) - w : L + int(k * BAR * SR) + w].max()) / float(np.percentile(others, 99)) for k in (16, 24)]
    return dict(label=label,
                ref_downbeat_flux_bar16_24=[round(v, 3) for v in ref_flux], ref_downbeat_hf_vs_p99=[round(v, 3) for v in ref_hf],
                seam_jump=round(seam_jump, 6), local_p99_9_jump=round(p999, 6), local_max_jump=round(mx, 6),
                seam_jump_vs_local_max=round(seam_jump / mx, 3),
                hf_energy_seam_vs_p99=round(seam_e / float(np.percentile(others, 99)), 3),
                spectral_flux_seam=round(seam_flux, 4), flux_p99=round(float(np.percentile(flux, 99)), 4),
                flux_percentile_of_seam=round(float((flux < seam_flux).mean() * 100), 1))


def spectro_png(wav, png, title, marks=()):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    x, sr = sf.read(wav)
    m = mono_sum(x)
    f, tt, S = sg.spectrogram(m, sr, nperseg=2048, noverlap=1536, window="hann")
    Sdb = 10 * np.log10(S + 1e-14)
    fig, ax = plt.subplots(2, 1, figsize=(14, 7.5), gridspec_kw=dict(height_ratios=[1, 2.6]), sharex=True)
    t = np.arange(len(m)) / sr
    step = max(1, len(m) // 6000)
    ax[0].plot(t[::step], m[::step], lw=0.4, color="#d11")
    ax[0].set_ylim(-1, 1)
    ax[0].set_title(title)
    ax[1].pcolormesh(tt, f[1:], Sdb[1:], vmin=Sdb.max() - 95, vmax=Sdb.max(), cmap="magma", shading="auto")
    ax[1].set_yscale("log")
    ax[1].set_ylim(30, 20000)
    for mk in marks:
        ax[0].axvline(mk, color="cyan", lw=0.8)
        ax[1].axvline(mk, color="cyan", lw=0.8)
    ax[1].set_xlabel("s")
    plt.tight_layout()
    fig.savefig(png, dpi=80)
    plt.close(fig)


def rms_per_second(x, sec=1.0):
    k = int(sec * SR)
    return [round(rms_db(x[i : i + k]), 1) for i in range(0, len(x) - k + 1, k)]


def qa(names):
    for nm in names:
        mp3 = os.path.join(OUT, nm + ".mp3")
        wav = os.path.join(SCRATCH, nm + "_qa.wav")
        y = decode(mp3, wav)
        I, tp, lra = ebur(wav)
        print(f"== {nm}: {len(y)/SR:.4f}s  {os.path.getsize(mp3)/1024:.1f} KB  I={I} LUFS  TP={tp} dBTP  LRA={lra}")
        print("   sample peak dBFS", round(20 * np.log10(np.abs(y).max() + 1e-12), 2),
              " DC", np.round(y.mean(axis=0), 6).tolist(), " clipped>=0.999:", int((np.abs(y) >= .999).sum()))
        if len(y) > 2 * SR:
            r = rms_per_second(y)
            print("   RMS dB/s:", r if len(r) < 20 else r[:12] + ["..."] + [f"min {min(r)}", f"max {max(r)}"])
            print("   bands (dB re total):", band_report(y))
        marks = [HIT] if nm == "intro" else []
        spectro_png(wav, os.path.join(SCRATCH, nm + ".png"), nm, marks)
        if nm == "loop":
            print("  ", seam_report(y, "decoded mp3"))
            src = os.path.join(SCRATCH, "loop_master.wav")
            if os.path.exists(src):
                print("  ", seam_report(sf.read(src)[0], "pre-encode master"))
            side = (y[:, 0] - y[:, 1]) / 2
            mid = (y[:, 0] + y[:, 1]) / 2
            print("   side/mid energy dB:", round(rms_db(side) - rms_db(mid), 1),
                  " L/R corr:", round(float(np.corrcoef(y[:, 0], y[:, 1])[0, 1]), 3))


# ----------------------------------------------------------------------------------------
# DRIVERS
# ----------------------------------------------------------------------------------------


def do_intro():
    x = build_intro()
    y, st = finalize("intro", x, -14.0, ceil_db=-1.5)
    ticks = tick_times()
    with open(os.path.join(OUT, "intro_cues.json"), "w") as f:
        json.dump(dict(hitTime=HIT, duration=INTRO_LEN, tickRatePerSecond=[8, 24],
                       ticks=[round(float(v), 4) for v in ticks]), f, indent=1)
    print(st)


def do_sfx():
    for name, fn, lufs_ceil in (("tick", build_tick, None), ("whoosh", build_whoosh, None), ("lock", build_lock, None)):
        x = fn()
        wav = os.path.join(SCRATCH, name + ".wav")
        mp3 = os.path.join(OUT, name + ".mp3")
        write_wav(wav, x)
        encode_mp3(wav, mp3)
        dec = decode(mp3, os.path.join(SCRATCH, name + "_dec.wav"))
        I, tp, _ = ebur(os.path.join(SCRATCH, name + "_dec.wav"))
        print(dict(file=name + ".mp3", seconds=round(len(dec) / SR, 3), bytes=os.path.getsize(mp3), lufs=I, tp=tp,
                   peak_db=round(float(20 * np.log10(np.abs(dec).max())), 2)))


def do_loop(target=-16.0):
    cache = os.path.join(SCRATCH, "stems.npz")
    if "--reuse" in sys.argv and os.path.exists(cache):  # re-balance without re-rendering the voices
        z = np.load(cache)
        stems = {k: z[k] for k in STEM_DB}
        duck = [tuple(r) for r in z["duck"]]
    else:
        stems, duck = build_loop()
        np.savez(cache, duck=np.array(duck), **stems)
    mix, S, sends = mix_loop(stems, duck)
    print("stem RMS dB (post-gain):", {k: round(rms_db(v), 1) for k, v in S.items()}, {k: round(rms_db(v), 1) for k, v in sends.items()})
    m = master_loop(mix)
    y, st = finalize("loop", m, target, ceil_db=-1.6, periodic=True)
    print(st)
    ogg = os.path.join(OUT, "loop.ogg")
    run(["ffmpeg", "-y", "-loglevel", "error", "-i", os.path.join(SCRATCH, "loop_master.wav"), "-af", "volume=-0.4dB", "-c:a", "libvorbis", "-q:a", "5", ogg])  # -0.4 dB matches the MP3's decoded loudness
    mp3b, oggb = os.path.getsize(os.path.join(OUT, "loop.mp3")), os.path.getsize(ogg)
    print("ogg", oggb, "mp3", mp3b)
    if oggb >= mp3b:
        print("(ogg is not smaller than mp3; kept anyway as a gapless fallback)")


if __name__ == "__main__":
    what = sys.argv[1] if len(sys.argv) > 1 else "all"
    if what in ("intro", "all"):
        do_intro()
    if what in ("sfx", "all"):
        do_sfx()
    if what in ("loop", "all"):
        do_loop()
    if what == "qa":
        qa(sys.argv[2:] or ["intro", "loop", "tick", "whoosh", "lock"])
