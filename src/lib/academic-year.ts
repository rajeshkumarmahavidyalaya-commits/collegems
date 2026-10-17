import { cookies } from "next/headers";

/*
 * The year a person has chosen to look at (0355).
 *
 * The working year is the college's decision and lives in Postgres
 * (academic_sessions.is_current). This is narrower: one person opening an
 * earlier year to read it. It is kept in a cookie, sent to Postgres as the
 * `x-schoolos-year` header by the server client, and checked there: a year of
 * another college is ignored, and any year but the working one makes the whole
 * request read-only (request_year_guard). So nothing is ever filed into the
 * year on screen unless it is the working year.
 */
export const YEAR_COOKIE = "sos_year";
export const YEAR_HEADER = "x-schoolos-year";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The cookie's year, if it is shaped like one. Postgres decides whether it is this college's. */
export async function chosenYear(): Promise<string | null> {
  const value = (await cookies()).get(YEAR_COOKIE)?.value ?? "";
  return UUID.test(value) ? value : null;
}

/** What a write in a year that is not the working year is told. */
export const READ_ONLY_YEAR_MESSAGE =
  "You are looking at a year that is not the working year, and it is kept as it was. Go back to the current year to make changes.";
