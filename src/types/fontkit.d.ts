/**
 * Upstream fontkit ships no types, and only named exports (no default). The
 * PDF code uses `create` alone and casts its result to the shape it reads, so
 * this declares no more than that.
 */
declare module "fontkit" {
  export function create(buffer: Buffer | Uint8Array): unknown;
}
