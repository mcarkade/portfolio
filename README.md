# mcarkade

Abhinav Pullela's portfolio, built as one continuous scroll-driven film.

**Live:** https://mcarkade.vercel.app

![MCARKADE](public/og.jpg)

## What's in it

1. **Title sequence.** Frames of my projects flip through the letters of MCARKADE, then slam into a red block. Click the logo to replay it.
2. **Multiroads.** The McLaren MP4/5 from my browser racing game opens the film, then the RB19 and W11, then the MP4/5 comes apart and launches through the light gates.
3. **The drone.** My F450 quadcopter comes apart into a risograph technical print and takes off.
4. **Vision and lock-on.** The drone flies its mission through its thermal camera, then you fly it while a counter-drone turret tries to hold it in the crosshair.
5. **Work, about and contact.**

Press `L` for the lights and `M` for sound.

All three cars load, upload their textures, compile their shaders and draw behind the loading screen before Enter appears. The drone's camera dive opens into the project gallery through a scroll-controlled aperture. Reduced motion disables that aperture and the intro.

Manual wheel and touch scrolling share a 0.45 viewport-per-second limit and an eased response. Menu links and Tour keep their own navigation timing.

## Run it

```bash
npm install
npm run dev      # http://localhost:5173
npm run build
```

For browser checks, serve the build with `npm run preview -- --port 5192`, then run `node tools/verify.mjs http://localhost:5192/ <output-folder> desktop`. Repeat with `phone`, `reduced` or `fallback`. Captures and JSON reports go to the chosen folder. Gallery stills can be regenerated with `python tools/gallery-art/build.py`.

`node tools/scroll-check.mjs` checks the scroll policy against installed Lenis handlers. `node tools/check-interactions.mjs http://localhost:5192/ <output-folder>` checks portrait layouts, wheel bursts and native phone touch gestures. Rebuild the supplied portrait with `python tools/portrait/build.py <original-photo>`.

## Credits

The car models are third-party works, used under Creative Commons licences for this non-commercial site:

- McLaren MP4/5: vecarz, CC BY 4.0
- Red Bull RB19: vecarz, CC BY-NC-SA 4.0
- Mercedes W11: Tyler_Kevin, CC BY 4.0

Music: "Save Us Now" by Shane Ivers and "Cylinder Seven" by Chris Zabriskie, both CC BY 4.0, edited for this site (details in `public/audio/CREDITS.md`).

Source URLs are listed in `public/media/manifest.json`. Fonts: Archivo and Geist Mono (SIL OFL). Everything else, including the drone model and the code, is original.

© 2026 Abhinav Pullela
