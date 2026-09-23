"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Camera, CameraOff, Loader2, ScanLine, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { parseScanCode, scanTarget } from "@/lib/validations/scan-code";

/** The slice of the Barcode Detection API this uses; not yet in TypeScript's DOM lib. */
type Detector = { detect(source: CanvasImageSource): Promise<{ rawValue: string }[]> };
type DetectorClass = {
  new (options: { formats: string[] }): Detector;
  getSupportedFormats?: () => Promise<string[]>;
};

type Decode = (video: HTMLVideoElement, canvas: HTMLCanvasElement) => Promise<string | null>;

/**
 * Pick a decoder once: the browser's own where it reads QR codes (Chrome on
 * Android, most desktops), and `jsQR` otherwise (Safari, Firefox).
 *
 * `jsQR` is **imported on first use**, so a phone with a native detector never
 * downloads it and nobody pays for it who does not open this screen -- rule 15's
 * *"a conditional render is not a conditional load"*, answered with a dynamic
 * import rather than a component.
 */
async function chooseDecoder(): Promise<Decode> {
  const Native = (globalThis as { BarcodeDetector?: DetectorClass }).BarcodeDetector;
  if (Native) {
    const formats = (await Native.getSupportedFormats?.().catch(() => [])) ?? [];
    if (formats.includes("qr_code")) {
      const detector = new Native({ formats: ["qr_code"] });
      return async (video) => (await detector.detect(video))[0]?.rawValue ?? null;
    }
  }
  const { default: jsQR } = await import("jsqr");
  return async (video, canvas) => {
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (!w || !h) return null;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, w, h);
    const image = ctx.getImageData(0, 0, w, h);
    return jsQR(image.data, w, h, { inversionAttempts: "dontInvert" })?.data ?? null;
  };
}

type State =
  | { kind: "idle" }
  | { kind: "starting" }
  | { kind: "scanning" }
  | { kind: "found"; target: string }
  | { kind: "error"; message: string };

/**
 * The camera, a frame every quarter second, and a route to the record.
 *
 * Nothing is looked up here. A code names a card, `scanTarget` names the page,
 * and the page reads through RLS as though the address had been typed -- so
 * this screen can never show somebody a record their role may not read, and it
 * carries no authorization of its own to get wrong.
 */
export function Scanner() {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [state, setState] = useState<State>({ kind: "idle" });
  const [notOurs, setNotOurs] = useState(false);

  const stop = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  // Leaving the page must turn the camera off, or the light stays on.
  useEffect(() => stop, [stop]);

  async function start() {
    setNotOurs(false);
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setState({
        kind: "error",
        message: "This browser cannot open the camera here. Use a phone's browser over https.",
      });
      return;
    }
    setState({ kind: "starting" });
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      streamRef.current = stream;
      const video = videoRef.current!;
      video.srcObject = stream;
      await video.play();
      const decode = await chooseDecoder();
      setState({ kind: "scanning" });

      let busy = false;
      timerRef.current = setInterval(async () => {
        if (busy || !videoRef.current || !canvasRef.current) return;
        busy = true;
        try {
          const text = await decode(videoRef.current, canvasRef.current);
          if (!text) return;
          const code = parseScanCode(text);
          if (!code) {
            // A shop's barcode or a Wi-Fi code: say so and keep looking.
            setNotOurs(true);
            return;
          }
          const target = scanTarget(code);
          stop();
          setState({ kind: "found", target });
          router.push(target);
        } catch {
          // One bad frame is not a failure; the next one is a quarter second away.
        } finally {
          busy = false;
        }
      }, 250);
    } catch (error) {
      stop();
      const denied = error instanceof DOMException && error.name === "NotAllowedError";
      setState({
        kind: "error",
        message: denied
          ? "The camera was not allowed. Allow it for this site in the browser's settings, then try again."
          : "No camera could be opened on this device.",
      });
    }
  }

  const scanning = state.kind === "scanning" || state.kind === "starting";

  return (
    <div className="flex flex-col gap-4">
      <div className="relative mx-auto aspect-square w-full max-w-sm overflow-hidden rounded-lg border border-border bg-muted">
        <video
          ref={videoRef}
          muted
          playsInline
          aria-label="Camera preview"
          className={scanning ? "h-full w-full object-cover" : "hidden"}
        />
        {!scanning ? (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 p-6 text-center">
            <ScanLine className="size-8 text-muted-foreground" aria-hidden="true" />
            <p className="text-sm text-muted-foreground">
              Point the camera at the square code on a student&apos;s or a staff member&apos;s
              card.
            </p>
          </div>
        ) : (
          // A frame to aim with. Decorative: the whole picture is searched.
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-[18%] rounded-md border-2 border-primary/80"
          />
        )}
        <canvas ref={canvasRef} className="hidden" />
      </div>

      <div aria-live="polite" className="min-h-6 text-center text-sm">
        {state.kind === "starting" ? (
          <span className="inline-flex items-center gap-2 text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Opening the camera…
          </span>
        ) : state.kind === "scanning" ? (
          notOurs ? (
            <span className="text-muted-foreground">
              That code is not a SchoolOS card. Keep looking for the one on the card.
            </span>
          ) : (
            <span className="text-muted-foreground">Looking for a card…</span>
          )
        ) : state.kind === "found" ? (
          <span className="inline-flex items-center gap-2">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Opening the record…
          </span>
        ) : state.kind === "error" ? (
          <span role="alert" className="inline-flex items-start gap-2 text-destructive">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            {state.message}
          </span>
        ) : null}
      </div>

      <div className="flex justify-center gap-2">
        {scanning ? (
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              stop();
              setState({ kind: "idle" });
            }}
          >
            <CameraOff aria-hidden="true" />
            Stop
          </Button>
        ) : (
          <Button type="button" onClick={start}>
            <Camera aria-hidden="true" />
            {state.kind === "error" ? "Try again" : "Start the camera"}
          </Button>
        )}
      </div>

      <p className="text-center text-sm text-muted-foreground">
        No camera, or a card too worn to read?{" "}
        <Link href="/students" className="underline underline-offset-2">
          Find the student by name or admission number
        </Link>
        .
      </p>
    </div>
  );
}
