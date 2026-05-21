# Developer Guide

Everything you need to modify this wallpaper, add new settings, or extend the audio system.

---

## Project structure

```
index.html       Entry point — just loads script.js
script.js        All logic: WebGL fluid simulation, audio reactivity, WE API wiring
project.json     Wallpaper Engine settings panel definition
LDR_RGB1_0.png   Dithering texture used by the bloom shader
LICENSE / README
docs/            This folder
```

There is no build step. Edit the files and reload in Wallpaper Engine.

---

## Editing and testing

1. Open Wallpaper Engine → right-click the wallpaper → **Edit**
2. Make changes to `script.js` or `project.json` in any text editor
3. In WE, click **Reload** (or close and reopen the editor) to see the result
4. WE reloads the wallpaper live — you do not need to republish to test

For `project.json` changes (new settings), always validate the JSON before reloading:
```bash
node -e "JSON.parse(require('fs').readFileSync('project.json','utf8')); console.log('OK')"
```

---

## The `config` object

`script.js` opens with a `let config = { ... }` block. This is the single source of truth for all runtime parameters. Every Wallpaper Engine setting maps to a field here via `applyUserProperties`.

Key fields relevant to audio:

| Field | Default | Description |
|---|---|---|
| `SOUND_SENSITIVITY` | 0.25 | Overall gain applied to all band energies |
| `SMOOTH_ALPHA` | 0.35 | EMA weight — 1.0 = no smoothing, 0.1 = very smooth |
| `BEAT_DETECTION` | true | Enable transient burst logic |
| `BEAT_THRESHOLD` | 0.12 | Energy delta required to fire a beat burst |
| `BEAT_BURST_MULT` | 2.0 | Splat count multiplier on a beat hit |
| `STEREO_AWARENESS` | true | Bias splat x-position using L/R channel ratio |
| `FREQ_COLOR_MAPPING` | true | Use per-band hue ranges instead of random color |
| `DYNAMIC_COLORS` | false | Shift hues over time (rainbow cycle) |
| `HUE_SHIFT_SPEED` | 0.05 | Hue cycles per second — 0.05 = one full cycle every 20 s |
| `BAND_HUES` | `[0.04,0.12,0.27,0.465,0.635,0.80]` | Center hue (0–1) for each of the 6 bands |
| `BAND_LAYERS` | false | Render bass/mid/treble to separate depth layers |
| `PER_BAND_TUNING` | false | Enable per-band size/intensity/vorticity overrides |
| `BAND_SIZE_MULT` | `[1,1,1,1,1,1]` | Splat radius multiplier per band |
| `BAND_INTENSITY_MULT` | `[1,1,1,1,1,1]` | Splat count multiplier per band |
| `BAND_VORTICITY` | `[50,40,30,20,15,10]` | Fluid curl target per band; blended by energy |

---

## How Wallpaper Engine settings work

The flow from WE UI → runtime value has three parts:

### 1. `project.json` — declares the setting

Each property under `general.properties` defines one UI control:

```json
"my_setting": {
    "index": 47,
    "order": 147,
    "text": "My Setting Label",
    "type": "bool",
    "value": true
}
```

- `index` / `order` — just need to be unique integers; `order` controls display order
- `type` — `"bool"`, `"slider"`, `"color"`, `"combo"`, or `"file"`
- `condition` — optional JS expression; hides the control when false (e.g. `"audio_responsive.value"`)
- Slider extras: `"min"`, `"max"`, `"step"`, `"precision"`, `"fraction": true`

### 2. `applyUserProperties` — receives changes

Inside `document.addEventListener("DOMContentLoaded", ...)`, the `wallpaperPropertyListener` object has an `applyUserProperties` method. WE calls this on startup and whenever the user changes a setting:

```js
if (properties.my_setting) config.MY_SETTING = properties.my_setting.value;
```

For color properties, the value is a space-separated RGB string (`"1 0.5 0"`). Parse it like this:

```js
if (properties.my_color) {
    const [r, g, b] = properties.my_color.value.split(' ').map(parseFloat);
    config.MY_COLOR = { r, g, b };
}
```

### 3. `config` — consumed at runtime

The rest of `script.js` reads `config.*` fields. Changes to `config` take effect on the next frame or audio callback — no reload needed for value changes. For structural changes (e.g. allocating new framebuffers), call `initFramebuffers()` explicitly inside `applyUserProperties`.

---

## Audio system architecture

### Input format

Wallpaper Engine passes a 128-float array to the audio listener:
- Indices `0–63`: left channel, ordered low frequency → high frequency
- Indices `64–127`: right channel, same order

Index 0 is used as a validity check (`if (audioArray[0] > 5) return`) — WE sets it to a sentinel value when audio is unavailable.

### Band definitions

`AUDIO_BANDS` maps human-audible frequency ranges onto bin ranges and visual parameters:

```js
const AUDIO_BANDS = [
    { start:  0, end:  3, radius: 4.00, colorMult: 5.0, countMult:  5, hueMin: 0.00, hueMax: 0.08 }, // sub-bass
    { start:  4, end:  9, radius: 2.50, colorMult: 4.5, countMult:  7, hueMin: 0.08, hueMax: 0.16 }, // bass
    { start: 10, end: 18, radius: 1.50, colorMult: 4.0, countMult:  9, hueMin: 0.16, hueMax: 0.38 }, // low-mid
    { start: 19, end: 30, radius: 1.00, colorMult: 4.0, countMult:  9, hueMin: 0.38, hueMax: 0.55 }, // mid
    { start: 31, end: 44, radius: 0.40, colorMult: 3.5, countMult: 11, hueMin: 0.55, hueMax: 0.72 }, // high-mid
    { start: 45, end: 60, radius: 0.15, colorMult: 3.0, countMult: 13, hueMin: 0.72, hueMax: 0.88 }, // treble
];
```

| Field | Effect |
|---|---|
| `start` / `end` | Bin range within the 0–63 left-channel indices |
| `radius` | Splat size multiplier — bass = large, treble = tiny |
| `colorMult` | Brightness multiplier applied on top of the 0.15-scaled color |
| `countMult` | Splat count multiplier — treble fires more splats to compensate for size |
| `hueMin/hueMax` | Default hue range before user color pickers override via `BAND_HUES` |

### Per-frame audio processing (inside `wallpaperRegisterAudioListener`)

For each band `b`:

```
leftEnergy  = avg(audioArray[band.start .. band.end])
rightEnergy = avg(audioArray[64 + band.start .. 64 + band.end])
rawEnergy   = (leftEnergy + rightEnergy) / 2

// Exponential moving average — smooths out frame-to-frame jitter
smoothed[b] = SMOOTH_ALPHA * rawEnergy + (1 - SMOOTH_ALPHA) * smoothed[b]

// How many splats to fire this frame
totalCount = floor(smoothed[b] * SENSITIVITY * band.countMult)

// Split left/right if stereo awareness is on
if STEREO_AWARENESS:
    leftCount  = round(totalCount * leftEnergy / (leftEnergy + rightEnergy))
    rightCount = totalCount - leftCount
    fire leftCount  splats at x ≈ 0.25 (left side of screen)
    fire rightCount splats at x ≈ 0.75 (right side)
else:
    fire totalCount splats at x = random (full width)

// Beat burst — fires when energy rises sharply
delta = smoothed[b] - prevSmoothed[b]
if BEAT_DETECTION and delta > BEAT_THRESHOLD and cooldown[b] == 0:
    burstCount = floor(delta * SENSITIVITY * countMult * BEAT_BURST_MULT)
    fire burstCount splats (larger radius, brighter)
    cooldown[b] = 8   // suppress for 8 frames
```

### Color generation

`generateBandColor(hueMin, hueMax)` — called once per splat:

- `COLORFUL=false` → returns the user's fixed splat color (`POINTER_COLOR`)
- `COLORFUL=true, FREQ_COLOR_MAPPING=false` → fully random hue (`generateColor()`)
- `COLORFUL=true, FREQ_COLOR_MAPPING=true, DYNAMIC_COLORS=false` → random hue within `[hueMin, hueMax]`, derived from `BAND_HUES[b] ± 0.06`
- `COLORFUL=true, FREQ_COLOR_MAPPING=true, DYNAMIC_COLORS=true` → same, plus a time-based offset `(Date.now() * HUE_SHIFT_SPEED / 1000) % 1` added to the hue, making all bands cycle through the rainbow together at the configured speed

All colors are scaled to ~0.15 peak channel value before `colorMult` is applied. This keeps splat brightness consistent regardless of the WebGL internal scale.

### Band layers

When `BAND_LAYERS` is enabled, three separate density framebuffers are allocated (bass=0, mid=1, treble=2), all sharing one velocity simulation. Band index maps to layer via `Math.min(2, Math.floor(b / 2))`. Layers are composited back-to-front at render time using `gl.ONE, gl.ONE_MINUS_SRC_ALPHA` blending, so treble detail always sits on top of bass blobs.

---

## How to add a new Wallpaper Engine setting

**Example: add a "Turbulence" slider that controls `config.CURL`.**

### Step 1 — Add to `project.json`

Find the highest existing `index` and `order` values (currently 46 / 146) and add one more:

```json
"turbulence": {
    "fraction": false,
    "index": 47,
    "max": 100,
    "min": 0,
    "order": 147,
    "text": "Turbulence",
    "type": "slider",
    "value": 30
}
```

Place this block inside `general.properties`, after the last entry, with a comma separating it from the previous block. Validate with `node -e "JSON.parse(...)"`.

### Step 2 — Wire in `applyUserProperties`

Add one line in the `applyUserProperties` block in `script.js`:

```js
if (properties.turbulence) config.CURL = properties.turbulence.value;
```

### Step 3 — Use `config.CURL` in the simulation

The `config.CURL` field is already read by the `step()` function — no further changes needed for this example. For a brand-new field, just read it wherever it is needed in the update loop.

### Step 4 — Reload and test

Save both files, reload in WE, open the settings panel, confirm the slider appears, and drag it to verify the effect.

---

## WebGL fluid simulation overview

The simulation runs in a render loop (`update()` → `step()` → `render()`):

| Function | What it does |
|---|---|
| `step(dt)` | Advances the fluid: vorticity, divergence, pressure solve, advect velocity, advect density |
| `render(target)` | Draws the density field to screen (with optional bloom) |
| `applyBloom(source, dest)` | Multi-pass bloom: threshold → blur → composite |
| `splat(x, y, dx, dy, color)` | Injects velocity + color at a point (fixed radius) |
| `splatWithRadius(...)` | Same but with explicit radius — used by the audio system |
| `initFramebuffers()` | Allocates / resizes all FBOs; called on startup and resolution change |

The fluid lives in two double-buffered FBOs:
- `velocity` — 2-channel float texture, the flow field
- `density` — 4-channel (RGBA) texture(s), the visible color. When `BAND_LAYERS` is on, this becomes `densityLayers[0..2]`

Each frame, the advection shader reads the previous FBO, moves values along the velocity field, and writes to the other half of the double buffer. The buffers are then swapped.

Bloom is a separate pipeline: luminance threshold → series of downsample+blur passes → upsample → additive composite onto the density texture before display.
