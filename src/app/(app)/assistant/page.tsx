import { redirect } from "next/navigation";
import { getUserContext } from "@/lib/auth/context";
import { suggestionsFor } from "@/lib/validations/assistant";
import { AssistantChat } from "./assistant-chat";

export const metadata = { title: "Ask SchoolOS" };

/**
 * One chat for every seat (migration 0283). What it can answer is decided by
 * whose token the Edge Function reads with -- the super admin's reaches the
 * whole college, a student's reaches their own record -- so this page does not
 * branch on the role to decide what is allowed, only on what to suggest.
 */
export default async function AssistantPage() {
  const ctx = await getUserContext();
  if (!ctx) redirect("/login");

  const scope =
    ctx.roleTier === "principal"
      ? `As ${ctx.roleName}, it can read everything in ${ctx.tenantName}: fees, attendance, results, staff and every report.`
      : ctx.roleTier === "staff"
        ? `It answers from what a ${ctx.roleName} may see in ${ctx.tenantName}, and says so when a question is outside that.`
        : ctx.roleSubject === "guardian"
          ? "It answers about your own children only."
          : "It answers about your own record only.";

  const first = ctx.displayName.split(" ")[0] || ctx.displayName;

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Ask SchoolOS</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Ask a question in plain words and get the answer with the table behind it, ready to download. {scope}
        </p>
      </div>
      <AssistantChat
        greeting={`What would you like to know, ${first}?`}
        suggestions={suggestionsFor(ctx.roleTier, ctx.roleSubject)}
      />
    </div>
  );
}
