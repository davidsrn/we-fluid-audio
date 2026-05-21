'use strict';

const canvas = document.getElementsByTagName('canvas')[0];

function getRandomFrom(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

let splatColors = [{ r: 0, g: 0.15, b: 0 }];

let idleSplats;

function idleSplatsFunction() {
    multipleSplats(config.RANDOM_AMOUNT);
}

let config = {
    SIM_RESOLUTION: 256,
    DYE_RESOLUTION: 512,
    DENSITY_DISSIPATION: 0.97,
    VELOCITY_DISSIPATION: 0.98,
    PRESSURE_DISSIPATION: 0.8,
    PRESSURE_ITERATIONS: 20,
    CURL: 30,
    SPLAT_RADIUS: 0.3,
    SHADING: true,
    COLORFUL: true,
    PAUSED: false,
    BACK_COLOR: { r: 0, g: 0, b: 0 },
    TRANSPARENT: false,
    BLOOM: true,
    BLOOM_ITERATIONS: 8,
    BLOOM_RESOLUTION: 256,
    BLOOM_INTENSITY: 0.05,
    BLOOM_THRESHOLD: 0.92,
    BLOOM_SOFT_KNEE: 0.7,
    POINTER_COLOR: [{ r: 0, g: 0.15, b: 0 }],
    SOUND_SENSITIVITY: 5,
    AUDIO_RESPONSIVE: true,
    FREQ_RANGE: 61,
    FREQ_RANGE_START: 0,
    IDLE_SPLATS: false,
    RANDOM_AMOUNT: 10,
    RANDOM_INTERVAL: 1,
    SPLAT_ON_CLICK: true,
    SHOW_MOUSE_MOVEMENT: true,
    FRAME_INTERVAL_MS: 1000 / 60,
    STEP_SIZE_S: 0.016,
    IGNORE_FPS_LIMIT: false,
    SMOOTH_ALPHA: 0.35,
    BEAT_DETECTION: true,
    BEAT_THRESHOLD: 0.12,
    BEAT_BURST_MULT: 2.0,
    STEREO_AWARENESS: true,
    FREQ_COLOR_MAPPING: true,
    DYNAMIC_COLORS: false,
    HUE_SHIFT_SPEED: 0.05,
    BAND_HUES: [0.04, 0.12, 0.27, 0.465, 0.635, 0.80],
    BAND_LAYERS: false,
    PER_BAND_TUNING: false,
    BAND_SIZE_MULT:      [1.0, 1.0, 1.0, 1.0, 1.0, 1.0],
    BAND_INTENSITY_MULT: [1.0, 1.0, 1.0, 1.0, 1.0, 1.0],
    BAND_VORTICITY:      [50,  40,  30,  20,  15,  10 ],
};

const AUDIO_BANDS = [
    { start:  0, end:  3, radius: 4.00, colorMult: 5.0, countMult:  5, hueMin: 0.00, hueMax: 0.08 }, // sub-bass  red→orange
    { start:  4, end:  9, radius: 2.50, colorMult: 4.5, countMult:  7, hueMin: 0.08, hueMax: 0.16 }, // bass      orange→yellow
    { start: 10, end: 18, radius: 1.50, colorMult: 4.0, countMult:  9, hueMin: 0.16, hueMax: 0.38 }, // low-mid   yellow→green
    { start: 19, end: 30, radius: 1.00, colorMult: 4.0, countMult:  9, hueMin: 0.38, hueMax: 0.55 }, // mid       green→cyan
    { start: 31, end: 44, radius: 0.40, colorMult: 3.5, countMult: 11, hueMin: 0.55, hueMax: 0.72 }, // high-mid  cyan→blue
    { start: 45, end: 60, radius: 0.15, colorMult: 3.0, countMult: 13, hueMin: 0.72, hueMax: 0.88 }, // treble    blue→purple
];

let smoothedEnergy     = new Array(AUDIO_BANDS.length).fill(0);
let prevSmoothedEnergy = new Array(AUDIO_BANDS.length).fill(0);
let beatCooldown       = new Array(AUDIO_BANDS.length).fill(0);
let activeCurl         = 30;

document.addEventListener("DOMContentLoaded", () => {
    window.wallpaperPropertyListener = {
        applyUserProperties: (properties) => {
            if (properties.bloom_intensity) config.BLOOM_INTENSITY = properties.bloom_intensity.value;
            if (properties.bloom_threshold) config.BLOOM_THRESHOLD = properties.bloom_threshold.value;
            if (properties.colorful) config.COLORFUL = properties.colorful.value;
            if (properties.density_diffusion) config.DENSITY_DISSIPATION = properties.density_diffusion.value;
            if (properties.enable_bloom) config.BLOOM = properties.enable_bloom.value;
            if (properties.paused) config.PAUSED = properties.paused.value;
            if (properties.pressure_diffusion) config.PRESSURE_DISSIPATION = properties.pressure_diffusion.value;
            if (properties.shading) config.SHADING = properties.shading.value;
            if (properties.splat_radius) config.SPLAT_RADIUS = properties.splat_radius.value;
            if (properties.velocity_diffusion) config.VELOCITY_DISSIPATION = properties.velocity_diffusion.value;
            if (properties.vorticity) { config.CURL = properties.vorticity.value; if (!config.PER_BAND_TUNING) activeCurl = config.CURL; }
            if (properties.sound_sensitivity) config.SOUND_SENSITIVITY = properties.sound_sensitivity.value;
            if (properties.audio_responsive) config.AUDIO_RESPONSIVE = properties.audio_responsive.value;
            if (properties.simulation_resolution) {
                config.SIM_RESOLUTION = parseInt(properties.simulation_resolution.value, 10);
                initFramebuffers();
            }
            if (properties.dye_resolution) {
                config.DYE_RESOLUTION = parseInt(properties.dye_resolution.value, 10);
                initFramebuffers();
            }
            if (properties.splat_color) {
                splatColors[0] = rgbToPointerColor(properties.splat_color.value);
                if (!config.COLORFUL) config.POINTER_COLOR = [splatColors[0]];
            }
            if (properties.splat_color_2) splatColors[1] = rgbToPointerColor(properties.splat_color_2.value);
            if (properties.splat_color_3) splatColors[2] = rgbToPointerColor(properties.splat_color_3.value);
            if (properties.splat_color_4) splatColors[3] = rgbToPointerColor(properties.splat_color_4.value);
            if (properties.splat_color_5) splatColors[4] = rgbToPointerColor(properties.splat_color_5.value);
            if (properties.background_color) {
                let c = properties.background_color.value.split(" "),
                r = Math.floor(c[0]*255),
                g = Math.floor(c[1]*255),
                b = Math.floor(c[2]*255);
                document.body.style.backgroundColor = `rgb(${r}, ${g}, ${b})`;
                config.BACK_COLOR.r = r;
                config.BACK_COLOR.g = g;
                config.BACK_COLOR.b = b;
            }
            if (properties.more_colors && !properties.more_colors.value) {
                config.POINTER_COLOR = [splatColors[0]];
            } else if (properties.more_colors && properties.more_colors.value) {
                config.POINTER_COLOR = splatColors.filter(c => c != null);
            }
            if (properties.use_background_image) config.TRANSPARENT = properties.use_background_image.value;
            if (properties.background_image) canvas.style.backgroundImage = `url("file:///${properties.background_image.value}")`;
            if (properties.repeat_background) canvas.style.backgroundRepeat = properties.repeat_background.value ? "repeat" : "no-repeat";
            if (properties.background_image_size) canvas.style.backgroundSize = properties.background_image_size.value;
            if (properties.frequency_range) {
                config.FREQ_RANGE = properties.frequency_range.value;

                if (config.FREQ_RANGE + config.FREQ_RANGE_START > 61) {
                    config.FREQ_RANGE_START = 62 - config.FREQ_RANGE;
                }
            }
            if (properties.frequency_range_start) {
                if (config.FREQ_RANGE + properties.frequency_range_start.value > 61) {
                    config.FREQ_RANGE_START = 62 - config.FREQ_RANGE;
                } else {
                    config.FREQ_RANGE_START = properties.frequency_range_start.value;
                }
            }
            if (properties.idle_random_splats) {
                config.IDLE_SPLATS = properties.idle_random_splats.value;
                if (properties.idle_random_splats.value) {
                    idleSplats = setInterval(idleSplatsFunction, config.RANDOM_INTERVAL * 1000);
                } else {
                    clearInterval(idleSplats);
                }
            }
            if (properties.random_splat_interval) {
                config.RANDOM_INTERVAL = properties.random_splat_interval.value;
                if (config.IDLE_SPLATS) {
                    clearInterval(idleSplats);
                    idleSplats = setInterval(idleSplatsFunction, config.RANDOM_INTERVAL * 1000);
                }
            }
            if (properties.random_splat_amount) {
                config.RANDOM_AMOUNT = properties.random_splat_amount.value;
                if (config.IDLE_SPLATS) {
                    clearInterval(idleSplats);
                    idleSplats = setInterval(idleSplatsFunction, config.RANDOM_INTERVAL * 1000);
                }
            }
            if (properties.splat_on_click) config.SPLAT_ON_CLICK = properties.splat_on_click.value;
            if (properties.show_mouse_movement) config.SHOW_MOUSE_MOVEMENT = properties.show_mouse_movement.value;
            if (properties.ignore_fps_limit) config.IGNORE_FPS_LIMIT = properties.ignore_fps_limit.value;
            if (properties.smooth_alpha)       config.SMOOTH_ALPHA       = properties.smooth_alpha.value;
            if (properties.beat_detection)     config.BEAT_DETECTION     = properties.beat_detection.value;
            if (properties.beat_threshold)     config.BEAT_THRESHOLD     = properties.beat_threshold.value;
            if (properties.beat_burst_mult)    config.BEAT_BURST_MULT    = properties.beat_burst_mult.value;
            if (properties.stereo_awareness)   config.STEREO_AWARENESS   = properties.stereo_awareness.value;
            if (properties.freq_color_mapping) config.FREQ_COLOR_MAPPING = properties.freq_color_mapping.value;
            if (properties.dynamic_colors)     config.DYNAMIC_COLORS     = properties.dynamic_colors.value;
            if (properties.hue_shift_speed)    config.HUE_SHIFT_SPEED    = properties.hue_shift_speed.value;
            if (properties.per_band_tuning)    config.PER_BAND_TUNING    = properties.per_band_tuning.value;
            const bandSuffixes = ['subbass','bass','lowmid','mid','highmid','treble'];
            bandSuffixes.forEach((s, i) => {
                if (properties['band_size_' + s])      config.BAND_SIZE_MULT[i]      = properties['band_size_' + s].value;
                if (properties['band_intensity_' + s]) config.BAND_INTENSITY_MULT[i] = properties['band_intensity_' + s].value;
                if (properties['band_vorticity_' + s]) config.BAND_VORTICITY[i]      = properties['band_vorticity_' + s].value;
            });
            if (properties.band_layers) {
                config.BAND_LAYERS = properties.band_layers.value;
                initFramebuffers();
            }
            const bandColorKeys = ['band_color_subbass','band_color_bass','band_color_lowmid','band_color_mid','band_color_highmid','band_color_treble'];
            bandColorKeys.forEach((key, i) => {
                if (properties[key]) {
                    const c = properties[key].value.split(' ');
                    config.BAND_HUES[i] = RGBToHue(parseFloat(c[0]), parseFloat(c[1]), parseFloat(c[2])) / 360;
                }
            });
        },
        applyGeneralProperties: (properties) => {
            if (properties.fps) config.FRAME_INTERVAL_MS = 1000 / properties.fps;
	    }
    };

    window.wallpaperRegisterAudioListener((audioArray) => {
        if (!config.AUDIO_RESPONSIVE) return;
        if (!audioArray || audioArray.length < 2) return;
        if (audioArray[0] > 5) return;

        const half        = Math.floor(audioArray.length / 2);
        const sensitivity = config.SOUND_SENSITIVITY;
        const baseRadius  = config.SPLAT_RADIUS / 100.0;
        const maxBin      = half - 1;
        const rangeStart  = Math.min(config.FREQ_RANGE_START, maxBin);
        const rangeEnd    = Math.min(rangeStart + config.FREQ_RANGE - 1, maxBin);

        let totalEnergy = 0;
        let weightedCurl = 0;
        const smoothDecay = 1 - config.SMOOTH_ALPHA;

        for (let b = 0; b < AUDIO_BANDS.length; b++) {
            const band     = AUDIO_BANDS[b];
            const clampedStart = Math.max(band.start, rangeStart);
            const clampedEnd   = Math.min(band.end, rangeEnd);
            if (clampedStart > clampedEnd) continue;
            const binCount = clampedEnd - clampedStart + 1;
            const layerIndex = Math.min(2, Math.floor(b / 2));
            const sizeM  = config.PER_BAND_TUNING ? config.BAND_SIZE_MULT[b]      : 1;
            const countM = config.PER_BAND_TUNING ? config.BAND_INTENSITY_MULT[b] : 1;

            let leftEnergy  = 0.0;
            let rightEnergy = 0.0;
            for (let i = clampedStart; i <= clampedEnd; i++) {
                leftEnergy  += audioArray[i];
                rightEnergy += audioArray[half + i];
            }
            leftEnergy  /= binCount;
            rightEnergy /= binCount;

            const rawEnergy = (leftEnergy + rightEnergy) * 0.5;

            smoothedEnergy[b] = config.SMOOTH_ALPHA * rawEnergy + smoothDecay * smoothedEnergy[b];

            totalEnergy  += smoothedEnergy[b];
            weightedCurl += smoothedEnergy[b] * (config.PER_BAND_TUNING ? config.BAND_VORTICITY[b] : config.CURL);

            // Beat / transient detection
            const energyDelta     = smoothedEnergy[b] - prevSmoothedEnergy[b];
            prevSmoothedEnergy[b] = smoothedEnergy[b];

            // Hue range derived from user-configurable band color (±0.06 spread around picked hue)
            const hueMin = Math.max(0, config.BAND_HUES[b] - 0.06);
            const hueMax = Math.min(1, config.BAND_HUES[b] + 0.06);

            const totalCount = Math.min(50, Math.floor((smoothedEnergy[b] * sensitivity) * band.countMult * countM));
            if (totalCount > 0) {
                if (config.STEREO_AWARENESS) {
                    const total      = leftEnergy + rightEnergy + 0.0001;
                    const leftCount  = Math.round(totalCount * leftEnergy  / total);
                    const rightCount = totalCount - leftCount;
                    if (leftCount  > 0) audioSplatsPositioned(leftCount,  baseRadius * band.radius * sizeM, band.colorMult, 0.25, 0.6, hueMin, hueMax, layerIndex);
                    if (rightCount > 0) audioSplatsPositioned(rightCount, baseRadius * band.radius * sizeM, band.colorMult, 0.75, 0.6, hueMin, hueMax, layerIndex);
                } else {
                    audioSplatsPositioned(totalCount, baseRadius * band.radius * sizeM, band.colorMult, 0.5, 1.0, hueMin, hueMax, layerIndex);
                }
            }

            // Beat burst on sharp transient
            if (beatCooldown[b] > 0) {
                beatCooldown[b]--;
            } else if (config.BEAT_DETECTION && energyDelta > config.BEAT_THRESHOLD) {
                const burstCount = Math.min(50, Math.floor(energyDelta * sensitivity * band.countMult * countM * config.BEAT_BURST_MULT));
                if (burstCount > 0) {
                    audioSplatsPositioned(burstCount, baseRadius * band.radius * sizeM * 1.5, band.colorMult * 1.2, 0.5, 1.0, hueMin, hueMax, layerIndex);
                    beatCooldown[b] = 8;
                }
            }
        }

        // Update active curl — energy-weighted per-band vorticity when tuning is on
        activeCurl = totalEnergy > 0.001 ? weightedCurl / totalEnergy : config.CURL;

    });
});

class Pointer {
    constructor() {
        this.id = -1;
        this.x = 0;
        this.y = 0;
        this.dx = 0;
        this.dy = 0;
        this.down = false;
        this.moved = false;
        this.color = config.COLORFUL ? generateColor() : getRandomFrom(config.POINTER_COLOR);
    }
}

let pointers = [];
let splatStack = [];
let bloomFramebuffers = [];
pointers.push(new Pointer());

const { gl, ext } = getWebGLContext(canvas);

if (!ext.supportLinearFiltering) {
    config.SHADING = false;
    config.BLOOM = false;
}

function getWebGLContext (canvas) {
    const params = { alpha: true, depth: false, stencil: false, antialias: false, preserveDrawingBuffer: false };

    let gl = canvas.getContext('webgl2', params);
    const isWebGL2 = !!gl;
    if (!isWebGL2)
        gl = canvas.getContext('webgl', params) || canvas.getContext('experimental-webgl', params);

    let halfFloat;
    let supportLinearFiltering;
    if (isWebGL2) {
        gl.getExtension('EXT_color_buffer_float');
        supportLinearFiltering = gl.getExtension('OES_texture_float_linear');
    } else {
        halfFloat = gl.getExtension('OES_texture_half_float');
        supportLinearFiltering = gl.getExtension('OES_texture_half_float_linear');
    }

    gl.clearColor(0.0, 0.0, 0.0, 1.0);

    const halfFloatTexType = isWebGL2 ? gl.HALF_FLOAT : halfFloat.HALF_FLOAT_OES;
    let formatRGBA;
    let formatRG;
    let formatR;

    if (isWebGL2)
    {
        formatRGBA = getSupportedFormat(gl, gl.RGBA16F, gl.RGBA, halfFloatTexType);
        formatRG = getSupportedFormat(gl, gl.RG16F, gl.RG, halfFloatTexType);
        formatR = getSupportedFormat(gl, gl.R16F, gl.RED, halfFloatTexType);
    }
    else
    {
        formatRGBA = getSupportedFormat(gl, gl.RGBA, gl.RGBA, halfFloatTexType);
        formatRG = getSupportedFormat(gl, gl.RGBA, gl.RGBA, halfFloatTexType);
        formatR = getSupportedFormat(gl, gl.RGBA, gl.RGBA, halfFloatTexType);
    }

    return {
        gl,
        ext: {
            formatRGBA,
            formatRG,
            formatR,
            halfFloatTexType,
            supportLinearFiltering
        }
    };
}

function getSupportedFormat (gl, internalFormat, format, type)
{
    if (!supportRenderTextureFormat(gl, internalFormat, format, type))
    {
        switch (internalFormat)
        {
            case gl.R16F:
                return getSupportedFormat(gl, gl.RG16F, gl.RG, type);
            case gl.RG16F:
                return getSupportedFormat(gl, gl.RGBA16F, gl.RGBA, type);
            default:
                return null;
        }
    }

    return {
        internalFormat,
        format
    }
}

function supportRenderTextureFormat (gl, internalFormat, format, type) {
    let texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, 4, 4, 0, format, type, null);

    let fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);

    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    gl.deleteFramebuffer(fbo);
    gl.deleteTexture(texture);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (status != gl.FRAMEBUFFER_COMPLETE)
        return false;
    return true;
}


class GLProgram {
    constructor (vertexShader, fragmentShader) {
        this.uniforms = {};
        this.program = gl.createProgram();

        gl.attachShader(this.program, vertexShader);
        gl.attachShader(this.program, fragmentShader);
        gl.linkProgram(this.program);

        if (!gl.getProgramParameter(this.program, gl.LINK_STATUS))
            throw gl.getProgramInfoLog(this.program);

        const uniformCount = gl.getProgramParameter(this.program, gl.ACTIVE_UNIFORMS);
        for (let i = 0; i < uniformCount; i++) {
            const uniformName = gl.getActiveUniform(this.program, i).name;
            this.uniforms[uniformName] = gl.getUniformLocation(this.program, uniformName);
        }
    }

    bind () {
        gl.useProgram(this.program);
    }
}

function compileShader (type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
        throw gl.getShaderInfoLog(shader);

    return shader;
};

const baseVertexShader = compileShader(gl.VERTEX_SHADER, `#version 300 es
    precision highp float;

    in vec2 aPosition;
    out vec2 vUv;
    out vec2 vL;
    out vec2 vR;
    out vec2 vT;
    out vec2 vB;
    uniform vec2 texelSize;

    void main () {
        vUv = aPosition * 0.5 + 0.5;
        vL = vUv - vec2(texelSize.x, 0.0);
        vR = vUv + vec2(texelSize.x, 0.0);
        vT = vUv + vec2(0.0, texelSize.y);
        vB = vUv - vec2(0.0, texelSize.y);
        gl_Position = vec4(aPosition, 0.0, 1.0);
    }
`);

const clearShader = compileShader(gl.FRAGMENT_SHADER, `#version 300 es
    precision mediump float;

    in highp vec2 vUv;
    uniform sampler2D uTexture;
    uniform float value;
    out vec4 fragColor;

    void main () {
        fragColor = value * texture(uTexture, vUv);
    }
`);

const colorShader = compileShader(gl.FRAGMENT_SHADER, `#version 300 es
    precision mediump float;

    uniform vec4 color;
    out vec4 fragColor;

    void main () {
        fragColor = color;
    }
`);

const backgroundShader = compileShader(gl.FRAGMENT_SHADER, `#version 300 es
    precision mediump float;
    out vec4 fragColor;

    void main () {
        fragColor = vec4(0.0, 0.0, 0.0, 0.0);
    }
`);

const displayShader = compileShader(gl.FRAGMENT_SHADER, `#version 300 es
    precision highp float;

    in vec2 vUv;
    uniform sampler2D uTexture;
    out vec4 fragColor;

    void main () {
        vec3 C = texture(uTexture, vUv).rgb;
        float a = max(C.r, max(C.g, C.b));
        fragColor = vec4(C, a);
    }
`);

const displayBloomShader = compileShader(gl.FRAGMENT_SHADER, `#version 300 es
    precision highp float;

    in vec2 vUv;
    uniform sampler2D uTexture;
    uniform sampler2D uBloom;
    out vec4 fragColor;

    void main () {
        vec3 C = texture(uTexture, vUv).rgb;
        vec3 bloom = texture(uBloom, vUv).rgb;
        C = pow(C, vec3(1.0 / 2.2));
        bloom = pow(bloom.rgb, vec3(1.0 / 2.2));
        C += bloom;
        float a = max(C.r, max(C.g, C.b));
        fragColor = vec4(C, a);
    }
`);

const displayShadingShader = compileShader(gl.FRAGMENT_SHADER, `#version 300 es
    precision highp float;

    in vec2 vUv;
    in vec2 vL;
    in vec2 vR;
    in vec2 vT;
    in vec2 vB;
    uniform sampler2D uTexture;
    uniform vec2 texelSize;
    out vec4 fragColor;

    void main () {
        vec3 L = texture(uTexture, vL).rgb;
        vec3 R = texture(uTexture, vR).rgb;
        vec3 T = texture(uTexture, vT).rgb;
        vec3 B = texture(uTexture, vB).rgb;
        vec3 C = texture(uTexture, vUv).rgb;

        float dx = length(R) - length(L);
        float dy = length(T) - length(B);

        vec3 n = normalize(vec3(dx, dy, length(texelSize)));
        vec3 l = vec3(0.0, 0.0, 1.0);

        float diffuse = clamp(dot(n, l) + 0.7, 0.7, 1.0);
        C.rgb *= diffuse;

        float a = max(C.r, max(C.g, C.b));
        fragColor = vec4(C, a);
    }
`);

const displayBloomShadingShader = compileShader(gl.FRAGMENT_SHADER, `#version 300 es
    precision highp float;

    in vec2 vUv;
    in vec2 vL;
    in vec2 vR;
    in vec2 vT;
    in vec2 vB;
    uniform sampler2D uTexture;
    uniform sampler2D uBloom;
    uniform vec2 texelSize;
    out vec4 fragColor;

    void main () {
        vec3 L = texture(uTexture, vL).rgb;
        vec3 R = texture(uTexture, vR).rgb;
        vec3 T = texture(uTexture, vT).rgb;
        vec3 B = texture(uTexture, vB).rgb;
        vec3 C = texture(uTexture, vUv).rgb;

        float dx = length(R) - length(L);
        float dy = length(T) - length(B);

        vec3 n = normalize(vec3(dx, dy, length(texelSize)));
        vec3 l = vec3(0.0, 0.0, 1.0);

        float diffuse = clamp(dot(n, l) + 0.7, 0.7, 1.0);
        C *= diffuse;

        vec3 bloom = texture(uBloom, vUv).rgb;
        C = pow(C, vec3(1.0 / 2.2));
        bloom = pow(bloom.rgb, vec3(1.0 / 2.2));
        C += bloom;

        float a = max(C.r, max(C.g, C.b));
        fragColor = vec4(C, a);
    }
`);

const bloomPrefilterShader = compileShader(gl.FRAGMENT_SHADER, `#version 300 es
    precision mediump float;

    in vec2 vUv;
    uniform sampler2D uTexture;
    uniform vec3 curve;
    uniform float threshold;
    out vec4 fragColor;

    void main () {
        vec3 c = texture(uTexture, vUv).rgb;
        float br = max(c.r, max(c.g, c.b));
        float rq = clamp(br - curve.x, 0.0, curve.y);
        rq = curve.z * rq * rq;
        c *= max(rq, br - threshold) / max(br, 0.0001);
        fragColor = vec4(c, 0.0);
    }
`);

const bloomBlurShader = compileShader(gl.FRAGMENT_SHADER, `#version 300 es
    precision mediump float;

    in vec2 vL;
    in vec2 vR;
    in vec2 vT;
    in vec2 vB;
    uniform sampler2D uTexture;
    out vec4 fragColor;

    void main () {
        vec4 sum = vec4(0.0);
        sum += texture(uTexture, vL);
        sum += texture(uTexture, vR);
        sum += texture(uTexture, vT);
        sum += texture(uTexture, vB);
        sum *= 0.25;
        fragColor = sum;
    }
`);

const bloomFinalShader = compileShader(gl.FRAGMENT_SHADER, `#version 300 es
    precision mediump float;

    in vec2 vL;
    in vec2 vR;
    in vec2 vT;
    in vec2 vB;
    uniform sampler2D uTexture;
    uniform float intensity;
    out vec4 fragColor;

    void main () {
        vec4 sum = vec4(0.0);
        sum += texture(uTexture, vL);
        sum += texture(uTexture, vR);
        sum += texture(uTexture, vT);
        sum += texture(uTexture, vB);
        sum *= 0.25;
        fragColor = sum * intensity;
    }
`);

const splatShader = compileShader(gl.FRAGMENT_SHADER, `#version 300 es
    precision highp float;

    in vec2 vUv;
    uniform sampler2D uTarget;
    uniform float aspectRatio;
    uniform vec3 color;
    uniform vec2 point;
    uniform float radius;
    out vec4 fragColor;

    void main () {
        vec2 p = vUv - point.xy;
        p.x *= aspectRatio;
        vec3 splat = exp(-dot(p, p) / radius) * color;
        vec3 base = texture(uTarget, vUv).xyz;
        fragColor = vec4(base + splat, 1.0);
    }
`);

const advectionManualFilteringShader = compileShader(gl.FRAGMENT_SHADER, `#version 300 es
    precision highp float;

    in vec2 vUv;
    uniform sampler2D uVelocity;
    uniform sampler2D uSource;
    uniform vec2 texelSize;
    uniform vec2 dyeTexelSize;
    uniform float dt;
    uniform float dissipation;
    out vec4 fragColor;

    vec4 bilerp (sampler2D sam, vec2 uv, vec2 tsize) {
        vec2 st = uv / tsize - 0.5;

        vec2 iuv = floor(st);
        vec2 fuv = fract(st);

        vec4 a = texture(sam, (iuv + vec2(0.5, 0.5)) * tsize);
        vec4 b = texture(sam, (iuv + vec2(1.5, 0.5)) * tsize);
        vec4 c = texture(sam, (iuv + vec2(0.5, 1.5)) * tsize);
        vec4 d = texture(sam, (iuv + vec2(1.5, 1.5)) * tsize);

        return mix(mix(a, b, fuv.x), mix(c, d, fuv.x), fuv.y);
    }

    void main () {
        vec2 coord = vUv - dt * bilerp(uVelocity, vUv, texelSize).xy * texelSize;
        fragColor = dissipation * bilerp(uSource, coord, dyeTexelSize);
        fragColor.a = 1.0;
    }
`);

const advectionShader = compileShader(gl.FRAGMENT_SHADER, `#version 300 es
    precision highp float;

    in vec2 vUv;
    uniform sampler2D uVelocity;
    uniform sampler2D uSource;
    uniform vec2 texelSize;
    uniform float dt;
    uniform float dissipation;
    out vec4 fragColor;

    void main () {
        vec2 coord = vUv - dt * texture(uVelocity, vUv).xy * texelSize;
        fragColor = dissipation * texture(uSource, coord);
        fragColor.a = 1.0;
    }
`);

const divergenceShader = compileShader(gl.FRAGMENT_SHADER, `#version 300 es
    precision mediump float;

    in highp vec2 vUv;
    in highp vec2 vL;
    in highp vec2 vR;
    in highp vec2 vT;
    in highp vec2 vB;
    uniform sampler2D uVelocity;
    out vec4 fragColor;

    void main () {
        float L = texture(uVelocity, vL).x;
        float R = texture(uVelocity, vR).x;
        float T = texture(uVelocity, vT).y;
        float B = texture(uVelocity, vB).y;

        vec2 C = texture(uVelocity, vUv).xy;
        if (vL.x < 0.0) { L = -C.x; }
        if (vR.x > 1.0) { R = -C.x; }
        if (vT.y > 1.0) { T = -C.y; }
        if (vB.y < 0.0) { B = -C.y; }

        float div = 0.5 * (R - L + T - B);
        fragColor = vec4(div, 0.0, 0.0, 1.0);
    }
`);

const curlShader = compileShader(gl.FRAGMENT_SHADER, `#version 300 es
    precision mediump float;

    in highp vec2 vUv;
    in highp vec2 vL;
    in highp vec2 vR;
    in highp vec2 vT;
    in highp vec2 vB;
    uniform sampler2D uVelocity;
    out vec4 fragColor;

    void main () {
        float L = texture(uVelocity, vL).y;
        float R = texture(uVelocity, vR).y;
        float T = texture(uVelocity, vT).x;
        float B = texture(uVelocity, vB).x;
        float vorticity = R - L - T + B;
        fragColor = vec4(0.5 * vorticity, 0.0, 0.0, 1.0);
    }
`);

const vorticityShader = compileShader(gl.FRAGMENT_SHADER, `#version 300 es
    precision highp float;

    in vec2 vUv;
    in vec2 vL;
    in vec2 vR;
    in vec2 vT;
    in vec2 vB;
    uniform sampler2D uVelocity;
    uniform sampler2D uCurl;
    uniform float curl;
    uniform float dt;
    out vec4 fragColor;

    void main () {
        float L = texture(uCurl, vL).x;
        float R = texture(uCurl, vR).x;
        float T = texture(uCurl, vT).x;
        float B = texture(uCurl, vB).x;
        float C = texture(uCurl, vUv).x;

        vec2 force = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));
        force /= length(force) + 0.0001;
        force *= curl * C;
        force.y *= -1.0;

        vec2 vel = texture(uVelocity, vUv).xy;
        fragColor = vec4(vel + force * dt, 0.0, 1.0);
    }
`);

const pressureShader = compileShader(gl.FRAGMENT_SHADER, `#version 300 es
    precision mediump float;

    in highp vec2 vUv;
    in highp vec2 vL;
    in highp vec2 vR;
    in highp vec2 vT;
    in highp vec2 vB;
    uniform sampler2D uPressure;
    uniform sampler2D uDivergence;
    out vec4 fragColor;

    vec2 boundary (vec2 uv) {
        return uv;
    }

    void main () {
        float L = texture(uPressure, boundary(vL)).x;
        float R = texture(uPressure, boundary(vR)).x;
        float T = texture(uPressure, boundary(vT)).x;
        float B = texture(uPressure, boundary(vB)).x;
        float C = texture(uPressure, vUv).x;
        float divergence = texture(uDivergence, vUv).x;
        float pressure = (L + R + B + T - divergence) * 0.25;
        fragColor = vec4(pressure, 0.0, 0.0, 1.0);
    }
`);

const gradientSubtractShader = compileShader(gl.FRAGMENT_SHADER, `#version 300 es
    precision mediump float;

    in highp vec2 vUv;
    in highp vec2 vL;
    in highp vec2 vR;
    in highp vec2 vT;
    in highp vec2 vB;
    uniform sampler2D uPressure;
    uniform sampler2D uVelocity;
    out vec4 fragColor;

    vec2 boundary (vec2 uv) {
        return uv;
    }

    void main () {
        float L = texture(uPressure, boundary(vL)).x;
        float R = texture(uPressure, boundary(vR)).x;
        float T = texture(uPressure, boundary(vT)).x;
        float B = texture(uPressure, boundary(vB)).x;
        vec2 velocity = texture(uVelocity, vUv).xy;
        velocity.xy -= vec2(R - L, T - B);
        fragColor = vec4(velocity, 0.0, 1.0);
    }
`);

const blit = (() => {
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, -1, 1, 1, 1, 1, -1]), gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2, 0, 2, 3]), gl.STATIC_DRAW);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(0);

    return (destination) => {
        gl.bindFramebuffer(gl.FRAMEBUFFER, destination);
        gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
    }
})();

let simWidth;
let simHeight;
let dyeWidth;
let dyeHeight;
let density;
let densityLayers = [];
let velocity;
let divergence;
let curl;
let pressure;
let bloom;


const clearProgram               = new GLProgram(baseVertexShader, clearShader);
const colorProgram               = new GLProgram(baseVertexShader, colorShader);
const backgroundProgram          = new GLProgram(baseVertexShader, backgroundShader);
const displayProgram             = new GLProgram(baseVertexShader, displayShader);
const displayBloomProgram        = new GLProgram(baseVertexShader, displayBloomShader);
const displayShadingProgram      = new GLProgram(baseVertexShader, displayShadingShader);
const displayBloomShadingProgram = new GLProgram(baseVertexShader, displayBloomShadingShader);
const bloomPrefilterProgram      = new GLProgram(baseVertexShader, bloomPrefilterShader);
const bloomBlurProgram           = new GLProgram(baseVertexShader, bloomBlurShader);
const bloomFinalProgram          = new GLProgram(baseVertexShader, bloomFinalShader);
const splatProgram               = new GLProgram(baseVertexShader, splatShader);
const advectionProgram           = new GLProgram(baseVertexShader, ext.supportLinearFiltering ? advectionShader : advectionManualFilteringShader);
const divergenceProgram          = new GLProgram(baseVertexShader, divergenceShader);
const curlProgram                = new GLProgram(baseVertexShader, curlShader);
const vorticityProgram           = new GLProgram(baseVertexShader, vorticityShader);
const pressureProgram            = new GLProgram(baseVertexShader, pressureShader);
const gradientSubtractProgram     = new GLProgram(baseVertexShader, gradientSubtractShader);

function initFramebuffers () {
    let simRes = getResolution(config.SIM_RESOLUTION);
    let dyeRes = getResolution(config.DYE_RESOLUTION);

    simWidth  = simRes.width;
    simHeight = simRes.height;
    dyeWidth  = dyeRes.width;
    dyeHeight = dyeRes.height;

    const texType = ext.halfFloatTexType;
    const rgba    = ext.formatRGBA;
    const rg      = ext.formatRG;
    const r       = ext.formatR;
    const filtering = ext.supportLinearFiltering ? gl.LINEAR : gl.NEAREST;

    if (density == null)
        density = createDoubleFBO(dyeWidth, dyeHeight, rgba.internalFormat, rgba.format, texType, filtering);
    else
        density = resizeDoubleFBO(density, dyeWidth, dyeHeight, rgba.internalFormat, rgba.format, texType, filtering);

    if (config.BAND_LAYERS) {
        if (densityLayers.length === 0) {
            for (let l = 0; l < 3; l++)
                densityLayers.push(createDoubleFBO(dyeWidth, dyeHeight, rgba.internalFormat, rgba.format, texType, filtering));
        } else {
            for (let l = 0; l < densityLayers.length; l++)
                densityLayers[l] = resizeDoubleFBO(densityLayers[l], dyeWidth, dyeHeight, rgba.internalFormat, rgba.format, texType, filtering);
        }
    } else {
        densityLayers.length = 0;
    }

    if (velocity == null)
        velocity = createDoubleFBO(simWidth, simHeight, rg.internalFormat, rg.format, texType, filtering);
    else
        velocity = resizeDoubleFBO(velocity, simWidth, simHeight, rg.internalFormat, rg.format, texType, filtering);

    divergence = createFBO      (simWidth, simHeight, r.internalFormat, r.format, texType, gl.NEAREST);
    curl       = createFBO      (simWidth, simHeight, r.internalFormat, r.format, texType, gl.NEAREST);
    pressure   = createDoubleFBO(simWidth, simHeight, r.internalFormat, r.format, texType, gl.NEAREST);

    initBloomFramebuffers();
}

function initBloomFramebuffers () {
    let res = getResolution(config.BLOOM_RESOLUTION);

    const texType = ext.halfFloatTexType;
    const rgba = ext.formatRGBA;
    const filtering = ext.supportLinearFiltering ? gl.LINEAR : gl.NEAREST;

    bloom = createFBO(res.width, res.height, rgba.internalFormat, rgba.format, texType, filtering);

    bloomFramebuffers.length = 0;
    for (let i = 0; i < config.BLOOM_ITERATIONS; i++)
    {
        let width = res.width >> (i + 1);
        let height = res.height >> (i + 1);

        if (width < 2 || height < 2) break;

        let fbo = createFBO(width, height, rgba.internalFormat, rgba.format, texType, filtering);
        bloomFramebuffers.push(fbo);
    }
}

function createFBO (w, h, internalFormat, format, type, param) {
    gl.activeTexture(gl.TEXTURE0);
    let texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, param);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, param);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, w, h, 0, format, type, null);

    let fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    gl.viewport(0, 0, w, h);
    gl.clear(gl.COLOR_BUFFER_BIT);

    return {
        texture,
        fbo,
        width: w,
        height: h,
        attach (id) {
            gl.activeTexture(gl.TEXTURE0 + id);
            gl.bindTexture(gl.TEXTURE_2D, texture);
            return id;
        }
    };
}

function createDoubleFBO (w, h, internalFormat, format, type, param) {
    let fbo1 = createFBO(w, h, internalFormat, format, type, param);
    let fbo2 = createFBO(w, h, internalFormat, format, type, param);

    return {
        get read () {
            return fbo1;
        },
        set read (value) {
            fbo1 = value;
        },
        get write () {
            return fbo2;
        },
        set write (value) {
            fbo2 = value;
        },
        swap () {
            let temp = fbo1;
            fbo1 = fbo2;
            fbo2 = temp;
        }
    }
}

function resizeFBO (target, w, h, internalFormat, format, type, param) {
    let newFBO = createFBO(w, h, internalFormat, format, type, param);
    clearProgram.bind();
    gl.uniform1i(clearProgram.uniforms.uTexture, target.attach(0));
    gl.uniform1f(clearProgram.uniforms.value, 1);
    blit(newFBO.fbo);
    return newFBO;
}

function resizeDoubleFBO (target, w, h, internalFormat, format, type, param) {
    target.read = resizeFBO(target.read, w, h, internalFormat, format, type, param);
    target.write = createFBO(w, h, internalFormat, format, type, param);
    return target;
}

function createTextureAsync (url) {
    let texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, 1, 1, 0, gl.RGB, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255]));

    let obj = {
        texture,
        width: 1,
        height: 1,
        attach (id) {
            gl.activeTexture(gl.TEXTURE0 + id);
            gl.bindTexture(gl.TEXTURE_2D, texture);
            return id;
        }
    };

    let image = new Image();
    image.onload = () => {
        obj.width = image.width;
        obj.height = image.height;
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, image);
    };
    image.src = url;

    return obj;
}

initFramebuffers();
multipleSplats(Math.floor(Math.random() * 20) + 3);

let lastColorChangeTime = Date.now();
let lastFrameTime = performance.now();

update();

function update() {
    if (config.IGNORE_FPS_LIMIT) {
        const now = performance.now();
        const dt = Math.min((now - lastFrameTime) / 1000, 0.05);
        lastFrameTime = now;
        resizeCanvas();
        input();
        if (!config.PAUSED)
            step(dt);
        render(null);
        requestAnimationFrame(update);
    } else {
        setTimeout(update, config.FRAME_INTERVAL_MS);

        resizeCanvas();
        input();

        if (!config.PAUSED) {
            var remainingTimeS = config.FRAME_INTERVAL_MS / 1000.0;
            while (remainingTimeS > config.STEP_SIZE_S) {
                step(config.STEP_SIZE_S);
                remainingTimeS -= config.STEP_SIZE_S;
            }
            step(remainingTimeS);
        }

        render(null);
    }
}

function input () {
    if (splatStack.length > 0)
        multipleSplats(splatStack.pop());

    for (let i = 0; i < pointers.length; i++) {
        const p = pointers[i];
        if (p.moved) {
            splat(p.x, p.y, p.dx, p.dy, p.color);
            p.moved = false;
        }
    }

    if (lastColorChangeTime + 100 < Date.now())
    {
        lastColorChangeTime = Date.now();
        for (let i = 0; i < pointers.length; i++) {
            const p = pointers[i];
            p.color = config.COLORFUL ? generateColor() : getRandomFrom(config.POINTER_COLOR);
        }
    }
}

function step (dt) {
    gl.disable(gl.BLEND);
    gl.viewport(0, 0, simWidth, simHeight);

    curlProgram.bind();
    gl.uniform2f(curlProgram.uniforms.texelSize, 1.0 / simWidth, 1.0 / simHeight);
    gl.uniform1i(curlProgram.uniforms.uVelocity, velocity.read.attach(0));
    blit(curl.fbo);

    vorticityProgram.bind();
    gl.uniform2f(vorticityProgram.uniforms.texelSize, 1.0 / simWidth, 1.0 / simHeight);
    gl.uniform1i(vorticityProgram.uniforms.uVelocity, velocity.read.attach(0));
    gl.uniform1i(vorticityProgram.uniforms.uCurl, curl.attach(1));
    gl.uniform1f(vorticityProgram.uniforms.curl, activeCurl);
    gl.uniform1f(vorticityProgram.uniforms.dt, dt);
    blit(velocity.write.fbo);
    velocity.swap();

    divergenceProgram.bind();
    gl.uniform2f(divergenceProgram.uniforms.texelSize, 1.0 / simWidth, 1.0 / simHeight);
    gl.uniform1i(divergenceProgram.uniforms.uVelocity, velocity.read.attach(0));
    blit(divergence.fbo);

    clearProgram.bind();
    gl.uniform1i(clearProgram.uniforms.uTexture, pressure.read.attach(0));
    gl.uniform1f(clearProgram.uniforms.value, config.PRESSURE_DISSIPATION);
    blit(pressure.write.fbo);
    pressure.swap();

    pressureProgram.bind();
    gl.uniform2f(pressureProgram.uniforms.texelSize, 1.0 / simWidth, 1.0 / simHeight);
    gl.uniform1i(pressureProgram.uniforms.uDivergence, divergence.attach(0));
    for (let i = 0; i < config.PRESSURE_ITERATIONS; i++) {
        gl.uniform1i(pressureProgram.uniforms.uPressure, pressure.read.attach(1));
        blit(pressure.write.fbo);
        pressure.swap();
    }

    gradientSubtractProgram.bind();
    gl.uniform2f(gradientSubtractProgram.uniforms.texelSize, 1.0 / simWidth, 1.0 / simHeight);
    gl.uniform1i(gradientSubtractProgram.uniforms.uPressure, pressure.read.attach(0));
    gl.uniform1i(gradientSubtractProgram.uniforms.uVelocity, velocity.read.attach(1));
    blit(velocity.write.fbo);
    velocity.swap();

    advectionProgram.bind();
    gl.uniform2f(advectionProgram.uniforms.texelSize, 1.0 / simWidth, 1.0 / simHeight);
    if (!ext.supportLinearFiltering)
        gl.uniform2f(advectionProgram.uniforms.dyeTexelSize, 1.0 / simWidth, 1.0 / simHeight);
    let velocityId = velocity.read.attach(0);
    gl.uniform1i(advectionProgram.uniforms.uVelocity, velocityId);
    gl.uniform1i(advectionProgram.uniforms.uSource, velocityId);
    gl.uniform1f(advectionProgram.uniforms.dt, dt);
    gl.uniform1f(advectionProgram.uniforms.dissipation, config.VELOCITY_DISSIPATION);
    blit(velocity.write.fbo);
    velocity.swap();

    gl.viewport(0, 0, dyeWidth, dyeHeight);

    if (!ext.supportLinearFiltering)
        gl.uniform2f(advectionProgram.uniforms.dyeTexelSize, 1.0 / dyeWidth, 1.0 / dyeHeight);
    gl.uniform1i(advectionProgram.uniforms.uVelocity, velocity.read.attach(0));
    gl.uniform1f(advectionProgram.uniforms.dissipation, config.DENSITY_DISSIPATION);

    if (config.BAND_LAYERS && densityLayers.length > 0) {
        for (let l = 0; l < densityLayers.length; l++) {
            gl.uniform1i(advectionProgram.uniforms.uSource, densityLayers[l].read.attach(1));
            blit(densityLayers[l].write.fbo);
            densityLayers[l].swap();
        }
    } else {
        gl.uniform1i(advectionProgram.uniforms.uSource, density.read.attach(1));
        blit(density.write.fbo);
        density.swap();
    }
}

function renderDensityFBO (densityFBO, width, height, target) {
    if (config.SHADING) {
        let program = config.BLOOM ? displayBloomShadingProgram : displayShadingProgram;
        program.bind();
        gl.uniform2f(program.uniforms.texelSize, 1.0 / width, 1.0 / height);
        gl.uniform1i(program.uniforms.uTexture, densityFBO.read.attach(0));
        if (config.BLOOM) {
            gl.uniform1i(program.uniforms.uBloom, bloom.attach(1));
        }
    } else {
        let program = config.BLOOM ? displayBloomProgram : displayProgram;
        program.bind();
        gl.uniform1i(program.uniforms.uTexture, densityFBO.read.attach(0));
        if (config.BLOOM) {
            gl.uniform1i(program.uniforms.uBloom, bloom.attach(1));
        }
    }
    blit(target);
}

function render (target) {
    // Bloom source: bass layer when layered (largest shapes), single density otherwise
    const bloomSource = (config.BAND_LAYERS && densityLayers.length > 0) ? densityLayers[0].read : density.read;
    if (config.BLOOM) applyBloom(bloomSource, bloom);

    if (target == null || !config.TRANSPARENT) {
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.enable(gl.BLEND);
    } else {
        gl.disable(gl.BLEND);
    }

    let width  = target == null ? gl.drawingBufferWidth : dyeWidth;
    let height = target == null ? gl.drawingBufferHeight : dyeHeight;
    gl.viewport(0, 0, width, height);

    if (!config.TRANSPARENT) {
        colorProgram.bind();
        let bc = config.BACK_COLOR;
        gl.uniform4f(colorProgram.uniforms.color, bc.r / 255, bc.g / 255, bc.b / 255, 1);
        blit(target);
    }

    if (target == null && config.TRANSPARENT) {
        backgroundProgram.bind();
        blit(null);
    }

    if (config.BAND_LAYERS && densityLayers.length > 0) {
        // Draw back→front: bass (0) underneath, treble (2) on top
        for (let l = 0; l < densityLayers.length; l++)
            renderDensityFBO(densityLayers[l], width, height, target);
    } else {
        renderDensityFBO(density, width, height, target);
    }
}

function applyBloom (source, destination) {
    if (bloomFramebuffers.length < 2)
        return;

    let last = destination;

    gl.disable(gl.BLEND);
    bloomPrefilterProgram.bind();
    let knee = config.BLOOM_THRESHOLD * config.BLOOM_SOFT_KNEE + 0.0001;
    let curve0 = config.BLOOM_THRESHOLD - knee;
    let curve1 = knee * 2;
    let curve2 = 0.25 / knee;
    gl.uniform3f(bloomPrefilterProgram.uniforms.curve, curve0, curve1, curve2);
    gl.uniform1f(bloomPrefilterProgram.uniforms.threshold, config.BLOOM_THRESHOLD);
    gl.uniform1i(bloomPrefilterProgram.uniforms.uTexture, source.attach(0));
    gl.viewport(0, 0, last.width, last.height);
    blit(last.fbo);

    bloomBlurProgram.bind();
    for (let i = 0; i < bloomFramebuffers.length; i++) {
        let dest = bloomFramebuffers[i];
        gl.uniform2f(bloomBlurProgram.uniforms.texelSize, 1.0 / last.width, 1.0 / last.height);
        gl.uniform1i(bloomBlurProgram.uniforms.uTexture, last.attach(0));
        gl.viewport(0, 0, dest.width, dest.height);
        blit(dest.fbo);
        last = dest;
    }

    gl.blendFunc(gl.ONE, gl.ONE);
    gl.enable(gl.BLEND);

    for (let i = bloomFramebuffers.length - 2; i >= 0; i--) {
        let baseTex = bloomFramebuffers[i];
        gl.uniform2f(bloomBlurProgram.uniforms.texelSize, 1.0 / last.width, 1.0 / last.height);
        gl.uniform1i(bloomBlurProgram.uniforms.uTexture, last.attach(0));
        gl.viewport(0, 0, baseTex.width, baseTex.height);
        blit(baseTex.fbo);
        last = baseTex;
    }

    gl.disable(gl.BLEND);
    bloomFinalProgram.bind();
    gl.uniform1i(bloomFinalProgram.uniforms.uTexture, last.attach(0));
    gl.uniform1f(bloomFinalProgram.uniforms.intensity, config.BLOOM_INTENSITY);
    gl.viewport(0, 0, destination.width, destination.height);
    blit(destination.fbo);
}

function splat (x, y, dx, dy, color) {
    gl.viewport(0, 0, simWidth, simHeight);
    splatProgram.bind();
    gl.uniform1i(splatProgram.uniforms.uTarget, velocity.read.attach(0));
    gl.uniform1f(splatProgram.uniforms.aspectRatio, canvas.width / canvas.height);
    gl.uniform2f(splatProgram.uniforms.point, x / canvas.width, 1.0 - y / canvas.height);
    gl.uniform3f(splatProgram.uniforms.color, dx, -dy, 1.0);
    gl.uniform1f(splatProgram.uniforms.radius, config.SPLAT_RADIUS / 100.0);
    blit(velocity.write.fbo);
    velocity.swap();

    gl.viewport(0, 0, dyeWidth, dyeHeight);
    gl.uniform1i(splatProgram.uniforms.uTarget, density.read.attach(0));
    gl.uniform3f(splatProgram.uniforms.color, color.r, color.g, color.b);
    blit(density.write.fbo);
    density.swap();
}

function multipleSplats (amount) {
    for (let i = 0; i < amount; i++) {
        const color = config.COLORFUL ? generateColor() : Object.assign({}, getRandomFrom(config.POINTER_COLOR));
        color.r *= 10.0;
        color.g *= 10.0;
        color.b *= 10.0;
        const x = canvas.width * Math.random();
        const y = canvas.height * Math.random();
        const dx = 1000 * (Math.random() - 0.5);
        const dy = 1000 * (Math.random() - 0.5);
        splat(x, y, dx, dy, color);
    }
}

function splatWithRadius (x, y, dx, dy, color, radius, layerIndex = 0) {
    gl.viewport(0, 0, simWidth, simHeight);
    splatProgram.bind();
    gl.uniform1i(splatProgram.uniforms.uTarget, velocity.read.attach(0));
    gl.uniform1f(splatProgram.uniforms.aspectRatio, canvas.width / canvas.height);
    gl.uniform2f(splatProgram.uniforms.point, x / canvas.width, 1.0 - y / canvas.height);
    gl.uniform3f(splatProgram.uniforms.color, dx, -dy, 1.0);
    gl.uniform1f(splatProgram.uniforms.radius, radius);
    blit(velocity.write.fbo);
    velocity.swap();

    const densityFBO = (config.BAND_LAYERS && densityLayers.length > 0) ? densityLayers[layerIndex] : density;
    gl.viewport(0, 0, dyeWidth, dyeHeight);
    gl.uniform1i(splatProgram.uniforms.uTarget, densityFBO.read.attach(0));
    gl.uniform3f(splatProgram.uniforms.color, color.r, color.g, color.b);
    blit(densityFBO.write.fbo);
    densityFBO.swap();
}

function generateBandColor (hueMin, hueMax, hueOffset) {
    if (!config.COLORFUL) {
        return Object.assign({}, getRandomFrom(config.POINTER_COLOR));
    }
    if (!config.FREQ_COLOR_MAPPING) {
        return generateColor();
    }
    const hue = (hueMin + Math.random() * (hueMax - hueMin) + hueOffset) % 1;
    let c = HSVtoRGB(hue, 1.0, 1.0);
    c.r *= 0.15;
    c.g *= 0.15;
    c.b *= 0.15;
    return c;
}

function audioSplatsPositioned (amount, radius, colorMult, xBias, xSpread, hueMin, hueMax, layerIndex = 0) {
    const hueOffset = config.DYNAMIC_COLORS ? (Date.now() * config.HUE_SHIFT_SPEED / 1000) % 1 : 0;
    for (let i = 0; i < amount; i++) {
        const color = generateBandColor(hueMin, hueMax, hueOffset);
        color.r *= colorMult;
        color.g *= colorMult;
        color.b *= colorMult;
        const x = canvas.width  * Math.max(0, Math.min(1, xBias + (Math.random() - 0.5) * xSpread));
        const y = canvas.height * Math.random();
        const dx = 1000 * (Math.random() - 0.5);
        const dy = 1000 * (Math.random() - 0.5);
        splatWithRadius(x, y, dx, dy, color, radius, layerIndex);
    }
}

function resizeCanvas () {
    const w = canvas.clientWidth  || canvas.width;
    const h = canvas.clientHeight || canvas.height;
    if (canvas.width != w || canvas.height != h) {
        canvas.width = w;
        canvas.height = h;
        initFramebuffers();
    }
}

canvas.addEventListener('mousemove', e => {
    if (!config.SHOW_MOUSE_MOVEMENT) return;
    pointers[0].moved = true;
    pointers[0].dx = (e.offsetX - pointers[0].x) * 5.0;
    pointers[0].dy = (e.offsetY - pointers[0].y) * 5.0;
    pointers[0].x = e.offsetX;
    pointers[0].y = e.offsetY;
});

canvas.addEventListener('touchmove', e => {
    e.preventDefault();
    const touches = e.targetTouches;
    for (let i = 0; i < touches.length; i++) {
        const pointer = pointers.find(p => p.id === touches[i].identifier);
        if (!pointer) continue;
        pointer.moved = pointer.down;
        pointer.dx = (touches[i].pageX - pointer.x) * 8.0;
        pointer.dy = (touches[i].pageY - pointer.y) * 8.0;
        pointer.x = touches[i].pageX;
        pointer.y = touches[i].pageY;
    }
}, false);

canvas.addEventListener('mouseenter', () => {
    pointers[0].down = true;
    pointers[0].color = getRandomFrom(config.POINTER_COLOR);
});

canvas.addEventListener('touchstart', e => {
    if (!config.SPLAT_ON_CLICK) return;
    e.preventDefault();
    const touches = e.targetTouches;
    for (let i = 0; i < touches.length; i++) {
        if (i >= pointers.length)
            pointers.push(new Pointer());

        pointers[i].id = touches[i].identifier;
        pointers[i].down = true;
        pointers[i].x = touches[i].pageX;
        pointers[i].y = touches[i].pageY;
        pointers[i].color = getRandomFrom(config.POINTER_COLOR);
    }
});

canvas.addEventListener("mousedown", () => {
    if (!config.SPLAT_ON_CLICK) return;
    multipleSplats(Math.floor(Math.random() * 20) + 5);
});

window.addEventListener('mouseleave', () => {
    pointers[0].down = false;
});

window.addEventListener('touchend', e => {
    const touches = e.changedTouches;
    for (let i = 0; i < touches.length; i++) {
        const j = pointers.findIndex(p => p.id === touches[i].identifier);
        if (j > 0) pointers.splice(j, 1);
        else if (j === 0) { pointers[0].down = false; pointers[0].id = -1; }
    }
});

window.addEventListener('keydown', e => {
    if (e.code === 'KeyP')
        config.PAUSED = !config.PAUSED;
    if (e.key === ' ')
        splatStack.push(Math.floor(Math.random() * 20) + 5);
});

function generateColor () {
    let c = HSVtoRGB(Math.random(), 1.0, 1.0);
    c.r *= 0.15;
    c.g *= 0.15;
    c.b *= 0.15;
    return c;
}

function HSVtoRGB (h, s, v) {
    let r, g, b, i, f, p, q, t;
    i = Math.floor(h * 6);
    f = h * 6 - i;
    p = v * (1 - s);
    q = v * (1 - f * s);
    t = v * (1 - (1 - f) * s);

    switch (i % 6) {
        case 0: r = v, g = t, b = p; break;
        case 1: r = q, g = v, b = p; break;
        case 2: r = p, g = v, b = t; break;
        case 3: r = p, g = q, b = v; break;
        case 4: r = t, g = p, b = v; break;
        case 5: r = v, g = p, b = q; break;
    }

    return {
        r,
        g,
        b
    };
}

function RGBToHue(r, g, b) {
  let cmin = Math.min(r, g, b),
      cmax = Math.max(r, g, b),
      delta = cmax - cmin,
      h = 0;

  if (delta == 0)
    h = 0;
  else if (cmax == r)
    h = ((g - b) / delta) % 6;
  else if (cmax == g)
    h = (b - r) / delta + 2;
  else
    h = (r - g) / delta + 4;

  h = Math.round(h * 60);
  if (h < 0) h += 360;

  return h;
}

function getResolution (resolution) {
    let aspectRatio = gl.drawingBufferWidth / gl.drawingBufferHeight;
    if (aspectRatio < 1)
        aspectRatio = 1.0 / aspectRatio;

    let max = Math.round(resolution * aspectRatio);
    let min = Math.round(resolution);

    if (gl.drawingBufferWidth > gl.drawingBufferHeight)
        return { width: max, height: min };
    else
        return { width: min, height: max };
}

function getTextureScale (texture, width, height) {
    return {
        x: width / texture.width,
        y: height / texture.height
    };
}

function rgbToPointerColor(color) {
    let c = color.split(" ");
    return {
        r: c[0] * 0.15,
        g: c[1] * 0.15,
        b: c[2] * 0.15
    }
}
