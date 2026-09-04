-- ---------------------------------------------------------------------------
-- A channel row is not the school's to remove
-- ---------------------------------------------------------------------------
--
-- Migration 0113 got the update half right -- a policy for administrators and a
-- column-level GRANT so the dispatcher's own record is not theirs to rewrite --
-- and left the other half of `for all` open. Supabase's blanket
-- `grant all ... to authenticated` means INSERT and DELETE were still there,
-- and the policy admitted an administrator to both.
--
-- Deleting a channel row is worse than it looks. The claim query joins
-- `notification_deliveries` to `notification_channel_settings`, so a school
-- with no email row does not get an error and does not get a warning: its email
-- simply stops being claimable, `notify_channel_status()` stops returning a row
-- for it, and every screen goes quiet about a channel that is still filling up.
-- Silence is the one failure mode this module is built to avoid.
--
-- So the rows are the system's. They are created by the seed and by the trigger
-- on `tenants`, there is exactly one per tenant per channel for ever, and a
-- school configures the three columns it owns. This is the same instinct as
-- `notification_deliveries` having no INSERT policy at all: the way in is
-- narrow on purpose, and widening it is how a table stops meaning anything.

revoke insert, delete, truncate on public.notification_channel_settings
  from authenticated, anon;
