// React Native Skia player for an arc-journey scene.
//
//   npm i @shopify/react-native-skia
//
//   const res   = await fetch(url, { method: 'POST', body: … }).then(r => r.json());
//   const scene = res.arc_journey_data;      // res.image_geo_data holds place + weather
//   <ArcJourneyView scene={scene} width={Dimensions.get('window').width} />
//
// The maths lives in arcScene.ts and is parity-tested against the server, so
// this file is only drawing. Not yet run on a device — expect to adjust Skia
// imports for your version.

import React, { useEffect, useRef, useState } from 'react';
import {
  Canvas, Group, Image as SkiaImage, useImage, Path, Skia, Circle,
  DashPathEffect, rect, rrect,
} from '@shopify/react-native-skia';

import {
  type Scene, type ScenePoint, type Vec2,
  cameraAt, makeTransform, arcsAt, pinsAt, pinGeometry,
} from './arcScene';

interface Props {
  scene: Scene;
  width: number;          // device width; the canvas scales uniformly to fit
  loop?: boolean;
  playing?: boolean;
}

export function ArcJourneyView({ scene, width, loop = true, playing = true }: Props) {
  const t = useClockSeconds(scene.duration, loop, playing);

  // The scene is authored at scene.canvas.*; one uniform scale fits any screen.
  const fit = width / scene.canvas.width;
  const height = scene.canvas.height * fit;

  const base = useImage(scene.base.url);
  const cam = cameraAt(scene, t);
  const { sx, sy, toCanvas } = makeTransform(scene, cam);

  return (
    <Canvas style={{ width, height }}>
      <Group transform={[{ scale: fit }]}>
        {/* Base map: draw it whole, transformed so the camera rect fills the canvas. */}
        {base && (
          <Group transform={[
            { translateX: -cam.x * sx }, { translateY: -cam.y * sy },
            { scaleX: sx }, { scaleY: sy },
          ]}>
            <SkiaImage
              image={base} fit="fill"
              x={0} y={0} width={scene.base.width} height={scene.base.height}
            />
          </Group>
        )}

        {/* Arcs, in canvas space so the stroke stays a constant thickness. */}
        {arcsAt(scene, t).map(({ arc, progress, points }, i) => {
          const path = polyline(points.map(([x, y]) => toCanvas(x, y)));
          if (!path) return null;
          const S = scene.style.arc;

          return (
            <Group key={`arc${i}`}>
              {S.shadow && (
                <Group transform={[{ translateY: 1.5 }]}>
                  <Path path={path} style="stroke" color="#000000" opacity={0.28}
                        strokeWidth={S.width + 2} strokeCap="round">
                    <DashPathEffect intervals={S.dash} />
                  </Path>
                </Group>
              )}
              <Path path={path} style="stroke" color={S.color}
                    strokeWidth={S.width} strokeCap="round">
                <DashPathEffect intervals={S.dash} />
              </Path>
              {progress < 1 && <Head scene={scene} at={points[points.length - 1]} toCanvas={toCanvas} />}
            </Group>
          );
        })}

        {/* Photo pins, on top, in points[] order. */}
        {pinsAt(scene, t).map(({ point, scale }) => (
          <Pin key={point.index} scene={scene} point={point} scale={scale} toCanvas={toCanvas} />
        ))}
      </Group>
    </Canvas>
  );
}

// ─── Pieces ──────────────────────────────────────────────────────────────────

function Head({ scene, at, toCanvas }: {
  scene: Scene; at: Vec2; toCanvas: (x: number, y: number) => Vec2;
}) {
  const [cx, cy] = toCanvas(at[0], at[1]);
  const { color, head } = scene.style.arc;
  return (
    <Group>
      <Circle cx={cx} cy={cy} r={head.glow} color={color} opacity={0.22} />
      <Circle cx={cx} cy={cy} r={head.radius} color="#FFFFFF" />
      <Circle cx={cx} cy={cy} r={Math.max(1, head.radius - 1.8)} color={color} />
    </Group>
  );
}

function Pin({ scene, point, scale, toCanvas }: {
  scene: Scene; point: ScenePoint; scale: number;
  toCanvas: (x: number, y: number) => Vec2;
}) {
  const photo = useImage(point.image);
  const g = pinGeometry(scene.style, scale);
  const S = scene.style.marker;

  // The anchor is the pointer tip, so the box hangs up and to the left.
  const [ax, ay] = toCanvas(point.x, point.y);
  const left = ax - g.width / 2;
  const top = ay - g.total;

  const clip = rrect(rect(g.photo.x, g.photo.y, g.photo.width, g.photo.height),
                     g.photo.radius, g.photo.radius);

  return (
    <Group transform={[{ translateX: left }, { translateY: top }]}>
      {photo && (
        <Group clip={clip}>
          <SkiaImage image={photo} fit="cover"
                     x={g.photo.x} y={g.photo.y} width={g.photo.width} height={g.photo.height} />
        </Group>
      )}

      <Path path={triangle(g.pointerOuter)} color={S.color} />
      <Path path={triangle(g.pointerInner)} color={S.pointerInner} />

      <Path
        path={roundedRect(g.border / 2, g.border / 2,
                          g.width - g.border, g.bodyH - g.border, g.radius)}
        style="stroke" color={S.color} strokeWidth={g.border}
      />
    </Group>
  );
}

// ─── Skia path helpers ───────────────────────────────────────────────────────

function polyline(points: Vec2[]) {
  if (points.length < 2) return null;
  const p = Skia.Path.Make();
  p.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) p.lineTo(points[i][0], points[i][1]);
  return p;
}

function triangle(pts: Vec2[]) {
  const p = Skia.Path.Make();
  p.moveTo(pts[0][0], pts[0][1]);
  p.lineTo(pts[1][0], pts[1][1]);
  p.lineTo(pts[2][0], pts[2][1]);
  p.close();
  return p;
}

function roundedRect(x: number, y: number, w: number, h: number, r: number) {
  const p = Skia.Path.Make();
  p.addRRect(rrect(rect(x, y, w, h), r, r));
  return p;
}

// ─── Clock ───────────────────────────────────────────────────────────────────

// Wall-clock driven, so a dropped frame costs smoothness and not sync. Simple
// and portable; for production move this onto Skia's useClock + useDerivedValue
// so per-frame work leaves the JS thread (the helpers are already worklets).
function useClockSeconds(duration: number, loop: boolean, playing: boolean) {
  const [t, setT] = useState(0);
  const startedAt = useRef(0);

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    startedAt.current = Date.now() - t * 1000;

    const tick = () => {
      const elapsed = (Date.now() - startedAt.current) / 1000;
      if (elapsed >= duration && !loop) { setT(duration); return; }
      setT(loop ? elapsed % duration : elapsed);
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [duration, loop, playing]);

  return t;
}
