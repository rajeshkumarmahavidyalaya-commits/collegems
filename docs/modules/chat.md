# Chat

The reference's SM Chat: a teacher or the office writes to students, one at a
time or as a named group from a class, and a family writes to their child's
teachers. Migrations `0350`-`0352`; the screen is `/chat`.

## Who may talk to whom

Postgres decides it, and the page only draws the form that fits the seat.

- **Starting a conversation** (`chat_start`) is for an administrator or a
  teacher. A teacher reaches the students in the classes they teach this year;
  an administrator reaches every enrolled student. `chat_reachable_in_section`
  lists a class's reachable students, marking those with no login.
- **A family** reaches only their child's teachers this year, through
  `chat_my_teachers` and `chat_start_with_teacher`. The second finds the
  existing direct conversation rather than opening another.
- **An accountant and a librarian** teach nobody and are reached by nobody,
  so the menu does not offer Chat to them, and the page's admin-or-teacher
  check mirrors `chat_start` (named in `tests/app-shell/role-branches.test.ts`).

## The shape

- `chat_conversations` (direct or group, with a name for a group),
  `chat_members` (one row per login, with `last_read_at`), `chat_messages`.
- **No table has a write policy.** Every write is a definer that checks
  membership first: `chat_start`, `chat_start_with_teacher`, `chat_send` and
  `chat_mark_read`. Reads go through `chat_is_member`, so a conversation is
  visible only to the logins in it. An administrator who is not a member reads
  none of its messages and cannot send to it.
- **A message cannot be edited or deleted.** UPDATE and DELETE are revoked on
  `chat_messages`, so a direct `update` is `42501`. A conversation between a
  teacher and a child is a record.
- **A student without a login is not added**, and the start reports how many
  were left out: *"Chat started with 1 student. 1 has no login yet and was not
  added."* A member who cannot sign in would make a conversation that looks
  complete and is not.
- **Names** come from `chat_display_name`, which is revoked from every JWT
  role. Callable directly, it would name any login in the college by id. It
  reads the profile's own person first, then the staff, student or guardian
  record, and then the role (`0352`). Before that, an administrator with no
  staff record wrote to a student as *"A member of the college"*.

## The screen

- Conversations on the left with an unread count, and the open one on the
  right. On a phone only one side shows at a time, with a back arrow.
- Opening a conversation marks it read *before* the list is read. Read side by
  side, the conversation on screen kept its unread badge.
- A sent message is drawn at once as *Sending…* (`useOptimistic`) and replaced
  by the saved row. The action's `revalidatePath` returns the page with the
  message in it, so the client does not also call `router.refresh()`. Doing
  both rendered the page twice per message.
- New messages arrive by refreshing every 10 seconds while the tab is visible.
  There is no realtime channel, deliberately: a subscription would read
  `chat_messages` under its own rules rather than through `chat_is_member`.

## Verified

In Northgate Test Annex, 7 Oct 2026:

- The teacher started a direct chat with ANX-0001 and sent a message. The
  student saw it with an unread badge and replied, and the teacher saw the
  reply with a badge.
- *Message a Teacher* listed the English teacher.
- The administrator started a chat and appeared to the student as
  *Administrator*.
- At 375 px there was no horizontal scroll, and the list hid while a
  conversation was open.
- A named group, probed in a rolled-back transaction because the Annex has
  one student with a login, came back as a group of two, with the second
  student left out and counted.
