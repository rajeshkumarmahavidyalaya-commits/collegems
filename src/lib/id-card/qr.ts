import qrcode from "qrcode-generator";

/**
 * A QR code as a grid of dark and light modules, for a renderer to draw.
 *
 * Server-only in practice -- both the card face (a Server Component) and the
 * PDF call it -- so the encoder never reaches a browser bundle. It returns a
 * matrix rather than markup because the two renderers draw differently: an SVG
 * path on the page, pdf-lib rectangles in the file.
 *
 * Error correction **M** (15% of the code can be lost): a card lives in a
 * pocket, gets scratched and laminated, and is scanned under a classroom light.
 * H would survive more and needs a larger code on a card with no room for one.
 */
export function qrModules(text: string): boolean[][] {
  const qr = qrcode(0, "M");
  qr.addData(text, "Byte");
  qr.make();
  const n = qr.getModuleCount();
  const rows: boolean[][] = [];
  for (let r = 0; r < n; r++) {
    const row: boolean[] = [];
    for (let c = 0; c < n; c++) row.push(qr.isDark(r, c));
    rows.push(row);
  }
  return rows;
}

/**
 * The dark modules as one SVG path, in module units, runs merged along each row
 * -- a card's code is 33 x 33 modules, a few hundred of them dark, so one
 * path element rather than hundreds of rectangles.
 */
export function qrPath(modules: boolean[][], quiet = 2): string {
  const parts: string[] = [];
  modules.forEach((row, r) => {
    let c = 0;
    while (c < row.length) {
      if (!row[c]) {
        c++;
        continue;
      }
      const start = c;
      while (c < row.length && row[c]) c++;
      parts.push(`M${start + quiet} ${r + quiet}h${c - start}v1h${start - c}z`);
    }
  });
  return parts.join("");
}
