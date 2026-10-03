import {
  BedDouble,
  Bell,
  BookOpen,
  Boxes,
  Bus,
  FileSpreadsheet,
  GraduationCap,
  LayoutDashboard,
  Library,
  School,
  Settings2,
  Sparkles,
  Users,
  Wallet,
} from "lucide-react";
import type { MessageKey } from "@/lib/i18n/messages/en";
import type { NavGroup, NavItem } from "./nav-config";

/**
 * The reference's module menu (School Management, SM School, SM Academic, ...)
 * laid over the role-filtered tree. **Presentation only**: it regroups and
 * renames entries `navForRole` already allowed, and may add exactly three
 * destinations -- the setup wizard, and the subjects and holidays tabs -- each
 * only beside a screen already in the person's menu. It never grants an entry,
 * and every page still checks its own permission (rule 4).
 *
 * Each module and label has a message key, so the menu is not English-only in
 * Hindi and Urdu (rule 15). An entry not placed in a module lands in "More"
 * rather than disappearing.
 */
const MODULES: { title: string; messageKey: MessageKey; icon: NavGroup["icon"]; paths: string[] }[] = [
  { title: "School Management", messageKey: "nav.module.management", icon: GraduationCap, paths: ["/academics/sessions", "/settings/plan"] },
  { title: "SM School", messageKey: "nav.module.school", icon: School, paths: ["/", "/academics", "/settings/school", "/checks"] },
  {
    title: "SM Academic",
    messageKey: "nav.module.academic",
    icon: BookOpen,
    paths: [
      "/timetable", "/timetable/me", "/timetable/substitutions", "/attendance", "/attendance/report",
      "/attendance/leave", "/study-material", "/homework", "/notices", "/calendar", "/live-classes",
      "/academics/electives", "/my-subjects",
    ],
  },
  {
    title: "SM Student",
    messageKey: "nav.module.student",
    icon: GraduationCap,
    paths: ["/front-office", "/students", "/students/import", "/students/id-cards", "/promotion", "/certificates"],
  },
  {
    title: "SM Administrator",
    messageKey: "nav.module.administrator",
    icon: Users,
    paths: ["/settings/team", "/settings/permissions", "/staff", "/staff/id-cards", "/hr", "/hr/leave", "/hr/biometric", "/hr/salary", "/payroll"],
  },
  {
    title: "SM Accounting",
    messageKey: "nav.module.accounting",
    icon: Wallet,
    paths: [
      "/fees/setup", "/fees/instalments", "/fees/concessions", "/fees/invoices", "/fees/counter", "/fees",
      "/fees/daybook", "/fees/family", "/accounts", "/accounts/vouchers",
    ],
  },
  { title: "SM Examination", messageKey: "nav.module.examination", icon: FileSpreadsheet, paths: ["/exams", "/class-tests", "/online-tests", "/report-card"] },
  { title: "SM Library", messageKey: "nav.module.library", icon: Library, paths: ["/library/books", "/library/issues", "/library/members"] },
  { title: "SM Transport", messageKey: "nav.module.transport", icon: Bus, paths: ["/transport", "/transport/assignments", "/arrangements"] },
  { title: "SM Hostel", messageKey: "nav.module.hostel", icon: BedDouble, paths: ["/hostel"] },
  { title: "SM Stationary", messageKey: "nav.module.stationary", icon: Boxes, paths: ["/inventory"] },
  { title: "SM Reports", messageKey: "nav.module.reports", icon: FileSpreadsheet, paths: ["/reports"] },
  {
    title: "SM Communication",
    messageKey: "nav.module.communication",
    icon: Bell,
    paths: ["/notifications", "/notifications/compose", "/notifications/log", "/notifications/channels", "/notifications/schedules"],
  },
  { title: "SchoolOS Tools", messageKey: "nav.module.tools", icon: Sparkles, paths: ["/assistant", "/scan", "/settings/jobs", "/settings/language"] },
];

/** The reference's names for screens this product already has. */
const LABELS: Record<string, { title: string; messageKey: MessageKey }> = {
  "/academics/sessions": { title: "Sessions", messageKey: "nav.ref.sessions" },
  "/settings/plan": { title: "Plan & License", messageKey: "nav.ref.plan" },
  "/academics": { title: "Manage Classes", messageKey: "nav.ref.classes" },
  "/settings/school": { title: "Settings", messageKey: "nav.ref.settings" },
  "/checks": { title: "Setup Checks", messageKey: "nav.ref.checks" },
  "/timetable": { title: "Class Timetable", messageKey: "nav.ref.classTimetable" },
  "/timetable/me": { title: "My Timetable", messageKey: "nav.ref.myTimetable" },
  "/attendance/leave": { title: "Student Leaves", messageKey: "nav.ref.studentLeaves" },
  "/study-material": { title: "Study Materials", messageKey: "nav.ref.studyMaterials" },
  "/notices": { title: "Noticeboard", messageKey: "nav.ref.noticeboard" },
  "/calendar": { title: "Calendar", messageKey: "nav.ref.calendar" },
  "/front-office": { title: "Inquiries", messageKey: "nav.ref.inquiries" },
  "/students/import": { title: "Bulk Admission", messageKey: "nav.ref.bulkAdmission" },
  "/students/id-cards": { title: "Print ID Cards", messageKey: "nav.ref.idCards" },
  "/promotion": { title: "Promote", messageKey: "nav.ref.promote" },
  "/settings/team": { title: "Admins", messageKey: "nav.ref.admins" },
  "/settings/permissions": { title: "Roles", messageKey: "nav.ref.roles" },
  "/staff": { title: "Staff List", messageKey: "nav.ref.staffList" },
  "/hr": { title: "Staff Attendance", messageKey: "nav.ref.staffAttendance" },
  "/hr/leave": { title: "Staff Leaves", messageKey: "nav.ref.staffLeaves" },
  "/payroll": { title: "Staff Payroll", messageKey: "nav.ref.payroll" },
  "/fees/setup": { title: "Fee Types", messageKey: "nav.ref.feeTypes" },
  "/fees/concessions": { title: "Students Concession", messageKey: "nav.ref.concessions" },
  "/fees/invoices": { title: "Fee Invoices", messageKey: "nav.ref.invoices" },
  "/fees/counter": { title: "Collect Payment", messageKey: "nav.ref.collect" },
  "/fees": { title: "Fee Balances", messageKey: "nav.ref.balances" },
  "/fees/daybook": { title: "Payment History", messageKey: "nav.ref.payments" },
  "/exams": { title: "Manage Exams", messageKey: "nav.ref.exams" },
  "/library/books": { title: "All Books", messageKey: "nav.ref.books" },
  "/library/issues": { title: "Books Issued", messageKey: "nav.ref.issues" },
  "/library/members": { title: "Library Cards", messageKey: "nav.ref.libraryCards" },
  "/transport": { title: "Vehicles & Routes", messageKey: "nav.ref.routes" },
  "/transport/assignments": { title: "Assign Transport", messageKey: "nav.ref.assignTransport" },
  "/inventory": { title: "Items", messageKey: "nav.ref.stock" },
  "/hostel": { title: "Hostels", messageKey: "nav.ref.hostels" },
};

/** The entries the reference has that the source tree does not. */
export const REFERENCE_EXTRA_HREFS = ["/setup", "/academics?tab=subjects", "/academics?tab=holidays"] as const;

export function referenceNavigation(groups: NavGroup[]): NavGroup[] {
  const available = new Map(groups.flatMap((g) => g.items).map((item) => [item.href, item]));
  const used = new Set<string>();
  const result: NavGroup[] = [];

  const relabel = (item: NavItem): NavItem => {
    const label = LABELS[item.href];
    return label ? { ...item, title: label.title, messageKey: label.messageKey } : item;
  };

  for (const group of MODULES) {
    const items: NavItem[] = [];
    for (const path of group.paths) {
      const item = available.get(path);
      if (!item) continue;
      used.add(path);
      items.push(relabel(item));
    }
    // Both pages already exist and are protected; each is offered only where
    // the screen it belongs to is already in this person's menu.
    if (group.messageKey === "nav.module.academic" && available.has("/academics")) {
      items.unshift({
        ...available.get("/academics")!,
        title: "Subjects",
        messageKey: "nav.ref.subjects",
        href: "/academics?tab=subjects",
      });
    }
    // The holidays tab, like subjects, beside the classes screen it lives on.
    if (group.messageKey === "nav.module.academic" && available.has("/academics")) {
      const at = items.findIndex((i) => i.href === "/calendar");
      items.splice(at < 0 ? items.length : at + 1, 0, {
        ...available.get("/academics")!,
        title: "Holidays",
        messageKey: "nav.ref.holidays",
        href: "/academics?tab=holidays",
      });
    }
    // The wizard's steps come from setup_progress(), which answers only the
    // steps the caller holds the permission for; on the default matrix that is
    // the administrator alone (measured: admin 11, every other role 0). It is
    // offered beside the sessions screen, the administrator's seat, so nobody
    // is sent to a wizard with nothing in it.
    if (group.messageKey === "nav.module.school" && available.has("/academics/sessions")) {
      items.push({ title: "Setup Wizard", messageKey: "nav.ref.setupWizard", href: "/setup", icon: Settings2, setup: true });
    }
    if (items.length) result.push({ title: group.title, messageKey: group.messageKey, icon: group.icon, items });
  }

  const remaining = [...available.values()].filter((item) => !used.has(item.href)).map(relabel);
  if (remaining.length) {
    result.push({ title: "More", messageKey: "nav.module.more", icon: LayoutDashboard, items: remaining });
  }
  return result;
}
