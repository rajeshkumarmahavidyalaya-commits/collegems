"use client";

import { useEffect, useState, useTransition } from "react";
import { Check, Loader2, Search, TriangleAlert } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SUBJECT_PROMPT, type RoleSubject } from "@/lib/validations/invitations-display";
import { inviteCandidates, type InviteCandidate } from "./actions";

/**
 * Who this login is for.
 *
 * The question the invitation screen never asked. `invitations` has carried
 * `guardian_id`, `student_id` and `staff_id` since migration `0004`, and
 * `handle_new_auth_user` has resolved all four onto `user_profiles` for just as
 * long — but this form sent an email address and a role, so every Parent
 * invitation created a login whose `guardian_id` is null, and the policy is not
 * ambiguous about what that means:
 *
 *     parents view own children  ... up.guardian_id = gs.guardian_id
 *
 * Null on either side and the policy matches no row. The family signs in, every
 * query is correct, and every answer is nothing.
 *
 * `hasLogin` is the half a person actually needs. Inviting somebody who already
 * signed in is the common mistake and it is silent — the second invitation
 * supersedes the first and nothing looks wrong — so it is a warning beside the
 * name rather than a refusal: a second login for one guardian is a decision a
 * school is allowed to make.
 */
export function SubjectPicker({
  subject,
  value,
  onChange,
  error,
}: {
  subject: Exclude<RoleSubject, "none">;
  value: string;
  onChange: (id: string, label: string) => void;
  error?: string;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<InviteCandidate[] | null>(null);
  const [searching, startSearch] = useTransition();

  // Re-asked whenever the kind changes: the twenty staff already on screen are
  // the wrong twenty the moment the role becomes Parent.
  useEffect(() => {
    setQuery("");
    setResults(null);
  }, [subject]);

  useEffect(() => {
    // 250 ms: below the threshold at which a person notices waiting, above the
    // one at which typing a name is twelve queries.
    const timer = setTimeout(() => {
      startSearch(async () => setResults(await inviteCandidates(subject, query)));
    }, 250);
    return () => clearTimeout(timer);
  }, [subject, query]);

  const listId = "invite-subject-list";

  return (
    <div className="grid gap-2">
      <Label htmlFor="invite-subject">{SUBJECT_PROMPT[subject]}</Label>
      <div className="relative">
        <Search
          className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          id="invite-subject"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            onChange("", "");
          }}
          placeholder="Search by name, admission number or telephone"
          className="ps-9"
          autoComplete="off"
          role="combobox"
          aria-expanded={!!results?.length}
          aria-controls={listId}
          aria-invalid={!!error}
          aria-describedby={error ? "invite-subject-error" : undefined}
        />
      </div>
      {error && (
        <p id="invite-subject-error" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <div aria-live="polite">
        {searching && (
          <p className="text-sm text-muted-foreground">
            <Loader2 className="me-1 inline size-3.5 animate-spin" aria-hidden="true" />
            Searching…
          </p>
        )}
        {!searching && results?.length === 0 && (
          <p className="text-sm text-muted-foreground">
            {query.trim()
              ? `Nobody here matches “${query.trim()}”.`
              : "There is nobody of this kind on record yet."}
          </p>
        )}
        {!searching && !!results?.length && (
          <ul id={listId} role="listbox" className="grid max-h-56 gap-1 overflow-y-auto">
            {results.map((c) => {
              const chosen = value === c.id;
              return (
                <li key={c.id} role="option" aria-selected={chosen}>
                  <button
                    type="button"
                    onClick={() => onChange(c.id, c.label)}
                    className={`flex w-full items-start gap-2 rounded-md border p-2 text-start text-sm ${
                      chosen ? "border-primary bg-accent" : "hover:bg-accent"
                    }`}
                  >
                    {chosen && <Check className="mt-0.5 size-4 shrink-0" aria-hidden="true" />}
                    <span className="min-w-0">
                      <span className="font-medium break-words">{c.label}</span>
                      {c.hint && (
                        <span className="block text-xs text-muted-foreground break-words">
                          {c.hint}
                        </span>
                      )}
                      {c.hasLogin && (
                        <span className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                          <TriangleAlert className="size-3.5 shrink-0" aria-hidden="true" />
                          Already has a login — inviting again creates a second one
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
            {results.length === 20 && (
              <li className="px-2 py-1 text-xs text-muted-foreground">
                Showing the first 20; there are at least this many. Narrow the search.
              </li>
            )}
          </ul>
        )}
      </div>
    </div>
  );
}
