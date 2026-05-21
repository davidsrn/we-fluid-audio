# Technical Audit — we-fluid-audio

Audited: 2026-05-21  
Remediated: 2026-05-21  
Scope: `script.js`, `index.html`, `project.json`, `docs/DEVELOPMENT.md`

---

## Critical bugs

### 1. `FREQ_RANGE` and `FREQ_RANGE_START` settings do nothing — **FIXED**

**File:** [script.js:133-146](script.js#L133), [script.js:215-272](script.js#L215)

`config.FREQ_RANGE` and `config.FREQ_RANGE_START` are updated in `applyUserProperties` when the user adjusts the sliders in Wallpaper Engine, but the audio listener never reads these fields. The listener always iterates over the hardcoded `AUDIO_BANDS` array with fixed `start`/`end` bin indices. Moving either slider has zero effect on the simulation. Either the settings should be removed from `project.json`, or the audio listener should respect them.

**Fix:** The audio listener now computes `rangeStart`/`rangeEnd` from `config.FREQ_RANGE_START` and `config.FREQ_RANGE`, clamps each band's bin range to this window, and skips bands that fall entirely outside it.

---

### 2. No upper bound on audio splat count — **FIXED**

**File:** [script.js:249](script.js#L249), [script.js:266](script.js#L266)

```js
const totalCount = Math.floor((smoothedEnergy[b] * sensitivity) * band.countMult * countM);
```

At maximum sensitivity (10), treble band `countMult` (13), and `BAND_INTENSITY_MULT` (5×), a single audio frame at full energy generates `10 * 13 * 5 = 650` splats for the treble band alone. Across 6 bands that is up to ~2,800 splats per audio callback, each issuing two WebGL `drawElements` calls. There is no clamp. A loud audio spike or a misconfigured sensitivity can make the renderer grind to a halt.

Fix: cap `totalCount` and `burstCount` to a reasonable maximum (e.g., 50 per band per frame).

**Fix:** `Math.min(50, ...)` applied to both `totalCount` and `burstCount`.

---

### 3. `BAND_LAYERS` density FBOs become stale after resolution change — **FIXED**

**File:** [script.js:951-959](script.js#L951)

When `BAND_LAYERS` is toggled off and `initFramebuffers()` is subsequently called (e.g., on a resolution change), the `densityLayers` array is not resized because the block is guarded by `if (config.BAND_LAYERS)`. The stale FBOs at the old resolution are preserved. When `BAND_LAYERS` is re-enabled, the code checks `densityLayers.length === 0` before allocating new ones — but the array is non-empty (stale), so no new allocation happens. The result is rendering into FBOs sized for the old resolution.

Fix: either resize `densityLayers` unconditionally when they exist, or clear `densityLayers` and free the old FBOs when `BAND_LAYERS` is disabled.

**Fix:** Added `else { densityLayers.length = 0; }` branch so the array is cleared whenever `BAND_LAYERS` is off, forcing fresh allocation on re-enable.

---

### 4. Touch pointer array grows without bound — **FIXED**

**File:** [script.js:1497-1503](script.js#L1497)

`touchend` sets `pointers[j].down = false` but never removes the pointer from the array. Every new touch that requires a new pointer (line 1478) pushes to the array. Over time the array grows, and each frame's input loop iterates over all of them including dead ones.

Fix: splice dead pointers out on `touchend`, or keep a pool with a fixed maximum.

**Fix:** `touchend` now splices touch-created entries (index > 0) and resets entry 0 (the mouse pointer) in place.

---

### 5. `touchmove` can access an out-of-bounds pointer — **FIXED**

**File:** [script.js:1454-1465](script.js#L1454)

The `touchmove` handler iterates `touches.length` and accesses `pointers[i]` directly. If more simultaneous touches arrive than there are entries in `pointers`, `pointers[i]` is `undefined` and the subsequent `.moved`, `.dx`, `.dy` assignments throw a TypeError. `touchstart` correctly grows the array, but `touchmove` fires independently and does not guard against this.

**Fix:** `touchmove` now looks up each touch by `identifier` via `pointers.find(p => p.id === ...)` and skips missing entries.

---

## High priority

### 6. Dithering is dead code in shaders — **FIXED**

**File:** [script.js:519-537](script.js#L519), [script.js:572-610](script.js#L572)

`displayBloomShader` and `displayBloomShadingShader` both declare:
```glsl
uniform sampler2D uDithering;
uniform vec2 ditherScale;
```
Neither shader samples `uDithering` or uses `ditherScale` anywhere in its body. The texture is loaded from `LDR_RGB1_0.png` ([script.js:911](script.js#L911)), uploaded to GPU memory, and bound each frame, with no effect on output. The dithering feature appears to have been stubbed out and forgotten. Either implement it or remove the declarations, the texture load, and the uniform bindings.

**Fix:** Removed `uDithering`/`ditherScale` from both display shaders, deleted the `createTextureAsync('LDR_RGB1_0.png')` call, and stripped the `uDithering`/`ditherScale` bindings from `renderDensityFBO`.

---

### 7. `backgroundProgram` sets a uniform the shader doesn't declare — **FIXED**

**File:** [script.js:1279-1281](script.js#L1279)

```js
backgroundProgram.bind();
gl.uniform1f(backgroundProgram.uniforms.aspectRatio, canvas.width / canvas.height);
```

The `backgroundShader` ([script.js:499-503](script.js#L499)) declares no uniforms. `backgroundProgram.uniforms.aspectRatio` is `null`, and `gl.uniform1f(null, ...)` is silently ignored. The line is dead.

**Fix:** Removed the `gl.uniform1f(backgroundProgram.uniforms.aspectRatio, ...)` call.

---

### 8. `bloomFinalProgram` sets `texelSize` the shader doesn't declare — **FIXED**

**File:** [script.js:1335](script.js#L1335)

```js
gl.uniform2f(bloomFinalProgram.uniforms.texelSize, 1.0 / last.width, 1.0 / last.height);
```

The `bloomFinalShader` ([script.js:652-672](script.js#L652)) declares only `uTexture` and `intensity`. `bloomFinalProgram.uniforms.texelSize` is `null`; this call is a no-op.

**Fix:** Removed the `gl.uniform2f(bloomFinalProgram.uniforms.texelSize, ...)` call.

---

### 9. `supportRenderTextureFormat` leaks a texture and framebuffer — **FIXED**

**File:** [script.js:397-414](script.js#L397)

Each call creates a `gl.createTexture()` and `gl.createFramebuffer()` for probing format support, then returns without calling `gl.deleteTexture` or `gl.deleteFramebuffer`. These are called during initialization for each of R, RG, and RGBA formats, producing up to 6 leaked WebGL objects per page load. Not catastrophic for a single-session wallpaper, but the probe objects persist for the lifetime of the GL context.

**Fix:** Added `gl.deleteFramebuffer(fbo)`, `gl.deleteTexture(texture)`, and `gl.bindFramebuffer(gl.FRAMEBUFFER, null)` before returning.

---

### 10. Audio array bounds not validated — **FIXED**

**File:** [script.js:225-227](script.js#L225)

```js
for (let i = band.start; i <= band.end; i++) {
    leftEnergy  += audioArray[i];
    rightEnergy += audioArray[half + i];
}
```

`half` is `Math.floor(audioArray.length / 2)`. If `half + band.end` exceeds `audioArray.length - 1` (treble band ends at bin 60; `half + 60 = 124` in a 128-element array — fine), this silently reads `undefined` values coerced to `NaN`, which propagates through the energy math. No length check guards the outer listener either: `if (audioArray[0] > 5) return` validates a sentinel value but not the array length.

**Fix:** Added `if (!audioArray || audioArray.length < 2) return;` guard. `rangeEnd` is now clamped to `half - 1` so no out-of-bounds access is possible.

---

### 11. `gradienSubtractProgram` typo — **FIXED**

**File:** [script.js:929](script.js#L929), [script.js:1190-1193](script.js#L1190)

The variable is named `gradienSubtractProgram` (missing the `t` in "gradient") in both declaration and all use sites. Harmless at runtime but a maintenance trap — any new code referencing the correct spelling will get a ReferenceError.

**Fix:** Renamed to `gradientSubtractProgram` at declaration and all three use sites.

---

## Medium priority

### 12. `Array.prototype.getRandom` pollutes the global prototype — **FIXED**

**File:** [script.js:7-9](script.js#L7)

```js
Array.prototype.getRandom = function() {
    return this[Math.floor(Math.random() * this.length)];
};
```

Extending `Array.prototype` affects every array in the page. If any third-party code ever iterates array keys with `for...in`, this method will appear. The method is only called on `config.POINTER_COLOR` and `splatColors`. Replace with a standalone `getRandomFrom(arr)` helper.

**Fix:** Replaced with `function getRandomFrom(arr)` and updated all call sites.

---

### 13. `splatColors` elements 1–4 may be `undefined` — **FIXED**

**File:** [script.js:11](script.js#L11), [script.js:110-113](script.js#L110)

`splatColors` is initialized with one element. WE only sets indices 1–4 if the user has those color properties, which in turn only appear when `more_colors` is enabled. If `getRandom()` is called on `splatColors` before WE sends these values, it can return `undefined`, which propagates `NaN` into the color uniforms.

**Fix:** When assigning to `config.POINTER_COLOR` with `more_colors` enabled, the array is now filtered: `splatColors.filter(c => c != null)`.

---

### 14. `indexOfMax` is defined but never called — **FIXED**

**File:** [script.js:280-296](script.js#L280)

The function exists in the file but has no call sites. Dead code.

**Fix:** Removed.

---

### 15. `audioSplats` is defined but never called — **FIXED**

**File:** [script.js:1393-1405](script.js#L1393)

`audioSplats` is superseded by `audioSplatsPositioned`. The old function has no call sites.

**Fix:** Removed.

---

### 16. `rgbToPointerColor` contains commented-out code — **FIXED**

**File:** [script.js:1599-1604](script.js#L1599)

Five lines of commented-out alternative implementation. Should be removed.

**Fix:** Removed the five commented-out lines.

---

### 17. `simulation_resolution` combo delivers strings, used as numbers — **FIXED**

**File:** [project.json:308-329](project.json#L308), [script.js:99](script.js#L99)

The combo options in `project.json` have `"value": "256"` (a JSON string). `applyUserProperties` stores this string directly: `config.SIM_RESOLUTION = properties.simulation_resolution.value`. In `getResolution`, `resolution * aspectRatio` coerces the string to a number via JS implicit conversion. This works but is non-obvious. Use `parseInt(properties.simulation_resolution.value, 10)`.

**Fix:** Both `simulation_resolution` and `dye_resolution` now use `parseInt(..., 10)`.

---

### 18. `project.json` defaults disagree with JS `config` defaults — **FIXED**

| Setting | `project.json` default | `config` default |
|---|---|---|
| `dye_resolution` | `"512"` | `1024` |
| `sound_sensitivity` | `5` | `0.25` |

WE applies the `project.json` values at startup, so the effective runtime defaults are those from `project.json`. Someone reading `config` in `script.js` sees misleading values. Align the two.

**Fix:** `DYE_RESOLUTION` changed from `1024` to `512`; `SOUND_SENSITIVITY` changed from `0.25` to `5` to match `project.json`.

---

### 19. `background_image_size` "Cover" option value is wrongly capitalized — **FIXED**

**File:** [project.json:125-128](project.json#L125)

```json
{ "label": "Cover", "value": "Cover" }
```

The other option has value `"contain"` (lowercase). CSS `background-size` is case-insensitive, so this works in practice, but it breaks consistency and is wrong by spec.

**Fix:** Changed `"Cover"` to `"cover"` in `project.json`.

---

### 20. `Date.now()` called per splat inside the audio hot path — **FIXED**

**File:** [script.js:1414](script.js#L1414)

```js
const offset = config.DYNAMIC_COLORS ? (Date.now() * config.HUE_SHIFT_SPEED / 1000) % 1 : 0;
```

This is inside `generateBandColor`, which is called once per splat inside `audioSplatsPositioned`. When hundreds of splats fire per audio frame, `Date.now()` is called hundreds of times. The value changes by at most 1ms between calls in the same frame. Compute this once per audio callback and pass it down.

**Fix:** `Date.now()` is now computed once in `audioSplatsPositioned` as `hueOffset` and passed to `generateBandColor(hueMin, hueMax, hueOffset)`.

---

### 21. Bloom gamma correction is applied asymmetrically — **FIXED**

**File:** [script.js:532](script.js#L532), [script.js:603](script.js#L603)

```glsl
bloom = pow(bloom.rgb, vec3(1.0 / 2.2));
C += bloom;
```

The bloom is gamma-corrected (linearized to sRGB) before being added to `C`, but `C` itself is not. The two signals are on different gamma curves when composited. If gamma correction is intended, it should be applied to `C` before the addition, or removed entirely for consistency.

**Fix:** `C = pow(C, vec3(1.0 / 2.2))` now precedes `bloom = pow(bloom.rgb, ...)` in both bloom display shaders.

---

### 22. Shaders use GLSL ES 1.0 syntax despite WebGL2 being available — **FIXED**

**File:** [script.js:455-474](script.js#L455)

The vertex shader uses `attribute` and `varying`, which are GLSL ES 1.0 keywords. WebGL2 supports these without a `#version` directive (compatibility mode), but the code misses all the GLSL ES 3.00 improvements: `in`/`out` instead of `attribute`/`varying`, `texture()` instead of `texture2D()`, integer texture formats, explicit output variables. Upgrading the shaders to GLSL ES 3.00 (`#version 300 es`) would be cleaner and enables features like multi-render-target output that could simplify the band layers path.

**Fix:** All 15 shaders (1 vertex + 14 fragment) upgraded to `#version 300 es`. `attribute`/`varying` → `in`/`out`; `texture2D` → `texture`; `gl_FragColor` → explicit `out vec4 fragColor`. Redundant `precision … sampler2D` qualifiers removed.

---

### 23. `IGNORE_FPS_LIMIT` path ignores actual elapsed time — **FIXED**

**File:** [script.js:1103-1110](script.js#L1103)

```js
if (config.IGNORE_FPS_LIMIT) {
    ...
    step(0.016);
    requestAnimationFrame(update);
}
```

When uncapped, the simulation always steps by exactly 16ms regardless of the actual frame duration. On a 144 Hz display, each physical frame is ~7ms but the simulation advances 16ms — the fluid runs at 2× speed. The elapsed time since the last frame should be measured and passed to `step`.

**Fix:** `lastFrameTime` is tracked via `performance.now()`. The uncapped path now computes `dt = Math.min((now - lastFrameTime) / 1000, 0.05)` and passes it to `step(dt)`.

---

### 24. `pointerPrototype` class is named like an instance — **FIXED**

**File:** [script.js:298](script.js#L298)

A `class` named `pointerPrototype` is instantiated with `new pointerPrototype()`. The name follows the convention for a prototype object, not a class. Rename to `Pointer` or `PointerState`.

**Fix:** Renamed to `Pointer` at declaration and all instantiation sites.

---

## Low priority

### 25. `project.json` description contains upstream content — **FIXED**

**File:** [project.json:4](project.json#L4)

The `description` field includes Imgur screenshot URLs referencing an FPS issue from the upstream project. The `workshopid` (`1748506393`) and `workshopurl` also point to the upstream Steam Workshop entry, not this fork.

**Fix:** `description` replaced with a brief description of this project. `workshopid` and `workshopurl` cleared.

---

### 26. `isMobile()` is a no-op in the Wallpaper Engine context — **FIXED**

**File:** [script.js:416-418](script.js#L416)

Wallpaper Engine runs on desktop. The UA sniff will never return `true` in the WE browser. The function and the two branches it guards ([script.js:318-323](script.js#L318)) are dead at runtime. They can be removed, or the mobile detection can be replaced with a capability-based check (which already happens via `ext.supportLinearFiltering`).

**Fix:** `isMobile()` removed; the `if (isMobile()) config.SHADING = false;` branch removed.

---

### 27. `RGBToHue` has unused variables and excessive inline comments — **FIXED**

**File:** [script.js:1544-1574](script.js#L1544)

Variables `s` and `l` are declared and assigned `0` (lines 1551-1552) but never read — they are saturation and lightness from a full HSL conversion, but only hue is returned. Strict mode (`'use strict'` is already set) would still allow this; a linter would flag it. Remove `s` and `l`.

The inline comments narrate the algorithm verbatim ("No difference", "Red is max", etc.) — they restate what the code already says.

**Fix:** `s` and `l` declarations removed; redundant inline comments removed.

---

### 28. `(1 - config.SMOOTH_ALPHA)` recomputed per band per frame — **FIXED**

**File:** [script.js:235](script.js#L235)

```js
smoothedEnergy[b] = config.SMOOTH_ALPHA * rawEnergy + (1 - config.SMOOTH_ALPHA) * smoothedEnergy[b];
```

`1 - config.SMOOTH_ALPHA` is constant for a given frame and could be precomputed once before the loop: `const decay = 1 - config.SMOOTH_ALPHA`. Minor, but it is inside the tightest loop in the audio path.

**Fix:** `const smoothDecay = 1 - config.SMOOTH_ALPHA` hoisted before the band loop; used in the EMA expression.

---

### 29. Canvas size is set before DOMContentLoaded — **FIXED**

**File:** [script.js:3-5](script.js#L3)

```js
const canvas = document.getElementsByTagName('canvas')[0];
canvas.width = canvas.clientWidth;
canvas.height = canvas.clientHeight;
```

This runs synchronously at script load. Because the script is placed at the end of `<body>`, the canvas element exists at this point, but `clientWidth`/`clientHeight` may be 0 if CSS layout hasn't been computed yet (especially on some embedded browsers). A safer approach is to read these inside DOMContentLoaded or inside `resizeCanvas()`.

**Fix:** Removed the two eager `canvas.width/height` assignments. `resizeCanvas()` now uses `canvas.clientWidth || canvas.width` as the target dimensions so the first `update()` call handles initialization safely.

---

### 30. `multipleSplats` uses `parseInt` for random integer generation — **FIXED**

**File:** [script.js:1097](script.js#L1097), [script.js:1490](script.js#L1490), [script.js:1509](script.js#L1509)

`parseInt(Math.random() * 20) + 3` uses `parseInt` to truncate a float. The idiomatic way is `Math.floor(Math.random() * 20) + 3`. `parseInt` works here because the argument is always positive, but it signals intent poorly.

**Fix:** All three occurrences replaced with `Math.floor(Math.random() * 20)`.

---

## Summary table

| # | Area | Severity | Status | Description |
|---|---|---|---|---|
| 1 | Audio | Critical | **Fixed** | `FREQ_RANGE`/`FREQ_RANGE_START` settings have no effect |
| 2 | Performance | Critical | **Fixed** | No upper bound on audio splat count |
| 3 | WebGL | Critical | **Fixed** | `BAND_LAYERS` FBOs become stale after resolution change |
| 4 | Events | Critical | **Fixed** | Touch pointer array leaks memory |
| 5 | Events | Critical | **Fixed** | `touchmove` can crash with out-of-bounds pointer access |
| 6 | Shaders | High | **Fixed** | Dithering is entirely dead code (declared, bound, never sampled) |
| 7 | WebGL | High | **Fixed** | `backgroundProgram` sets `aspectRatio` uniform shader doesn't have |
| 8 | WebGL | High | **Fixed** | `bloomFinalProgram` sets `texelSize` uniform shader doesn't have |
| 9 | WebGL | High | **Fixed** | `supportRenderTextureFormat` leaks texture + framebuffer every call |
| 10 | Audio | High | **Fixed** | Audio array access has no bounds validation |
| 11 | Code quality | High | **Fixed** | `gradienSubtractProgram` typo in name |
| 12 | Code quality | Medium | **Fixed** | `Array.prototype.getRandom` global prototype pollution |
| 13 | Correctness | Medium | **Fixed** | `splatColors[1–4]` can be `undefined` if WE hasn't set them |
| 14 | Code quality | Medium | **Fixed** | `indexOfMax` is dead code |
| 15 | Code quality | Medium | **Fixed** | `audioSplats` is dead code |
| 16 | Code quality | Medium | **Fixed** | `rgbToPointerColor` has commented-out code |
| 17 | project.json | Medium | **Fixed** | Combo resolution values are strings coerced to numbers |
| 18 | project.json | Medium | **Fixed** | `dye_resolution` and `sound_sensitivity` defaults disagree with JS |
| 19 | project.json | Medium | **Fixed** | `background_image_size` "Cover" value wrongly capitalized |
| 20 | Performance | Medium | **Fixed** | `Date.now()` called per splat inside audio hot path |
| 21 | Rendering | Medium | **Fixed** | Bloom gamma correction applied asymmetrically |
| 22 | Shaders | Medium | **Fixed** | Shaders use GLSL ES 1.0 syntax; WebGL2 GLSL ES 3.00 available |
| 23 | Simulation | Medium | **Fixed** | `IGNORE_FPS_LIMIT` path ignores actual elapsed time |
| 24 | Code quality | Low | **Fixed** | `pointerPrototype` class named like a prototype object |
| 25 | project.json | Low | **Fixed** | Description/workshop ID still points to upstream project |
| 26 | Code quality | Low | **Fixed** | `isMobile()` always returns `false` in WE context |
| 27 | Code quality | Low | **Fixed** | `RGBToHue` has unused `s`/`l` variables and redundant comments |
| 28 | Performance | Low | **Fixed** | `1 - config.SMOOTH_ALPHA` recomputed per band per frame |
| 29 | Correctness | Low | **Fixed** | Canvas size read before layout may be computed |
| 30 | Code quality | Low | **Fixed** | `parseInt` used for float truncation instead of `Math.floor` |
