import { User } from "lucide-react";
import { CARD_ASPECT, type PersonCard, type SchoolIdentity } from "@/lib/validations/id-card";
import type { Translator } from "@/lib/i18n/translate";

/**
 * One identity card, at the size a laminating pouch is cut for.
 *
 * A **Server Component**, so it takes `t` as a prop rather than calling a hook
 * — rule 15's fourth shape, and the one that shipped a blank screen once when a
 * Server Component reached for `useI18n`.
 *
 * It renders a `PersonCard` rather than a student: a heading, a subtitle and a
 * list of already-labelled facts. The first version was student-shaped, and
 * staff cards would have meant either a second component or a type where half
 * the fields are always null — neither of which survives a third kind of card.
 * **Each module decides what a card says; this decides what one looks like.**
 *
 * The photograph is an `<img>` against a signed URL that was issued in the
 * action, after the row came back through RLS. It is deliberately **not**
 * `next/image`: the optimiser would fetch the signed URL server-side and cache
 * the result behind a stable, unsigned `/_next/image` address, which turns a
 * ten-minute bearer token into a public one. A child's photograph is the last
 * thing in this product that should acquire a permanent URL.
 */
export function IdCardFace({
  card,
  school,
  t,
}: {
  card: PersonCard;
  school: SchoolIdentity;
  t: Translator;
}) {
  return (
    <div
      data-print="keep"
      style={{ aspectRatio: CARD_ASPECT }}
      className="flex w-full flex-col overflow-hidden rounded-lg border border-border bg-card text-card-foreground print:border-black"
    >
      <div className="flex items-baseline justify-between gap-2 border-b border-border bg-muted/50 px-3 py-1.5 print:bg-transparent">
        <span className="truncate text-[0.7rem] font-semibold uppercase tracking-wide">
          {school.name}
        </span>
        {school.sessionName && (
          <span className="shrink-0 text-[0.6rem] text-muted-foreground">
            {t("idCard.validFor", { session: school.sessionName })}
          </span>
        )}
      </div>

      <div className="flex min-h-0 flex-1 gap-3 px-3 py-2">
        {/* The photograph. A dashed placeholder rather than a blank rectangle,
            so a card printed without one is visibly unfinished on paper as well
            as in the list of gaps. */}
        <div className="flex h-full w-[22%] shrink-0 items-center justify-center overflow-hidden rounded border border-border bg-muted print:bg-transparent">
          {card.photoUrl ? (
            /* next/image is refused on purpose: the optimiser fetches the
               signed URL server-side and caches it behind a stable, unsigned
               /_next/image address, turning a ten-minute bearer token into a
               permanent one. A child's photograph is the last thing here that
               should acquire a public URL. */
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={card.photoUrl}
              alt=""
              className="h-full w-full object-cover"
              // The name is already on the card, so the photograph carries no
              // information a screen reader needs. An alt of the child's name
              // would read it twice.
            />
          ) : (
            <User className="size-5 text-muted-foreground" aria-hidden="true" />
          )}
        </div>

        <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5">
          <p className="truncate text-sm font-semibold leading-tight">{card.fullName}</p>
          {card.subtitle && (
            <p className="truncate text-[0.7rem] text-muted-foreground">{card.subtitle}</p>
          )}
          <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-[0.65rem]">
            {card.facts.map((fact) => (
              <Row key={fact.label} label={fact.label} value={fact.value} />
            ))}
          </dl>
        </div>
      </div>

      {(school.addressLine || school.phone) && (
        <p className="truncate border-t border-border px-3 py-1 text-[0.6rem] text-muted-foreground">
          {[school.addressLine, school.phone].filter(Boolean).join(" · ")}
        </p>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="whitespace-nowrap text-muted-foreground">{label}</dt>
      <dd className="truncate font-medium">{value}</dd>
    </>
  );
}

/**
 * A sheet of cards, two to a row.
 *
 * `data-print="page"` is on each group of eight rather than on each card, which
 * is the difference between one sheet of paper carrying eight cards and eight
 * sheets carrying one each. The report-card module put that attribute on every
 * card deliberately — a report card *is* a page — and copying it here without
 * thinking would waste seven sheets in every eight.
 */
export function IdCardSheet({
  cards,
  school,
  t,
  perSheet,
}: {
  cards: PersonCard[];
  school: SchoolIdentity;
  t: Translator;
  perSheet: number;
}) {
  const sheets: PersonCard[][] = [];
  for (let i = 0; i < cards.length; i += perSheet) sheets.push(cards.slice(i, i + perSheet));

  return (
    <div className="flex flex-col gap-6">
      {sheets.map((sheet, index) => (
        <div
          key={index}
          data-print="page"
          className="grid grid-cols-1 gap-4 sm:grid-cols-2 print:grid-cols-2"
        >
          {sheet.map((card) => (
            <IdCardFace key={card.id} card={card} school={school} t={t} />
          ))}
        </div>
      ))}
    </div>
  );
}
