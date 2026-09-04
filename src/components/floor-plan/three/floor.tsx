"use client";

import { useEffect, useMemo, useState } from "react";
import { useThree } from "@react-three/fiber";
import { SRGBColorSpace, TextureLoader, type Texture } from "three";

import { FLOOR_CENTRE, FLOOR_SIZE } from "@/components/floor-plan/three/coords";
import { floorplanMeta } from "@/lib/floorplan";

/**
 * THE FLOOR IS THE DRAWING.
 *
 * Not an approximation of it, not a re-render of it — the same baked webp the
 * 2D plan uses, mapped 1:1 onto the plan bounds. Looking down, this is the
 * architect's sheet: hatching, furniture linework, room labels, pixel for
 * pixel. That is what makes the whole view read as faithful, and it costs one
 * draw call.
 *
 * The alternative was extruding the CAD layers. The furniture layer alone is
 * 49,342 paths.
 *
 * Two details that matter more than they look:
 *
 *  · ANISOTROPY. At a 53 degree tilt the far half of the floor is seen at a
 *    grazing angle, where plain mipmapping smears CAD hairlines into grey mush.
 *    Anisotropic filtering is the difference between "the drawing" and "a
 *    photograph of the drawing through a dirty window".
 *
 *  · THE 4096 ARRIVES LATE. The 2048 is 392 KB and the 4096 is 1,124 KB. The
 *    budget is three seconds to interactive on a cold load, so the small one
 *    ships first and the large one swaps in once the browser is idle. Same
 *    single draw call either way; the only thing that changes is how sharp it
 *    is a second later.
 */
function useAnisotropy(): number {
  const gl = useThree((s) => s.gl);
  return useMemo(() => Math.min(16, gl.capabilities.getMaxAnisotropy()), [gl]);
}

function usePlanTexture(anisotropy: number): Texture | null {
  const [texture, setTexture] = useState<Texture | null>(null);

  useEffect(() => {
    let cancelled = false;
    const loader = new TextureLoader();

    const apply = (t: Texture) => {
      if (cancelled) {
        t.dispose();
        return;
      }
      t.colorSpace = SRGBColorSpace;
      t.anisotropy = anisotropy;
      t.needsUpdate = true;
      setTexture((previous) => {
        previous?.dispose();
        return t;
      });
    };

    loader.load(floorplanMeta.texture["2048"], (t) => {
      apply(t);
      const upgrade = () => loader.load(floorplanMeta.texture["4096"], apply);
      if (typeof window.requestIdleCallback === "function") {
        window.requestIdleCallback(upgrade, { timeout: 4000 });
      } else {
        window.setTimeout(upgrade, 1500);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [anisotropy]);

  useEffect(() => () => texture?.dispose(), [texture]);

  return texture;
}

export function Floor({ paper }: { paper: string }) {
  const anisotropy = useAnisotropy();
  const texture = usePlanTexture(anisotropy);

  return (
    <group position={FLOOR_CENTRE}>
      {/* The slab under the drawing, so the floor is never see-through while
          the texture is still in flight. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]} receiveShadow={false}>
        <planeGeometry args={[FLOOR_SIZE.width, FLOOR_SIZE.depth]} />
        <meshBasicMaterial color={paper} />
      </mesh>
      {texture ? (
        <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <planeGeometry args={[FLOOR_SIZE.width, FLOOR_SIZE.depth]} />
          {/*
            Standard rather than basic, purely so the floor can RECEIVE the
            contact shadow — a basic material is unlit and cannot. The trade is
            that the drawing is now lit, which would muddy the linework if the
            light were dramatic; it is not, and `roughness: 1` with a broad
            ambient keeps the sheet reading as paper rather than as a surface.
          */}
          <meshStandardMaterial map={texture} roughness={1} metalness={0} />
        </mesh>
      ) : null}
    </group>
  );
}
