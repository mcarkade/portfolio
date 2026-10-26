"""Reproducible licensed music edit and original interface sound design.

Run download_source.py, then `python tools/audio/compose.py`.
Use `python tools/audio/compose.py qa` to check the delivered codecs again.
Requires numpy, scipy, soundfile, matplotlib, requests, and ffmpeg on PATH.
Only compact measurements and a spectrogram are kept beside this script.
Temporary audio stays in C:\\Abhinav\\Projects\\_scratch\\audio.
"""
from pathlib import Path
import hashlib
import json
import shutil
import subprocess
import sys
import numpy as np
import scipy.signal as sig
import soundfile as sf

SR = 44100
ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'public' / 'audio'
HERE = Path(__file__).resolve().parent
SCRATCH = Path(r'C:\Abhinav\Projects\_scratch\audio')
SOURCE = SCRATCH / 'cylinder-seven.m4a'
START = 72.0
LENGTH = 44.0
OVERLAP = 4.0
HIT = 4.4
INTRO_LENGTH = HIT + 2.1
RNG = np.random.default_rng(7026)
LOOP_ROTATION_SECONDS = 0


def run(args):
    return subprocess.run([str(a) for a in args], capture_output=True, text=True,
                          check=True, timeout=180)


def decode(path, tag):
    wav = SCRATCH / (tag + '.wav')
    run(['ffmpeg', '-y', '-v', 'error', '-i', path, '-ar', SR, '-ac', '2', '-c:a', 'pcm_f32le', wav])
    return sf.read(wav)[0]


def meter(path, target=-16):
    r = run(['ffmpeg', '-hide_banner', '-nostats', '-i', path, '-af',
             f'loudnorm=I={target}:TP=-1.8:LRA=11:print_format=json', '-f', 'null', '-'])
    return json.JSONDecoder().raw_decode(r.stderr[r.stderr.rfind('{'):])[0]


def filt(x, lo=None, hi=None, periodic=False):
    sos = []
    if lo:
        sos.extend(sig.butter(2, lo, 'highpass', fs=SR, output='sos'))
    if hi:
        sos.extend(sig.butter(2, hi, 'lowpass', fs=SR, output='sos'))
    if periodic:
        n = min(SR * 2, len(x))
        return sig.sosfilt(np.array(sos), np.concatenate((x[-n:], x)), axis=0)[n:]
    return sig.sosfilt(np.array(sos), x, axis=0)


def rms(x):
    return float(np.sqrt(np.mean(x * x)))


def fade(x, attack, release):
    x = x.copy()
    a, b = int(attack * SR), int(release * SR)
    if a:
        x[:a] *= (0.5 - 0.5 * np.cos(np.linspace(0, np.pi, a)))[:, None]
    if b:
        x[-b:] *= (0.5 + 0.5 * np.cos(np.linspace(0, np.pi, b)))[:, None]
    return x


def pan(x, amount=0):
    return x[:, None] * np.array([np.cos((amount + 1) * np.pi / 4), np.sin((amount + 1) * np.pi / 4)])


def narrow(x, periodic=False):
    mid = x.mean(axis=1)
    side = filt((x[:, 0] - x[:, 1]) * 0.5, lo=180, periodic=periodic) * 0.22
    return np.stack((mid + side, mid - side), axis=-1)


def room(x, seconds=1.5, wet=0.2):
    # A damped stereo convolution tail, with sparse early reflections.
    n = int(seconds * SR)
    t = np.arange(n) / SR
    ir = filt(RNG.normal(size=(n, 2)), lo=220, hi=3200)
    ir *= (np.exp(-t * 7 / seconds) * (1 - np.exp(-t / 0.018)))[:, None]
    ir /= np.sqrt(np.sum(ir * ir, axis=0))
    for delay, level in [(0.023, 0.14), (0.041, 0.09), (0.067, 0.05)]:
        ir[int(delay * SR), 0] += level
        ir[int((delay + 0.007) * SR), 1] += level
    mono = np.mean(x, axis=1)
    return x + wet * np.stack([sig.fftconvolve(mono, ir[:, c])[:len(x)] for c in (0, 1)], axis=-1)


def loop_edit(source):
    global LOOP_ROTATION_SECONDS
    # End-to-start overlap: the final sample approaches the sample before y[0].
    # Unlike fading to silence, this keeps the room bed alive at the loop point.
    n, k = int(LENGTH * SR), int(OVERLAP * SR)
    a = source[int(START * SR):int(START * SR) + n + k].copy()
    assert len(a) == n + k
    y = a[k:].copy()
    w = (0.5 - 0.5 * np.cos(np.linspace(0, np.pi, k, endpoint=False)))[:, None]
    y[-k:] = a[-k:] * (1 - w) + a[:k] * w
    y = narrow(filt(y, lo=32, hi=8500, periodic=True), periodic=True)
    y *= 0.11 / rms(y)
    # A slow, mono sub pulse adds movement without a drum kit or melodic hook.
    # Every tail wraps into the next cycle before mastering.
    pulse = np.zeros(n)
    tt = np.arange(int(2.5 * SR)) / SR
    body = np.sin(2 * np.pi * (48 * tt + 1.7 * (1 - np.exp(-tt / 0.06))))
    body *= (1 - np.exp(-tt / 0.035)) * np.exp(-tt / 0.48)
    for t0 in np.arange(0.8, LENGTH, 2.0):
        idx = (int(t0 * SR) + np.arange(len(body))) % n
        pulse[idx] += body * 0.045
    y += pan(pulse)
    y -= y.mean(axis=0)
    # Lossy decoders reconstruct their edges differently. Put that edge at a
    # quiet crossing in both channels instead of at a high-amplitude waveform.
    # Circular rotation preserves the full loop and its existing transition.
    score = np.max(np.abs(y), axis=1)
    score[1:] += 4 * np.max(np.abs(np.diff(y, axis=0)), axis=1)
    at = SR + int(np.argmin(score[SR:-SR]))
    LOOP_ROTATION_SECONDS = round(at / SR, 6)
    return np.roll(y, -at, axis=0)


def tick():
    t = np.arange(int(0.045 * SR)) / SR
    y = filt(RNG.normal(size=len(t)), lo=550, hi=2400) * np.exp(-t / 0.004)
    y += np.sin(2 * np.pi * 380 * t) * np.exp(-t / 0.007) * 0.15
    return fade(pan(y), 0.0015, 0.012)


def whoosh():
    t = np.arange(int(0.36 * SR)) / SR
    y = filt(RNG.normal(size=(len(t), 2)), lo=350, hi=2100)
    env = np.sin(np.pi * t / 0.36) ** 2.2
    return fade(y * env[:, None], 0.015, 0.07)


def lock():
    t = np.arange(int(0.19 * SR)) / SR
    body = np.sin(2 * np.pi * (520 * t + 0.5 * (1 - np.exp(-t / 0.008)))) * np.exp(-t / 0.027)
    contact = filt(RNG.normal(size=len(t)), lo=500, hi=2200) * np.exp(-t / 0.008) * 0.32
    return fade(room(pan(body * 0.45 + contact), 0.18, 0.12), 0.002, 0.06)


def intro_edit(source):
    n = int(INTRO_LENGTH * SR)
    t = np.arange(n) / SR
    bed = source[int(START * SR):int(START * SR) + n].copy()
    bed = narrow(filt(bed, lo=100, hi=4500))
    bed *= 0.065 / rms(bed)
    u = np.clip(t / HIT, 0, 1)
    bed *= (0.25 + 0.75 * u ** 1.6)[:, None]
    # The reverse source texture opens into a short breath before the slam.
    rise = filt(bed[::-1], lo=450, hi=2800)
    bed += rise * (u ** 2 * 0.8)[:, None]
    bed *= (1 - 0.9 * np.clip((t - HIT + 0.075) / 0.04, 0, 1))[:, None]
    frame_times = []
    at, gap = 0.15, 0.34
    while at < HIT - 0.08:
        frame_times.append(at)
        at += gap
        gap = max(0.042, gap * 0.86)
    # Only the first turns speak; the fast cuts merge into the source swell.
    for at in frame_times[:8]:
        y = tick()
        y *= 0.021 / max(np.max(np.abs(y)), 1e-9)
        i = round(at * SR)
        bed[i:i + len(y)] += y
    m = n - round(HIT * SR)
    th = np.arange(m) / SR
    sub = np.sin(2 * np.pi * (43 * th + 5.5 * (1 - np.exp(-th / 0.055))))
    sub *= (1 - np.exp(-th / 0.003)) * np.exp(-th / 0.42)
    contact = filt(RNG.normal(size=m), lo=100, hi=1800)
    contact *= (1 - np.exp(-th / 0.001)) * np.exp(-th / 0.045)
    grain = source[int((START + 12) * SR):int((START + 12) * SR) + m].copy()
    grain = narrow(filt(grain, lo=180, hi=3200))
    grain *= 0.11 / rms(grain)
    grain *= ((1 - np.exp(-th / 0.006)) * np.exp(-th / 0.32))[:, None]
    hit = pan(sub * 0.65 + contact * 0.6) + grain
    hit = room(hit, seconds=1.6, wet=0.32)
    bed[round(HIT * SR):] += hit
    return fade(filt(bed, lo=30, hi=9500), 0.03, 0.65), frame_times[:8]


def encode(name, x, target=None, peak=None):
    raw = SCRATCH / (name + '-raw.wav')
    mastered = SCRATCH / (name + '-master.wav')
    if peak is not None:
        x = x * 10 ** (peak / 20) / np.max(np.abs(x))
    sf.write(raw, x, SR, subtype='FLOAT')
    if target is None:
        shutil.copyfile(raw, mastered)
    else:
        m = meter(raw, target)
        opts = ':'.join([f'I={target}', 'TP=-1.8', 'LRA=11', f'measured_I={m["input_i"]}',
                         f'measured_TP={m["input_tp"]}', f'measured_LRA={m["input_lra"]}',
                         f'measured_thresh={m["input_thresh"]}', f'offset={m["target_offset"]}', 'linear=true'])
        run(['ffmpeg', '-y', '-v', 'error', '-i', raw, '-af', 'loudnorm=' + opts,
             '-ar', SR, '-c:a', 'pcm_f32le', mastered])
    run(['ffmpeg', '-y', '-v', 'error', '-i', mastered, '-map_metadata', '-1',
         '-c:a', 'libmp3lame', '-b:a', '128k', '-write_xing', '1', OUT / (name + '.mp3')])
    if name == 'loop':
        run(['ffmpeg', '-y', '-v', 'error', '-i', mastered, '-map_metadata', '-1',
             '-c:a', 'libvorbis', '-q:a', '4', OUT / 'loop.ogg'])
    if target is not None:
        # Compensate each codec's decoded gain separately, without using up the peak margin.
        for suffix in (['mp3', 'ogg'] if name == 'loop' else ['mp3']):
            path = OUT / (name + '.' + suffix)
            measured = meter(path, target)
            gain = min(target - 0.05 - float(measured['input_i']), -1.25 - float(measured['input_tp']))
            if abs(gain) > 0.08:
                codec = ['-c:a', 'libmp3lame', '-b:a', '128k', '-write_xing', '1'] if suffix == 'mp3' else ['-c:a', 'libvorbis', '-q:a', '4']
                run(['ffmpeg', '-y', '-v', 'error', '-i', mastered, '-map_metadata', '-1',
                     '-af', f'volume={gain}dB', *codec, path])


def seam(x):
    n = len(x)
    jump = float(np.max(np.abs(x[0] - x[-1])))
    steps = np.max(np.abs(np.diff(x, axis=0)), axis=1)
    # Join in the centre so STFT padding cannot masquerade as spectral flux.
    triple = np.tile(x.mean(axis=1), 3)
    f, tt, z = sig.stft(triple, SR, nperseg=2048, noverlap=1536, boundary=None)
    mag = np.abs(z[(f >= 30) & (f < 12000)])
    flux = np.sqrt(np.mean(np.diff(mag, axis=1) ** 2, axis=0))
    near = np.abs(tt[1:] - n / SR) <= 0.04
    interior = (tt[1:] > 0.1) & (tt[1:] < n / SR - 0.1)
    sfmax = float(flux[near].max())
    return {'sample_jump': jump, 'jump_dbfs': float(20 * np.log10(jump + 1e-12)),
            'interior_step_p99': float(np.percentile(steps, 99)),
            'flux_at_join': sfmax, 'flux_interior_p95': float(np.percentile(flux[interior], 95)),
            'flux_join_percentile': float(100 * np.mean(flux[interior] < sfmax))}


def onsets(x):
    mono = x.mean(axis=1)
    _, tt, z = sig.stft(mono, SR, nperseg=512, noverlap=384, boundary=None)
    mag = np.abs(z)
    flux = np.maximum(np.diff(mag, axis=1), 0).sum(axis=0)
    peaks, _ = sig.find_peaks(flux, distance=int(0.065 * SR / 128), prominence=flux.max() * 0.04)
    times = tt[peaks + 1] - 256 / SR
    # Leading edge of the dominant impact, measured in 2 ms RMS windows.
    k = round(0.002 * SR)
    energy = np.array([rms(x[i:i + k]) for i in range(0, len(x) - k, k)])
    a, b = int((HIT - 0.02) * SR / k), int((HIT + 0.09) * SR / k)
    edge = a + int(np.argmax(np.diff(energy[a:b])))
    return round(float(edge * k / SR), 5), [round(float(v), 4) for v in times]


def plots(decoded):
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    fig, axes = plt.subplots(2, 2, figsize=(12, 6), constrained_layout=True)
    for row, name in enumerate(('intro.mp3', 'loop.mp3')):
        x = decoded[name]
        mono = x.mean(axis=1)
        t = np.arange(len(x)) / SR
        axes[row, 0].plot(t[::128], mono[::128], color='#b51e37', linewidth=0.45)
        axes[row, 0].set_title(name + ' decoded waveform')
        axes[row, 0].set_ylim(-1, 1)
        f, tt, p = sig.spectrogram(mono, SR, nperseg=2048, noverlap=1024)
        axes[row, 1].pcolormesh(tt, f[1:], 10 * np.log10(p[1:] + 1e-14), cmap='magma', vmin=-105, vmax=-30, shading='auto')
        axes[row, 1].set_yscale('log')
        axes[row, 1].set_ylim(30, 18000)
        axes[row, 1].set_title(name + ' spectrum, Hz')
        if row == 0:
            axes[row, 0].axvline(HIT, color='#222', linewidth=0.8)
            axes[row, 1].axvline(HIT, color='cyan', linewidth=0.8)
    fig.savefig(HERE / 'spectrogram.png', dpi=110)
    plt.close(fig)


def qa():
    decoded, report = {}, {'sample_rate': SR, 'files': {}}
    if LOOP_ROTATION_SECONDS:
        report['loop_rotation_seconds'] = LOOP_ROTATION_SECONDS
    for file in ['intro.mp3', 'loop.mp3', 'loop.ogg', 'tick.mp3', 'whoosh.mp3', 'lock.mp3']:
        path = OUT / file
        x = decode(path, file.replace('.', '-decoded-'))
        decoded[file] = x
        m = meter(path)
        f, p = sig.welch(x.mean(axis=1), SR, nperseg=min(8192, len(x)))
        total = p.sum()
        r = {'seconds': round(len(x) / SR, 6), 'bytes': path.stat().st_size,
             'sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
             'integrated_lufs': float(m['input_i']) if np.isfinite(float(m['input_i'])) else None, 'true_peak_dbtp': float(m['input_tp']),
             'loudness_range_lu': float(m['input_lra']), 'dc': x.mean(axis=0).tolist(),
             'clipped_samples': int((np.abs(x) >= 1).sum()),
             'energy_above_8k_percent': float(100 * p[f > 8000].sum() / total)}
        if file.startswith('loop'):
            r['seam'] = seam(x)
            r['stereo_correlation'] = float(np.corrcoef(x.T)[0, 1])
            r['mono_fold_loss_db'] = float(20 * np.log10(rms(x.mean(axis=1)) / rms(x)))
        report['files'][file] = r
        print(file, json.dumps(r), flush=True)
    hit, detected = onsets(decoded['intro.mp3'])
    report['intro_onsets_seconds'] = detected
    report['measured_hit_leading_edge_seconds'] = hit
    cues = json.loads((OUT / 'intro_cues.json').read_text())
    report['cue_error_ms'] = round(1000 * abs(cues['hitTime'] - hit), 3)
    plots(decoded)
    (HERE / 'qa.json').write_text(json.dumps(report, indent=2) + '\n')
    for file, r in report['files'].items():
        assert r['true_peak_dbtp'] <= -1, (file, 'true peak')
        assert not r['clipped_samples'], (file, 'clipping')
        if file.startswith('loop'):
            assert abs(r['integrated_lufs'] + 16) < 0.6, (file, 'loudness')
            assert r['seam']['sample_jump'] < r['seam']['interior_step_p99'], (file, 'sample continuity')
            assert r['seam']['flux_at_join'] < r['seam']['flux_interior_p95'], (file, 'spectral join')
            assert r['mono_fold_loss_db'] > -3, (file, 'mono compatibility')
    assert abs(report['files']['intro.mp3']['integrated_lufs'] + 14) < 0.6
    assert report['files']['intro.mp3']['bytes'] < 200000
    assert sum(report['files'][f]['bytes'] for f in ('loop.mp3', 'loop.ogg')) < 1500000
    assert report['cue_error_ms'] < 12
    print('PASS: delivered-codec loudness, peaks, payload, loop joins and logo cue', flush=True)


def produce():
    assert shutil.disk_usage('C:\\').free > 11 * 1024**3
    SCRATCH.mkdir(parents=True, exist_ok=True)
    baseline = SCRATCH / 'baseline'
    if not baseline.exists():
        baseline.mkdir()
        for file in OUT.iterdir():
            if file.suffix in ('.mp3', '.ogg', '.json'):
                shutil.copy2(file, baseline / file.name)
    source = decode(SOURCE, 'source')
    encode('loop', loop_edit(source), target=-16)
    intro, frame_times = intro_edit(source)
    encode('intro', intro, target=-14)
    for name, fn, level in [('tick', tick, -23), ('whoosh', whoosh, -20), ('lock', lock, -19)]:
        encode(name, fn(), peak=level)
    hit, detected = onsets(decode(OUT / 'intro.mp3', 'intro-cue-check'))
    cues = {'hitTime': hit, 'duration': INTRO_LENGTH, 'ticks': frame_times,
            'detectedOnsets': detected, 'measurement': 'Decoded MP3, 2 ms RMS leading edge for logo hit; positive STFT spectral flux for other onsets. Only hitTime is consumed by main.js.'}
    (OUT / 'intro_cues.json').write_text(json.dumps(cues, indent=2) + '\n')
    qa()


if __name__ == '__main__':
    SCRATCH.mkdir(parents=True, exist_ok=True)
    if len(sys.argv) > 1 and sys.argv[1] == 'qa':
        qa()
    else:
        produce()
