# Arc Journey — on-device rendering contract

Two endpoints produce the same animation. They share one geometry/timeline core
(`api/arc.js`), so a phone that follows this document draws frame-for-frame what
the server-rendered video shows.

| Endpoint | Returns | Use when |
|---|---|---|
| `POST /user/:user_id/post/:post_id/arc-journey` | MP4 + poster on S3 | sharing, upload to feed, anything that needs a file |
| `POST /user/:user_id/post/:post_id/arc-journey/scene` | JSON scene + base map image | the phone animates it live (scrubbable, interactive, no encode wait) |

The scene endpoint is the fast one: one map render, ~2 s. The MP4 endpoint
renders every frame and encodes, ~6–20 s depending on size.

---

## 1. Request

Identical for both endpoints.

```jsonc
{
  "map_style": "terrain",             // REQUIRED: basic | terrain | satellite-terrain | 3d-terrain
  "points": [                          // REQUIRED: 2–25, drawn in array order
    { "lat": 28.6139, "lon": 77.2090,
      "image": "https://cdn/delhi.jpg", // url, s3://…, or base64/data URI
      "label": "Delhi",                 // optional, echoed back
      "id": "photo_8842",               // optional, echoed back as points[].id
      "media_id": 8842,                 // optional: meanwhyle MediaAssest.id — place/weather is saved against it
      "taken_at": "2026-09-23T20:37:00Z" } // optional: ISO or unix time; weather is for that hour
  ],

  "width": 1080, "height": 1350, "fps": 30,
  "base_scale": 1.5,                   // base map is rendered this much larger than the canvas
  "padding": 90, "max_zoom": 16,
  "curvature": 0.25,                   // 0 = straight, 0.8 = very arched
  "samples": 128,                      // points sampled per arc
  "marker_size": 96,                   // pin width in canvas px
  "timing": { "arc": 1.2, "pop": 0.35, "hold": 0.5, "tail": 1.0 },   // seconds
  "arc": { "color": "#E2574C", "width": 4, "dash": [12, 9], "shadow": true,
           "head": { "radius": 6, "glow": 14 } },
  "exaggeration": 1, "is_eox": false,  // terrain styles only
  "inline": false                      // true → MP4 streamed back / base map as data URI
}
```

Heights are rounded down to even numbers (H.264 `yuv420p` requires it), so
`1350` stays `1350` but `675` becomes `674`.

---

## 2. Response

```jsonc
{
  "user_id": "123", "post_id": "456", "map_style": "terrain",
  "version": 1,
  "duration": 5.45,                     // seconds, total
  "canvas": { "width": 720, "height": 900, "fps": 30 },
  "timing":  { "arc": 1.2, "pop": 0.35, "hold": 0.5, "tail": 1 },

  "base": {                             // the map image everything is positioned against
    "url": "https://meanwhyl.s3.amazonaws.com/uploads/123/<uuid>.jpg",
    "width": 1080, "height": 1350,      // NOT the canvas size — 1.5x by default
    "center": { "lon": 76.9147, "lat": 27.7665 },
    "zoom": 7.5368, "scale": 1.5
  },

  "points": [{
    "index": 0, "id": "photo_8842",
    "lat": 28.6139, "lon": 77.2090,
    "x": 617.73, "y": 421.07,           // BASE-image pixels, the pin's anchor
    "image": "https://cdn/delhi.jpg",
    "label": "Delhi",
    "appearAt": 0,                      // seconds
    "popDuration": 0.35,
    "popEasing": "easeOutBack"
  }],

  "arcs": [{
    "from": 0, "to": 1,                 // indexes into points[]
    "startAt": 0.35, "duration": 1.2,   // seconds
    "points": [[617.73, 421.07], …],    // 128 samples, BASE-image pixels
    "cumulative": [0, 6.2, 12.4, …],    // running length at each sample
    "length": 498.2,                    // total, base px
    "control": { "x": 610.2, "y": 512.8 },   // quadratic control point, if you'd rather curve than sample
    "svgPath": "M617.73,421.07L618.4,…",     // same polyline as an SVG path string
    "km": 179.7                         // real-world distance, for captions
  }],

  "camera": {
    "easing": "easeInOutCubic",
    "keyframes": [ { "t": 0, "x": 229.73, "y": 0, "w": 720, "h": 900 }, … ]
  },

  "style": {
    "arc":    { "color": "#E2574C", "width": 4, "dash": [12, 9], "shadow": true,
                "head": { "radius": 6, "glow": 14 } },
    "marker": { "size": 96, "height": 143, "aspect": 0.75, "border": 3, "radius": 6,
                "pointer": 15, "anchor": "bottom-center",
                "color": "#FF0000", "pointerInner": "#FFFFFF" }
  },

  "image_geo_data": [                   // reverse geocoded, one per point, same order
    { "id": "photo_8842", "name": "Connaught Place", "display_name": "…",
      "city": "New Delhi", "state": "Delhi", "country": "India", "postcode": "110001",
      "weather": { "basis": "taken_at",           // "current" when the point had no taken_at
                   "time": "2026-09-23T20:00:00.000Z",   // UTC hour of the reading
                   "temperature": 30.6, "apparent_temperature": 33.1,
                   "relative_humidity": 50, "precipitation": 0,
                   "weather_code": 0, "description": "Clear sky", "wind_speed": 4.2 } }
  ]
}
```

**Saved to meanwhyle.** When `MEANWHYLE_API_BASE_URL` and `MEANWHYLE_SERVICE_TOKEN`
are set, every point with a `media_id` (or a numeric `id` / `image_id`) is posted
to meanwhyle's `POST /api/media/internal/geo` and stored in `media_asset_geo`.
Points without one are not sent; the array index is never used as an id. A failed
save is logged and does not fail the render. The terrain-marker routes do the same
for `markers[]`.

A whole scene is around 7 KB of JSON for two points. `image_geo_data` entries are
always present and line up with `points[]` by position; a coordinate that cannot
be geocoded still gets an entry, with `null` fields.

---

## 3. The coordinate contract

This is the only rule that matters — everything else follows from it.

- **`points[].x/y`, `arcs[].points[]`, `arcs[].control`, `camera.keyframes[]` are in
  BASE-IMAGE pixels** — the coordinate space of `base.url`, sized `base.width × base.height`.
- **`style.*` sizes are in CANVAS pixels** — stroke widths, dash lengths, head radius,
  pin width and height. They are constant on screen and **must not scale with the camera**.
  That is what keeps a dashed line looking the same thickness while the map zooms.
- A camera keyframe `{x, y, w, h}` is the rectangle **of the base image** that fills
  the canvas at that moment.

Transform, base → canvas, at any time:

```js
const sx = canvas.width / cam.w;
const sy = canvas.height / cam.h;
const toCanvas = (bx, by) => [ (bx - cam.x) * sx, (by - cam.y) * sy ];
```

If your canvas is a different size than `canvas.width × canvas.height` (a 390 pt
phone versus a 720 px design space), apply **one uniform scale** to the whole drawing
afterwards — `deviceWidth / canvas.width`. Do not rescale the style values separately.

---

## 4. Render loop

For a given time `t` in `[0, duration]`:

```
1. cam = cameraAt(t)
2. draw base image: source rect {cam.x, cam.y, cam.w, cam.h} → full canvas
3. for each arc where t >= arc.startAt:
       progress = clamp((t - arc.startAt) / arc.duration, 0, 1)
       pts = progress >= 1 ? arc.points : sliceArc(arc, progress)
       map pts through toCanvas
       if style.arc.shadow: stroke the polyline in #000 at 0.28 alpha,
           width + 2, same dash, offset 1.5px down
       stroke the polyline: style.arc.color, style.arc.width,
           dash style.arc.dash, round caps
       if progress < 1: draw the head at the last point —
           circle r=head.glow in arc.color at 0.22 alpha,
           circle r=head.radius in white,
           circle r=head.radius-1.8 in arc.color
4. for each point where t >= point.appearAt:
       age = t - point.appearAt
       scale = age >= point.popDuration ? 1 : easeOutBack(age / point.popDuration)
       skip if scale < 0.05
       draw the pin at toCanvas(point.x, point.y), anchored bottom-center,
           sized style.marker.size * scale × style.marker.height * scale
```

Arcs are drawn under pins. Pins are drawn in `points[]` order.

### `cameraAt(t)`

```js
function cameraAt(camera, t) {
  const k = camera.keyframes;
  if (t <= k[0].t) return k[0];
  if (t >= k[k.length - 1].t) return k[k.length - 1];
  let i = 0;
  while (i < k.length - 2 && k[i + 1].t <= t) i++;
  const a = k[i], b = k[i + 1];
  const f = easeInOutCubic((t - a.t) / (b.t - a.t || 1));
  return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f,
           w: a.w + (b.w - a.w) * f, h: a.h + (b.h - a.h) * f };
}
```

### `sliceArc(arc, progress)`

`cumulative[i]` is the path length up to sample `i`, which makes a partial draw a
lookup plus one interpolated point — no arc-length math on device:

```js
function sliceArc(arc, progress) {
  const target = arc.length * progress;
  const out = [arc.points[0]];
  for (let i = 1; i < arc.points.length; i++) {
    if (arc.cumulative[i] < target) { out.push(arc.points[i]); continue; }
    const seg = arc.cumulative[i] - arc.cumulative[i - 1] || 1;
    const f = (target - arc.cumulative[i - 1]) / seg;
    const [px, py] = arc.points[i - 1], [qx, qy] = arc.points[i];
    out.push([px + (qx - px) * f, py + (qy - py) * f]);
    break;
  }
  return out;
}
```

### Easing

```js
const easeInOutCubic = (t) => t < 0.5 ? 4*t*t*t : 1 - Math.pow(-2*t + 2, 3) / 2;
const easeOutBack    = (t) => 1 + 2.70158 * Math.pow(t-1, 3) + 1.70158 * Math.pow(t-1, 2);
```

`easeOutBack` overshoots past 1.0 (peaks near 1.1) and settles — that overshoot is
the pop. Don't clamp it.

---

## 5. Drawing a pin

The pin must match `buildMarker()` in `api/map.js`. With `S = style.marker`:

```
bodyH   = round(S.size * 4/3)          // = S.height - S.pointer
total   = S.height                      // body + pointer
cx      = S.size / 2

photo    : cover-fit into (S.size - 2*S.border) × (bodyH - 2*S.border),
           inset by S.border, corner radius S.radius - S.border
frame    : rounded rect, stroke S.color, width S.border,
           inset S.border/2, corner radius S.radius
pointer  : filled triangle S.color  (cx-12, bodyH) (cx+12, bodyH) (cx, total)
           filled triangle S.pointerInner (cx-9, bodyH) (cx+9, bodyH) (cx, bodyH+12)
anchor   : the pointer tip — (cx, total) sits exactly on the projected point
```

So when you place a pin at `toCanvas(point.x, point.y)`, the **bottom centre** of the
pin box goes on that coordinate, not the middle.

---

## 6. Practical notes

- **Prefetch before playing.** Load `base.url` and every `points[].image` up front;
  a decode mid-animation drops frames. Total download is the base JPEG (a few hundred
  KB at `base_scale` 1.5) plus the photos.
- **The S3 bucket is private.** An anonymous GET of `base.url` returns `AccessDenied`.
  Serve these through CloudFront or hand the app pre-signed URLs.
- **Drive it with a clock, not a frame counter.** `canvas.fps` describes the MP4; on
  device use the real elapsed time so playback survives a dropped frame. Scrubbing is
  free — every function here takes `t`.
- **`base_scale` trades sharpness for bytes.** The camera zooms into the base image, so
  1.0 looks soft at the tight keyframes. 1.5 is the default; 2.0 for retina at roughly
  double the download.
- **Sub-pixel difference versus the MP4.** The server rounds the camera rect to whole
  pixels because its crop is a raster operation. On device use the floats — the
  difference is under one pixel and the float version is smoother.
- **`arcs[].svgPath`** is the same polyline as a path string, for `react-native-svg`
  or Skia's `Path.MakeFromSVGString`. Use it for a full arc; use `points` + `cumulative`
  for partial draws, since slicing a path string is harder than slicing an array.
