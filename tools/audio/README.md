# Portfolio audio

The score uses an edited, licensed recording of "Cylinder Seven" by Chris
Zabriskie, with original sub pulses, a title impact and quiet interface sounds.
The previous melody, arpeggios, bell layer and drum arrangement are replaced.
Full source, permission, copyright and adaptation details are in
[`public/audio/CREDITS.md`](../../public/audio/CREDITS.md).

## Rebuild and checks

1. `python tools/audio/download_source.py` retrieves the composer's stream,
   verifies its SHA-256 against `source.json` and saves licence pages to scratch.
2. `python tools/audio/compose.py` renders and checks all six audio files.
3. `python tools/audio/compose.py qa` checks the current delivered codecs.
4. With Vite running on port 5291, `node tools/audio/check.mjs` checks real
   Chromium decoding, intro timing/skip, UI debounce, singleton loop, mute and
   attribution. It closes its own browser.
5. `npm run build` checks the application build.

Dependencies are documented in the composer script. Scratch stays in
`C:\Abhinav\Projects\_scratch\audio`, capped by the fixed render lengths and a
64 MiB source limit. The download has a 150-second overall deadline. Rendering
requires 11 GiB free before starting, preserving the project's 10 GiB floor.
The source recording is intentionally not stored in the repository.

`qa.json` records ffmpeg loudness, true peaks, sample continuity, spectral flux,
mono compatibility and asset hashes. `spectrogram.png` shows decoded assets.
`browser-qa.json` records Chromium Web Audio checks at its actual sample rate.
Short effects have no integrated LUFS reading because they are shorter than the
400 ms measurement window; use their measured true peaks instead.

The logo cue is the decoded impact's leading edge, about 4.398 seconds. The
sting lasts 6.5 seconds. `main.js` consumes only `hitTime`; `intro.js` computes
its own frame-flip schedule. `ticks` describes the eight soft designed turns;
`detectedOnsets` contains the measured positive spectral-flux peaks. The source
texture also has its own small transients. Only the logo cue drives the film.

## Playback changes

The public Audio API is unchanged. The live engine now uses a short harmonic
series instead of saw/square oscillators, gentler waveshaping and a lower,
non-resonant cutoff. Props use soft band-limited air and a quiet sine component.
Vehicle gains are reduced; all effects pass through a 4.5 kHz low-pass filter.
Hover, chapter and lock effects have cooldowns. The intro suppresses scene and
UI sounds, skip fades its tail, finished one-shots disconnect, and muting also
clears the vehicle gains. The existing footer Credits list receives a link to
the audio attribution through `audio.js`.

## Handoff limits

These are signal and runtime checks, not listening approval. Headphone,
speaker, phone, Safari and subjective musical quality still need an audition.
The existing footer's "How this was made" prose is outside this worker's edit
scope and may still say the score was composed entirely from code. The lead
should update that sentence when integrating the new licensed recording.
