# mcarkade

Abhinav Pullela's portfolio, built as one continuous scroll-driven film.

**Live:** https://mcarkade.vercel.app

![MCARKADE](public/og.jpg)

## What's in it

1. **Title sequence.** Frames of my projects flip through the letters of MCARKADE, then slam into a red block. Click the logo to replay it.
2. **Multiroads.** The McLaren MP4/5 from my browser racing game opens the film, then the RB19 and W11, then the MP4/5 comes apart and launches through the light gates.
3. **The drone.** My F450 quadcopter comes apart into a risograph technical print and takes off.
4. **Meshmerize and lock-on.** The camera follows the drone onto the white-line map. A Pico robot runs the shortest route, then you fly the drone while a counter-drone turret tracks it.
5. **Work, about and contact.**

Press `L` for the lights and `M` for sound.

All three cars load, upload their textures, compile their shaders and draw behind the loading screen before Enter appears. The drone's camera dive opens into the project gallery through a hexagonal aperture. Reduced motion disables the aperture and the intro.

Manual wheel and touch scrolling share a 1.8 viewport-per-second limit and a 0.18-second eased response. Meshmerize runs through a compact 180vh chapter. Menu links and Tour keep their own navigation timing.

## Run it

```bash
npm install
npm run dev      # http://localhost:5173
npm run build
```

For browser checks, serve the build with `npm run preview -- --port 5192`, then run `node tools/verify.mjs http://localhost:5192/ <output-folder> desktop`. Repeat with `phone`, `reduced` or `fallback`. Run `node tools/navigation-check.mjs http://localhost:5192/ <output-folder>` for section navigation, keyboard, history and overlay recovery at desktop and phone sizes. Captures and JSON reports go to the chosen folder. Gallery stills can be regenerated with `python tools/gallery-art/build.py`.

`node tools/maze-path-check.mjs <Meshmerize-source>` checks the traced map, shortest route and reversible robot motion. `node tools/intro-check.mjs http://localhost:5192/ <output-folder>` checks natural docking, sound entry and replay ducking.

`node tools/scroll-check.mjs` checks the scroll policy against installed Lenis handlers. `node tools/check-interactions.mjs http://localhost:5192/ <output-folder>` checks portrait layouts, wheel bursts and native phone touch gestures. Rebuild the supplied portrait with `python tools/portrait/build.py <original-photo>`.

## Credits

The car models are third-party works, used under Creative Commons licences for this non-commercial site:

- McLaren MP4/5: vecarz, CC BY 4.0
- Red Bull RB19: vecarz, CC BY-NC-SA 4.0
- Mercedes W11: Tyler_Kevin, CC BY 4.0

Music: "Save Us Now" by Shane Ivers and "Cylinder Seven" by Chris Zabriskie, both CC BY 4.0, edited for this site (details in `public/audio/CREDITS.md`).

Source URLs are listed in `public/media/manifest.json`. Fonts: Archivo and Geist Mono (SIL OFL). Everything else, including the drone model and the code, is original.

© 2026 Abhinav Pullela
