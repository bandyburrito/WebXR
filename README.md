# WebXR projects (HSLU WebXR module)

## Sort It Out ♻️: a recycling game in AR

Trash shows up all around you in your real room. Pick it up and throw it into the right bin
before time runs out. Recycling in Switzerland has a lot of rules, and this game helps you
learn them by playing.

**Play:** https://bandyburrito.github.io/WebXR/sort-it-out/
(Chrome on an Android phone with ARCore. On a PC you get a test mode instead.)

### How to play
1. Tap **Start AR**, point your phone at the floor and tap to place the bins.
2. Find the trash around you. Some of it is behind you, some on tables. Follow the yellow markers.
3. Tap trash to pick it up, aim at the right bin and swipe up to throw.
4. Right bin: points (plus a bonus for 3 in a row). Wrong bin: you lose 5 seconds.

There are 3 rounds of 2 minutes:
1. **The basics:** easy items
2. **Rush hour:** more items, and trash rolls away if you leave it too long
3. **Tricky trash:** items that look recyclable but aren't

### The bins (Swiss rules, simplified)
| Bin | What goes in |
|-----|--------------|
| PET | drink bottles only, in any colour |
| ALU | cans, trays, foil |
| GLASS | sorted by colour: clear, brown, green (other colours go into green) |
| PAPER | newspapers, magazines, office paper |
| TRASH | household waste: shampoo bottles, oil bottles, drinking glasses, greasy pizza boxes… |

### Files
| File | What it does |
|------|--------------|
| `sort-it-out/index.html` | the page: start screen, HUD, round screen, AR scene |
| `sort-it-out/game.js` | game logic: rounds, input, throwing physics, scoring, floor detection |
| `sort-it-out/items.js` | the bins, all trash items (with their rules and tips) and the rounds |
| `sort-it-out/sounds.js` | sound effects (made in code, no sound files) |

Built with [A-Frame 1.7.1](https://aframe.io) and WebXR (`immersive-ar`, hit test, DOM overlay). No build step.

### Test it
**On a PC:** start a small web server in this folder, then open the link and click **Test on PC**.
```
python3 -m http.server 8000
```
→ http://localhost:8000/sort-it-out/
Arrow keys = look around, WASD = walk, click = tap, drag the mouse up = throw.

**On your phone:** push to GitHub and open the link above (wait about a minute after a push).
For a phone on USB (see errors in `chrome://inspect` on the PC):
```
adb reverse tcp:8000 tcp:8000
```
→ http://localhost:8000/sort-it-out/ in Chrome on the phone.

**Floor not found?** Open the link with `?debug` at the end to see what the floor detection sees.
After 10 seconds without a floor, a button lets you use the phone's estimated floor instead.

### Tuning
All game settings are at the top of `sort-it-out/game.js`: round time, points, time penalty,
throw power, gravity, aim assist, roll-away time…

### Adding 3D models
The trash is built from simple shapes. To use a real model (e.g. a free `.glb` from
[Poly Pizza](https://poly.pizza) or [Kenney](https://kenney.nl)):
1. Put the file in `sort-it-out/models/`. Its size should be in metres, with its bottom at height 0.
2. In `sort-it-out/items.js`, add `model: 'models/your-file.glb'` to the item in the `TRASH` list.
3. Credit the author if the licence asks for it (CC-BY).

## Woods scene (Pico VR)
A small VR scene for the Pico headset: https://bandyburrito.github.io/WebXR/ (`index.html` in the root).
