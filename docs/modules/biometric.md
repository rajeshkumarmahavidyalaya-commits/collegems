# Attendance readers

Migration `0273`, the `biometric-punch` Edge Function, `/hr/biometric`.

A fingerprint or card reader at the gate marks the **staff** register. Before
this, a college with a reader kept two registers — the machine's and the
office's — and somebody typed one into the other. Measured first: no device,
biometric or punch table anywhere, and `staff_attendance` (765 rows) written
only by `hr_mark_attendance`.

## The shape

```
reader ──POST──▶ biometric-punch (Edge Function, JWT verification off)
                   │  Authorization: Bearer <device secret>
                   ▼
                 biometric_ingest(device_id, secret, punches)   SECURITY DEFINER,
                   │                                            service_role only
                   ├─▶ biometric_punches     every punch, append-only by revoke
                   └─▶ staff_attendance      source = 'reader', first/last punch
```

The request:

```http
POST /functions/v1/biometric-punch
Authorization: Bearer 3f9c…(48 hex characters)
Content-Type: application/json

{ "device_id": "…uuid…",
  "punches": [ { "code": "17", "at": "2026-09-23T09:02:11+05:30" } ] }
```

The answer is `{accepted, duplicates, rejected[], unmatched_codes[],
register_rows, days_outside_any_year}`. Each rejection carries the punch and its
reason. The HTTP status is 401 for anything wrong with the device, 400 for a
body that is not a batch, and 413 for more than 500 punches.

## Three decisions

**1. A punch is the machine's observation; the register is still the
register.** `biometric_punches` keeps what the reader saw. The register row it
produces carries `source = 'reader'`, and a row a person wrote is **never
touched**: the upsert's `do update … where sa.source = 'reader'` is the whole
rule. An office that marked somebody *on duty* or *absent* has decided, and a
fingerprint at 09:02 does not overrule it. `hr_mark_attendance` now stamps
`source = 'register'` on insert and on conflict, so a person re-marking a reader
row takes it over and the reader never takes it back. This is rule 12's *a
record of an observation is not a place to write a decision*, read from the
other side: an observation does not overwrite a decision either.

**2. A device authenticates with a secret this system generated.** A reader
has no JWT, so this takes the payment webhook's shape (rule 6):

- the function is definer, revoked from `public`, `anon` and `authenticated`,
  and granted to `service_role` alone;
- the tenant comes from the **device row**, never from the request;
- the secret is 24 random bytes, shown once at registration and stored only as
  its SHA-256. `secret_hash` is left out of the column grant, so not even an
  administrator can read it back — a policy grants whole rows (rule 4), and
  nobody else has SELECT, so a role-wide grant narrows exactly the right thing;
- one sentence (`28000`) covers an unknown id, a retired reader and a wrong
  secret, so the endpoint is not a way to ask which ids exist (`0209`'s *the
  refusal says nothing*).

The Edge Function holds no secret of its own beyond the service key, and it
decides nothing.

**3. It filters by tenant itself, everywhere.** No policy runs inside a definer.
`academics_session_for_date` has no tenant filter because it relies on RLS,
which is correct for its INVOKER callers; called from here it would answer with
any college's year. So the year is resolved inline, by tenant and by the
punch's own **local** date (`0198`), and staff are matched by tenant, code and
`status = 'active'`.

## The smaller rules

- **Active staff only.** A departed teacher's finger at the gate is stored and
  named, and marks nobody present (`0191`: *an ending is not a door that stays
  shut*).
- **A drifted clock is refused, not filed.** A punch more than seven days old
  or more than five minutes ahead is rejected with *check the reader's clock*,
  because a reader set a day wrong files every morning under the wrong date.
- **A redelivered batch converges.** `unique (device_id, device_user_code,
  punched_at)` with `on conflict do nothing` counts the repeat as a duplicate
  and changes nothing.
- **No `last_seen_at`.** A reader posting every minute would write an audit row
  every minute for a fact the punches already carry. *When was it last heard
  from* is `max(received_at)`.
- **The punch carries no `session_id`**, deliberately against the letter of
  rule 2. It is a raw event from a machine that knows nothing about academic
  years; the register row it produces carries the year.
- **Send the offset.** A time without one is read as UTC, which is five and a
  half hours out for Kolkata, and would be filed rather than refused.

## Probed

These ran in a rolled-back transaction on the demo college, as its
administrator for the office half and as `postgres` for the ingest.

| case | result |
|---|---|
| wrong secret / unknown device / retired device | `28000`, one sentence, three times |
| body not an array | `22023` |
| 9 punches: 2 good, 1 repeat, 1 over an office row, 1 unknown code, 1 terminated, 1 ten days old, 2 malformed | accepted 5, duplicates 1, rejected 3 (each named), unmatched `X99`, `T15` |
| register | reader row 13:29–15:29 local, from 07:59/09:59 UTC, filed in 2026-27 |
| office had marked the other person *absent* | still *absent*, `source = register`, note unchanged |
| same batch again | accepted 0, duplicates 2, register rows 0 |
| `secret_hash` as the administrator | `permission denied` |
| `biometric_ingest` as `authenticated` | `permission denied` |
| code already held by somebody else | refused in a sentence |
| `biometric_problems()` | both unmatched codes, with the time on the college's clock |
| schema / privilege / audit / index / definer guards | 0 / 0 / 0 / 0 / 0 |

The HTTP path was not exercised from the sandbox: its proxy refuses the
connection (`CONNECT tunnel failed, response 403`). The function is deployed
(`biometric-punch`, version 1, JWT verification off).

`tests/hr/biometric.test.ts` is the static half. It checks:

- the grants, with only `service_role` holding EXECUTE;
- that the caller cannot name a tenant;
- that the year is resolved by tenant;
- the active-staff match;
- the reader-only update, which cannot touch `status`;
- `hr_mark_attendance` taking a row over;
- the column grant;
- the append-only revoke;
- that the browser's code pattern matches both CHECKs;
- that nothing in `src/` calls the ingest.

Each check was verified by planting its violation. The *nothing calls it* check
first failed on a doc comment, whose markdown backticks look exactly like a
template literal. It is anchored to `.rpc(` now: a guard that reads prose
reports on the prose.

## Not built, and named

- **The ZKTeco/eSSL "iclock" push protocol.** Those readers speak their own
  HTTP dialect. A college using one runs the vendor's bridge software, or a
  small relay that posts this JSON.
- **Students on the reader.** That is a different register
  (`attendance_records`, taken per class by a teacher) and a different
  question: whether a child who came through the gate was in the lesson.
- **Granting `hr.manage` beyond the administrator.** Both tables' policies
  compare `current_role_code() = 'admin'`, so a college that grants it to
  somebody else gets an empty screen rather than somebody else's secrets. That
  is `docs/modules/permissions.md`'s *it stops where a probe would be needed*.
