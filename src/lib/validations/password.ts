/**
 * The one password rule, shared by reset and change (0289). No imports: the
 * forms that use it are client components, and a module that grows
 * `import { z }` becomes the thing it was extracted from.
 */
export const MIN_PASSWORD = 8;

export type PasswordProblem = "tooShort" | "mismatch" | null;

export function passwordProblem(password: string, confirm: string): PasswordProblem {
  if (password.length < MIN_PASSWORD) return "tooShort";
  if (password !== confirm) return "mismatch";
  return null;
}

/** Only an in-app path may follow a sign-in link: never `//host` or a URL. */
export function safeNext(next: string | null | undefined, fallback = "/"): string {
  return next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\")
    ? next
    : fallback;
}
