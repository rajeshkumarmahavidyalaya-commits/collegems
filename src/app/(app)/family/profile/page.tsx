import { UserCog } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import { ChangePasswordForm } from "../../account/change-password-form";
import { getContact } from "../actions";
import { EmptyCard, FamilyFrame } from "../family-frame";
import { loadFamilyPage } from "../load";
import { ChildContactForm, MyContactForm } from "./contact-form";

export const metadata = { title: "Account Settings" };

/**
 * The reference's Account Settings for a family: the child's contact details,
 * a parent's own phone and occupation, and the password. What a family may
 * not change (the name, the email) is shown and explained, not offered.
 */
export default async function FamilyProfilePage({ searchParams }: { searchParams: Promise<{ child?: string }> }) {
  const { child: requested } = await searchParams;
  const { isFamily, childList, child, ctx } = await loadFamilyPage(requested);
  const contact = child ? await getContact(child.studentId) : null;

  let mine: { phone: string; occupation: string } | null = null;
  if (ctx?.guardianId) {
    const supabase = await createClient();
    const { data: guardian } = await supabase.from("guardians").select("person_id, occupation").eq("id", ctx.guardianId).maybeSingle();
    const { data: person } = guardian
      ? await supabase.from("people").select("phone").eq("id", guardian.person_id).maybeSingle()
      : { data: null };
    mine = { phone: person?.phone ?? "", occupation: guardian?.occupation ?? "" };
  }

  return (
    <FamilyFrame title="Account Settings" icon={UserCog} isFamily={isFamily} childList={childList} child={child}>
      {child && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Student Profile Information</CardTitle>
            <CardDescription>
              {child.name} · Admission number {child.admissionNumber}. To correct a name, ask the college office.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {contact ? (
              <ChildContactForm studentId={child.studentId} initial={contact} />
            ) : (
              <EmptyCard title="These details could not be read" body="Ask the college office to check this child's record." />
            )}
          </CardContent>
        </Card>
      )}
      {mine && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Your details</CardTitle>
            <CardDescription>The phone number the college reaches you on, and your occupation.</CardDescription>
          </CardHeader>
          <CardContent>
            <MyContactForm initial={mine} />
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Account Information</CardTitle>
          <CardDescription>Change the password you sign in with.</CardDescription>
        </CardHeader>
        <CardContent>
          <ChangePasswordForm />
        </CardContent>
      </Card>
    </FamilyFrame>
  );
}
