import { listJobKinds, listJobs } from "./actions";
import { JobsView } from "./jobs-view";

export const metadata = { title: "Background work" };

/**
 * What the school has running in the background.
 *
 * There is **no `hasPermission` gate on this page**, deliberately, and it is
 * rule 4's distinction rather than an oversight: `jobs` is row-scoped by policy
 * — an administrator sees the college's, everybody else sees the ones they
 * started — so a check here would be a second answer to a question Postgres
 * already answers, and a narrower one would hide somebody's own work from them.
 *
 * What *is* gated is starting one, and that lives in a `BEFORE INSERT` trigger
 * rather than in this page, because a plain insert through PostgREST routes
 * around any screen.
 */
export default async function JobsPage() {
  const [jobs, kinds] = await Promise.all([listJobs(), listJobKinds()]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Background work</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Long jobs run here rather than in the page that started them, a page of work at a
          time, until they are finished. Each one runs with the permissions of whoever started
          it, and stops with a reason if those change.
        </p>
      </div>

      <JobsView jobs={jobs} kinds={kinds} />
    </div>
  );
}
