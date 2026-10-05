-- 0335: Three checks linked to pages that do not exist.
--
-- Found by the 0333 walkthrough of every page in a fresh college: /checks
-- prefetched two addresses that answered 404. A finding is only worth what it
-- costs to act on it (rule 11), and these three sent the office to a "page not
-- found" from the one screen whose job is to say what to fix:
--
--   communication.templates  /notifications/templates  -> /notifications/log
--     (templates are edited from the delivery log's Templates section)
--   schedules.reach          /schedules                -> /notifications/schedules
--   schedules.alive          /schedules                -> /notifications/schedules
--
-- tests/app-shell/catalogue-links-resolve.test.ts now reads every href a
-- catalogue migration writes and fails on one no page answers.

begin;

update reference.checks set href = '/notifications/log' where key = 'communication.templates';
update reference.checks set href = '/notifications/schedules' where key in ('schedules.reach', 'schedules.alive');

commit;
