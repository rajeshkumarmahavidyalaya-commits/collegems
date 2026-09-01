import { hasPermission } from "@/lib/auth/permissions";
import { getStudentAccount } from "../../actions";
import { StudentAccountView } from "./student-account";

export const metadata = { title: "Fee account" };

export default async function StudentFeeAccountPage({
  params,
}: {
  params: Promise<{ studentId: string }>;
}) {
  const { studentId } = await params;
  const [account, canCollect] = await Promise.all([
    getStudentAccount(studentId),
    hasPermission("fees.collect"),
  ]);

  return <StudentAccountView account={account} canCollect={canCollect} />;
}
