/**
 * Which menu entry the current address selects: the most specific match, so
 * /students/import does not also light up /students, and a tab link
 * (/academics?tab=subjects) is its own destination on a shared pathname.
 */
export function activeDestination(pathname: string, search: string, destinations: string[]): string | null {
  const params = new URLSearchParams(search);
  const candidates = destinations.filter((href) => {
    const [path, query] = href.split("?");
    if (query) {
      return pathname === path && [...new URLSearchParams(query)].every(([key, value]) => params.get(key) === value);
    }
    return path === "/" ? pathname === "/" : pathname === path || pathname.startsWith(`${path}/`);
  });
  return candidates.sort((a, b) => b.length - a.length)[0] ?? null;
}
