import { qrModules, qrPath } from "@/lib/id-card/qr";

/**
 * A QR code as one SVG path. A Server Component: the encoder never reaches the
 * browser.
 *
 * **Black on white, whatever the theme** -- the one place in the interface a
 * colour is not a token. A QR code's contrast is a property of the code rather
 * than of the page: dark mode would invert it, and an inverted code is refused
 * by a good share of phone scanners. Printed, it is black on white anyway. The
 * `global-error.tsx` exception, for the same reason: this is not a colour
 * choice, it is the format.
 */
export function QrCode({ text, label, className }: { text: string; label: string; className?: string }) {
  const modules = qrModules(text);
  // Two modules of quiet zone rather than the specification's four: on a card
  // with no room to spare, scanners read two reliably, and the white rect
  // provides it even on a dark page.
  const size = modules.length + 4;
  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={label}
      shapeRendering="crispEdges"
      className={className}
    >
      <rect width={size} height={size} fill="white" />
      <path d={qrPath(modules)} fill="black" />
    </svg>
  );
}
