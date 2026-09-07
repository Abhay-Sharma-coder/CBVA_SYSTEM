"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, PerformanceMonitor } from "@react-three/drei";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { NoToneMapping } from "three";
import type { DirectionalLight, Texture } from "three";

import { Floor } from "@/components/floor-plan/three/floor";
import { BayPlates } from "@/components/floor-plan/three/bay-plates";
import { PerfProbe } from "@/components/floor-plan/three/perf-probe";
import { Seats } from "@/components/floor-plan/three/seats";
import { RoomLabels } from "@/components/floor-plan/three/room-labels";
import { StaticFurniture } from "@/components/floor-plan/three/static-furniture";
import { Walls } from "@/components/floor-plan/three/walls";
import { buildGlyphAtlas } from "@/components/floor-plan/three/glyph-atlas";
import { readSeatPalette, type SeatPalette } from "@/components/floor-plan/three/seat-materials";
import {
  AZIMUTH_DEFAULT,
  FOV,
  POLAR,
  frameRect,
  frameSeat,
  useCameraFlight,
} from "@/components/floor-plan/three/camera";
import { FLOOR_SIZE } from "@/components/floor-plan/three/coords";
import { SceneControls } from "@/components/floor-plan/three/scene-controls";
import type { FloorPlanSeat } from "@/components/floor-plan/types";
import { FULL_FLOOR_BOUNDS, zoneSeatBounds, type ZoneCode } from "@/lib/floorplan";
import {
  LOD_3D_ENTER_BAY,
  LOD_3D_EXIT_BAY,
  resolveLod,
  type LodLevel,
} from "@/lib/floor-plan-lod";

/** North-west and high, so the wings shade each other rather than the drawing. */
const SUN: [number, number, number] = [-55, 95, 45];
const SUN_DISTANCE = Math.hypot(...SUN);
const SHADOW_HALF = Math.max(FLOOR_SIZE.width, FLOOR_SIZE.depth) * 0.62;

export interface Scene3DProps {
  seats: FloorPlanSeat[];
  activeZone: ZoneCode | null;
  focusedSeatCode: string | null;
  selectedSeatCode: string | null;
  reduceMotion: boolean;
  onFocusSeat: (code: string | null) => void;
  onActivateSeat: (seat: FloorPlanSeat) => void;
  onContextLost: () => void;
  onFailure: () => void;
  showOccupancyLabels?: boolean;
  showRoomLabels?: boolean;
  className?: string;
  /** Announced on the canvas itself, never on a wrapper holding controls. */
  ariaLabel: string;
}

/**
 * The 3D view of Floor 4.
 *
 * This module, and only this module, is what `next/dynamic` pulls in — nothing
 * outside `three/` imports three.js, so a user who never opens the 3D view never
 * downloads it.
 *
 * The whole scene is: one textured plane (the drawing), three merged wall
 * meshes, two instanced furniture meshes, at most six glyph plates, one baked
 * contact shadow and a ring or two of gold. Everything else is lighting.
 */
export default function Scene3D(props: Scene3DProps) {
  const {
    seats,
    activeZone,
    focusedSeatCode,
    selectedSeatCode,
    reduceMotion,
    onFocusSeat,
    onActivateSeat,
    onContextLost,
    onFailure,
    showOccupancyLabels = false,
    showRoomLabels = true,
    className,
    ariaLabel,
  } = props;

  const [palette, setPalette] = useState<SeatPalette | null>(null);
  const [glyphAtlas, setGlyphAtlas] = useState<Texture | null>(null);
  // Starts at the measured ceiling; <PerformanceMonitor> walks it down to 1
  // if this machine cannot hold it.
  const [dpr, setDpr] = useState(1.5);
  const [view, setView] = useState<"free" | "topDown">("free");
  // Bumped by "Refit", which has to re-fly even when no other state changed —
  // the whole point of the button is that you have orbited away and want back.
  const [refit, setRefit] = useState(0);
  const controls = useRef<OrbitControlsImpl | null>(null);
  const light = useRef<DirectionalLight | null>(null);

  // Level of detail. Starts at "bay" because the scene opens on whole-floor
  // framing, so the first paint is already the right one rather than a flash
  // of unreadable glyphs that resolves a frame later.
  const [lod, setLod] = useState<LodLevel>("bay");

  /**
   * The palette is read out of the live cascade rather than hard-coded, so it
   * has to wait for the stylesheet. Reading it in an effect (not during render)
   * is also what keeps this correct if the tokens ever change at runtime.
   */
  useEffect(() => {
    try {
      const next = readSeatPalette();
      setPalette(next);
      setGlyphAtlas(buildGlyphAtlas(`#${next.chrome.paper.getHexString()}`));
    } catch {
      onFailure();
    }
  }, [onFailure]);

  useEffect(() => {
    const atlas = glyphAtlas;
    return () => atlas?.dispose();
  }, [glyphAtlas]);

  const initialCamera = useMemo(() => {
    const framing = frameRect(FULL_FLOOR_BOUNDS, 16 / 10);
    return {
      position: framing.position.toArray() as [number, number, number],
      fov: FOV,
      near: 0.5,
      far: Math.max(FLOOR_SIZE.width, FLOOR_SIZE.depth) * 4,
    };
  }, []);

  if (!palette || !glyphAtlas) {
    return (
      <div
        className={className}
        role="status"
        aria-label="Preparing the 3D floor plan"
      />
    );
  }

  return (
    <div className={className} data-floor-3d="ready">
      {/*
        role="img" belongs on the CANVAS, not on a container that also holds
        the scene controls.

        ADR-032's position is that the 3D view is a picture and not the
        accessible path, which is right — but the role was on an outer wrapper
        that also contained the "Top down" and "Refit" buttons. An element
        announced as an image containing focusable controls is axe's
        `nested-interactive`, serious: a screen reader presents the subtree as
        one image, so the two buttons inside it are announced as part of a
        picture or not at all.

        This surface had never been audited. It was added to the axe sweep in
        Phase 7 and failed on the first run, which is the entire argument for
        auditing surfaces you believe are fine.
      */}
      <div role="img" aria-label={ariaLabel} className="h-full w-full">
      <Canvas
        // `touch-action: none` belongs on the canvas alone. Put it on the
        // container and a phone can no longer scroll the page past the plan.
        style={{ touchAction: "none" }}
        dpr={dpr}
        camera={initialCamera}
        shadows="soft"
        gl={{
          antialias: true,
          powerPreference: "high-performance",
          alpha: false,
          // NO FILMIC CURVE. R3F defaults to ACES tone mapping, which is built
          // for photographic content and rolls a white surface down toward the
          // middle of the range. The floor here is a scan of a paper drawing —
          // it came out a flat mid-grey, and every attempt to fix it by adding
          // light only pushed the walls further into clipping. An architectural
          // drawing wants a linear transfer and nothing else.
          toneMapping: NoToneMapping,
        }}
        onCreated={({ gl, scene }) => {
          scene.background = palette.chrome.paper;
          gl.domElement.addEventListener("webglcontextlost", (e) => {
            e.preventDefault();
            onContextLost();
          });
        }}
      >
        <PerformanceMonitor
          // Under load, resolution is the first thing to give: a slightly
          // softer image at 60fps beats a crisp one at 35. The floor of 1 is
          // deliberate — below that the CAD hairlines stop resolving and the
          // view loses the thing it exists to show.
          // THE CEILING IS 1.5, AND IT WAS MEASURED, NOT CHOSEN.
          //
          // On an Intel HD 520 — a 2015 integrated GPU, and a fair floor for
          // "mid-range laptop" — the whole floor renders at:
          //
          //     dpr 2.00   48 fps
          //     dpr 1.75   55 fps
          //     dpr 1.50   58 fps idle, 59 orbiting, 56 framing one wing
          //
          // Left at 2 the monitor also oscillates: filtering to a single wing
          // sheds a third of the triangles, frame rate rises, the extra headroom
          // is spent on resolution, and the result is SLOWER than before the
          // filter. 1.5 sits inside the budget everywhere and still supersamples
          // on a 1x display, which is what keeps the CAD hairlines legible.
          onIncline={() => setDpr(Math.min(1.5, dpr + 0.25))}
          onDecline={() => setDpr(Math.max(1, dpr - 0.25))}
        />

        {/*
          Architectural, not cinematic. A broad ambient so nothing is ever
          unreadably dark, one directional light for enough shading to tell a
          wall from a floor, and a single hemisphere fill to keep the shadowed
          faces from going flat grey. No shadow map, no bloom, no tone mapping
          tricks — this is a drawing standing up, and it should look like one.

          THE INTENSITIES SUM TO ABOUT PI, AND THAT IS NOT A COINCIDENCE.
          three has used physically-correct lighting since r155: the diffuse
          BRDF divides by pi, so an irradiance of 1.0 renders a white surface at
          roughly a third of white. Reasoning about these as if they were
          multipliers — "keep the total near 1.0 so the drawing does not blow
          out" — produces a floor at 64% brightness, which is a flat mid-grey
          where the architect's drawing should be. It was measured out of a
          screenshot in the end, not argued about: 1.5 + 0.6 + 1.3·cos puts a
          horizontal floor at paper white and a vertical wall comfortably below
          it, which is what gives the model faces.
        */}
        <ambientLight intensity={1.5} />
        <hemisphereLight intensity={0.6} groundColor={palette.chrome.hairline} />
        {/*
          THE CONTACT SHADOW, and two dead ends worth recording.

          drei's <ContactShadows> was the obvious choice. It bakes its depth
          pass on the frame it mounts, which is before the merged wall geometry
          and the instanced furniture exist, and an empty pass reads back as a
          solid dark rectangle — a flat grey sheet over the entire drawing.
          Delaying the mount by a few frames did not fix it.

          A real shadow map does the job, but the second attempt froze it after
          three frames (`shadowMap.autoUpdate = false`) to save the pass, and
          froze a map that had been rendered before this light's shadow camera
          was configured. Every depth compared as occluded, so the whole floor
          came out uniformly shadowed — which looks exactly like a lighting bug
          and is really an ordering one. Twice.

          So: the frustum is set declaratively, before the first render rather
          than in an effect after it, and the map is simply not frozen. The
          scene is 11 draw calls and 40k triangles; one more pass per frame is
          not worth another ordering hazard.

          `near`/`far` bracket the light's own distance instead of spanning 1 to
          400 metres — depth precision is spread over whatever range is set, and
          over 400 m it is coarse enough that a flat floor self-shadows.
        */}
        <directionalLight
          ref={light}
          position={SUN}
          intensity={1.3}
          castShadow
          shadow-mapSize-width={2048}
          shadow-mapSize-height={2048}
          shadow-bias={-0.0009}
          shadow-normalBias={0.03}
          shadow-camera-near={SUN_DISTANCE - 90}
          shadow-camera-far={SUN_DISTANCE + 130}
          shadow-camera-left={-SHADOW_HALF}
          shadow-camera-right={SHADOW_HALF}
          shadow-camera-top={SHADOW_HALF}
          shadow-camera-bottom={-SHADOW_HALF}
        />

        <Floor paper={`#${palette.chrome.paper.getHexString()}`} />
        {/*
          A WHITE STUDY MODEL, not a navy one.

          Navy is the drawing's own wall colour, and the first build used it
          here for that reason. As a 1px stroke on paper it is a line; as a
          solid volume it is a black mass, and 534 of them buried the drawing
          they are standing on. Architects build massing models in white for
          exactly this reason — the model is the form, and the information
          lives on the sheet underneath and in the coloured desks.

          So the shell is white and hairline, and navy is spent where it earns
          something: the glazing, and the seat statuses.
        */}
        <Walls
          palette={{
            wall: palette.chrome.surface,
            partition: palette.chrome.hairline,
            glazing: palette.chrome.navy,
          }}
        />
        {/*
          Static furniture, between the shell and the desks. Drawn BEFORE the
          seats deliberately: this is context, the desks are content, and
          nothing here is pickable — see the raycast note in static-furniture.
        */}
        <StaticFurniture palette={palette} />
        {/*
          Room labels, so a wing with no desks reads as "meeting rooms" rather
          than as a fault. One merged mesh over one strip atlas: one draw call.
        */}
        {showRoomLabels && <RoomLabels palette={palette} />}
        {/*
          The far half of the LOD switch. At whole-floor framing a desk is a
          few pixels across and its status glyph is sub-pixel, so instead of
          seven statuses nobody can tell apart the plan answers the question
          that framing actually asks: how full is each bay. One merged mesh
          over one strip atlas, so this REPLACES up to six glyph meshes with
          one and the draw-call count goes down, not up.
        */}
        {lod === "bay" && showOccupancyLabels && <BayPlates seats={seats} palette={palette} />}
        <Seats
          seats={seats}
          palette={palette}
          glyphAtlas={glyphAtlas}
          focusedSeatCode={focusedSeatCode}
          selectedSeatCode={selectedSeatCode}
          reduceMotion={reduceMotion}
          onFocusSeat={onFocusSeat}
          onActivateSeat={onActivateSeat}
          lod={lod}
        />


        <OrbitControls
          ref={controls}
          enableDamping
          dampingFactor={0.08}
          enablePan
          // Never below the floor, and never flat by accident. The only route
          // to a true plan view is the Top down button, which is a decision
          // rather than something you fall into mid-drag.
          minPolarAngle={view === "topDown" ? POLAR.topDown : POLAR.min}
          maxPolarAngle={POLAR.max}
          minDistance={6}
          maxDistance={Math.max(FLOOR_SIZE.width, FLOOR_SIZE.depth) * 1.4}
          // Auto-rotation is never on. This is a wayfinding tool for a
          // chartered accountancy firm, not a product turntable.
          autoRotate={false}
        />

        <PerfProbe lod={lod} />
        <LodDirector
          controls={controls}
          lod={lod}
          onChange={setLod}
          activeZone={activeZone}
        />
        <CameraDirector
          controls={controls}
          reduceMotion={reduceMotion}
          activeZone={activeZone}
          seats={seats}
          focusSeat={seats.find((s) => s.seatCode === selectedSeatCode) ?? null}
          view={view}
          refit={refit}
          onViewSettled={setView}
        />
      </Canvas>
      </div>

      <SceneControls
        activeZone={activeZone}
        view={view}
        onTopDown={() => {
          setView("topDown");
          setRefit((n) => n + 1);
        }}
        onWholeFloor={() => {
          setView("free");
          setRefit((n) => n + 1);
        }}
      />
    </div>
  );
}

/**
 * Everything that moves the camera, in one place inside the Canvas.
 *
 * It has to be a child of <Canvas> to reach `useFrame`, and keeping every
 * flight here rather than scattering them through the tree is what stops two
 * effects fighting for the camera on the same frame — which looks exactly like
 * a stutter and is very hard to read as anything else.
 */
/**
 * The LOD switch, driven by how far the camera actually is from the floor.
 *
 * Distance rather than a zoom number, because in 3D "how far away am I" IS the
 * distance, and it is the quantity that decides whether a 1.3 m desktop covers
 * enough pixels for a glyph on it to resolve.
 *
 * setState is called ONLY when the level changes, which is a handful of times
 * in a session -- never per frame. `resolveLod` supplies the hysteresis, so a
 * damped orbit settling across the boundary cannot make the scene flicker
 * between two renderings, which is worse than either of them.
 *
 * CameraDirector owns camera FLIGHT and this owns what the camera's position
 * MEANS; they are kept apart so a flight in progress cannot suppress a switch.
 *
 * A4: an EXPLICIT zone selection forces seat detail regardless of distance.
 * `zoneBounds`'s convex hull used to inflate the fit-to-zone framing enough
 * that a wing routinely landed just inside "bay" — chips, not desks, on the
 * screen a zone picker exists to show desks on. The fit is tight to the
 * zone's own seats now (see CameraDirector's `flyToZone` below) and clears
 * the exit threshold with margin on every viewport this scene actually
 * renders at, but picking a zone is a distinct signal from ambient orbiting
 * either way — "show me this wing's desks" — so it bypasses the hysteresis
 * outright rather than trusting a distance number to land on the right side
 * of it every time.
 */
function LodDirector({
  controls,
  lod,
  onChange,
  activeZone,
}: {
  controls: React.RefObject<OrbitControlsImpl | null>;
  lod: LodLevel;
  onChange: (next: LodLevel) => void;
  activeZone: ZoneCode | null;
}) {
  useFrame(({ camera }) => {
    if (activeZone) {
      if (lod !== "seat") onChange("seat");
      return;
    }
    const target = controls.current?.target;
    if (!target) return;
    const next = resolveLod(
      lod,
      camera.position.distanceTo(target),
      LOD_3D_ENTER_BAY,
      LOD_3D_EXIT_BAY,
    );
    if (next !== lod) onChange(next);
  });
  return null;
}

function CameraDirector({
  controls,
  reduceMotion,
  activeZone,
  seats,
  focusSeat,
  view,
  refit,
  onViewSettled,
}: {
  controls: React.RefObject<OrbitControlsImpl | null>;
  reduceMotion: boolean;
  activeZone: ZoneCode | null;
  seats: FloorPlanSeat[];
  focusSeat: FloorPlanSeat | null;
  view: "free" | "topDown";
  refit: number;
  onViewSettled: (v: "free" | "topDown") => void;
}) {
  const { flyTo } = useCameraFlight(controls, reduceMotion);
  const size = useThree((s) => s.size);
  const aspect = size.width / Math.max(size.height, 1);
  /**
   * Quantised, so the framing effect re-runs when the viewport's SHAPE changes
   * and not on every pixel of a drag-resize.
   *
   * Without this the fit was computed once, against whatever size the canvas
   * happened to have at mount, and never revisited — which is invisible on a
   * desktop and obvious on a phone, where a 90-metre-wide building framed for a
   * landscape viewport hangs off both edges of a portrait one.
   */
  const aspectKey = Math.round(aspect * 8);

  const flyToZone = useCallback(
    (zone: ZoneCode | null, polar: number) => {
      // Tight to the zone's own desks (A4), not the convex hull's bounding
      // box — the hull fans out from the interior centroid, so its bbox
      // drags in the core and overlaps the neighbouring zone by ~32 plan
      // units, inflating the frame enough to land the fit in bay detail.
      const rect = zone ? zoneSeatBounds(seats, zone) : FULL_FLOOR_BOUNDS;
      flyTo(frameRect(rect, aspect, polar, AZIMUTH_DEFAULT), 0.75);
    },
    [aspect, flyTo, seats],
  );

  // The zone filter is shared state: choosing Zone C on the 2D plan and then
  // switching to 3D lands you looking at Zone C, because it is the same value.
  useEffect(() => {
    flyToZone(activeZone, view === "topDown" ? POLAR.topDown : POLAR.default);
    // One effect owns the framing flight, so a zone change, a top-down and a
    // refit can never put two flights on the camera in the same frame.
  }, [activeZone, view, refit, aspectKey, flyToZone]);

  // Selecting a seat frames it. Selection is shared with the 2D view, so this
  // fires whether the seat was picked here or in the plan.
  useEffect(() => {
    if (!focusSeat) return;
    onViewSettled("free");
    flyTo(frameSeat(focusSeat.planX, focusSeat.planY), 0.7);
    // Keyed on the seat CODE alone, not the seat object: /api/floor refetches
    // every 30 seconds and hands back a new object for the same desk, and
    // depending on it would re-fly the camera out from under the user twice a
    // minute for as long as a dialog stayed open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusSeat?.seatCode]);

  return null;
}
