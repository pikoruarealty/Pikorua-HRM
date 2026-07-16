"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

// Client-only square avatar cropper. Given a picked image File, it shows a
// fixed square viewport the user can pan (drag) and zoom (slider) over, then
// exports the visible square to a JPEG File via canvas. Used by the employee
// create form and the profile-photo replace control so a non-square upload can
// be cropped to the square the avatar UI expects.

const VIEWPORT = 288; // on-screen crop window size (px)
const OUTPUT = 512; // exported image size (px)

/** Read a File's natural pixel dimensions. */
export function getImageSize(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not read the image."));
    };
    img.src = url;
  });
}

export async function isSquare(file: File): Promise<boolean> {
  const { width, height } = await getImageSize(file);
  return width === height;
}

export function ImageCropModal({
  file,
  onCancel,
  onCropped,
}: {
  file: File;
  onCancel: () => void;
  onCropped: (cropped: File) => void;
}) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [cover, setCover] = useState(1); // scale so the smaller side fills VIEWPORT
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [busy, setBusy] = useState(false);
  const drag = useRef<{ startX: number; startY: number; ox: number; oy: number } | null>(null);

  // Load the image and compute the cover scale + centred starting offset.
  useEffect(() => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      const c = VIEWPORT / Math.min(image.naturalWidth, image.naturalHeight);
      setImg(image);
      setCover(c);
      setZoom(1);
      setOffset({
        x: (VIEWPORT - image.naturalWidth * c) / 2,
        y: (VIEWPORT - image.naturalHeight * c) / 2,
      });
    };
    image.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const dispW = img ? img.naturalWidth * cover * zoom : 0;
  const dispH = img ? img.naturalHeight * cover * zoom : 0;

  // Keep the image covering the viewport (no empty gaps inside the square).
  const clamp = useCallback(
    (x: number, y: number) => ({
      x: Math.min(0, Math.max(VIEWPORT - dispW, x)),
      y: Math.min(0, Math.max(VIEWPORT - dispH, y)),
    }),
    [dispW, dispH],
  );

  useEffect(() => {
    setOffset((o) => clamp(o.x, o.y));
  }, [clamp]);

  function onPointerDown(e: React.PointerEvent) {
    (e.target as Element).setPointerCapture(e.pointerId);
    drag.current = { startX: e.clientX, startY: e.clientY, ox: offset.x, oy: offset.y };
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!drag.current) return;
    const nx = drag.current.ox + (e.clientX - drag.current.startX);
    const ny = drag.current.oy + (e.clientY - drag.current.startY);
    setOffset(clamp(nx, ny));
  }
  function onPointerUp() {
    drag.current = null;
  }

  async function confirm() {
    if (!img) return;
    setBusy(true);
    try {
      const scale = cover * zoom;
      const srcSize = VIEWPORT / scale;
      const sx = -offset.x / scale;
      const sy = -offset.y / scale;

      const canvas = document.createElement("canvas");
      canvas.width = OUTPUT;
      canvas.height = OUTPUT;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas is not supported in this browser.");
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, sx, sy, srcSize, srcSize, 0, 0, OUTPUT, OUTPUT);

      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", 0.9),
      );
      if (!blob) throw new Error("Could not export the cropped image.");
      const base = file.name.replace(/\.[^.]+$/, "") || "photo";
      onCropped(new File([blob], `${base}-cropped.jpg`, { type: "image/jpeg" }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-sm rounded-lg border bg-card p-5 shadow-lg">
        <h2 className="text-base font-semibold">Crop to square</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Drag to reposition and use the slider to zoom. The area inside the circle becomes the
          profile photo.
        </p>

        <div
          className="relative mx-auto mt-4 touch-none overflow-hidden rounded-md border bg-muted"
          style={{ width: VIEWPORT, height: VIEWPORT }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          {img && (
            // eslint-disable-next-line @next/next/no-img-element -- local object URL, transformed
            <img
              src={img.src}
              alt="Crop preview"
              draggable={false}
              className="pointer-events-none absolute left-0 top-0 max-w-none select-none"
              style={{
                width: dispW,
                height: dispH,
                transform: `translate(${offset.x}px, ${offset.y}px)`,
              }}
            />
          )}
          {/* Circular mask overlay to hint the avatar shape. */}
          <div
            className="pointer-events-none absolute inset-0 rounded-md"
            style={{ boxShadow: "inset 0 0 0 9999px rgba(0,0,0,0.35)", clipPath: "circle(50%)" }}
          />
          <div className="pointer-events-none absolute inset-0 rounded-full border-2 border-white/70" />
        </div>

        <div className="mt-4 flex items-center gap-3">
          <span className="text-xs text-muted-foreground">Zoom</span>
          <input
            type="range"
            min={1}
            max={3}
            step={0.01}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
            className="flex-1"
            aria-label="Zoom"
          />
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button type="button" onClick={confirm} disabled={busy || !img}>
            {busy ? "Cropping…" : "Use photo"}
          </Button>
        </div>
      </div>
    </div>
  );
}
