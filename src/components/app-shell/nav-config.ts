import type { LucideIcon } from "lucide-react";
import type { MessageKey } from "@/lib/i18n/messages/en";
import { referenceNavigation } from "./reference-navigation";
import {
  AlarmClock,
  ArrowUpNarrowWide,
  BadgePercent,
  BarChart3,
  BedDouble,
  Bell,
  BookOpen,
  BookOpenCheck,
  BookText,
  Boxes,
  Bus,
  Cake,
  CalendarCheck,
  CalendarClock,
  CalendarDays,
  CalendarOff,
  CalendarRange,
  ClipboardCheck,
  ClipboardList,
  CreditCard,
  DoorOpen,
  FileBadge,
  FileQuestion,
  FileSpreadsheet,
  FileText,
  FileUp,
  Fingerprint,
  Flag,
  FolderTree,
  FolderOpen,
  GraduationCap,
  HandCoins,
  Hourglass,
  IdCard,
  IndianRupee,
  KeyRound,
  Landmark,
  Languages,
  Layers,
  LayoutDashboard,
  Library,
  ListChecks,
  ListTodo,
  MapPin,
  NotebookPen,
  Palette,
  PenLine,
  PenSquare,
  Plane,
  Radio,
  Receipt,
  ScanLine,
  School,
  ScrollText,
  Settings2,
  ShieldAlert,
  Sigma,
  Sparkles,
  Tags,
  UserCheck,
  UserPlus,
  Users,
  Video,
  Wallet,
  PartyPopper,
  Star,
  ListOrdered,
  History,
  Award,
  ShoppingBag,
  UserCog,
  BookMarked,
  Ticket as TicketIcon,
  Trophy,
  MessagesSquare,
} from "lucide-react";

export type NavItem = {
  /**
   * The English label, kept as the fallback and as the thing a reader of this
   * file recognises. `messageKey` is what actually renders — leaving both here
   * means a new entry works before its translation exists, which is the same
   * bargain the message catalogue makes everywhere else.
   */
  title: string;
  messageKey?: MessageKey;
  href: string;
  icon: LucideIcon;
  roles?: string[]; // omit = every role
  /**
   * Visited when setting the college up or once a year, not every day. The
   * sidebar folds these into one collapsed "Setup" section so the daily menu
   * stays short; the command palette still finds every one of them. A
   * presentation choice only -- it narrows nothing, and `roles` still decides
   * who is offered the entry at all.
   */
  setup?: boolean;
};

export type NavGroup = {
  title: string;
  /** Drawn beside the module heading in the reference sidebar. */
  icon?: LucideIcon;
  messageKey?: MessageKey;
  items: NavItem[];
};

export const NAV_GROUPS: NavGroup[] = [
  {
    title: "Overview",
    messageKey: "nav.overview",
    items: [
      // The reference's first page: a card per school this login belongs to
      // (0323). Offered to the administrator, who is the seat that holds
      // several colleges and adds new ones; anybody else who belongs to two
      // reaches it from the school's name in the band. `my_schools` lists only
      // the caller's own colleges, so the menu decides nothing.
      {
        title: "School Management",
        messageKey: "nav.schoolsDashboard",
        href: "/schools",
        icon: School,
        roles: ["admin"],
      },
      {
        title: "Schools",
        messageKey: "nav.schools",
        href: "/schools/manage",
        setup: true,
        icon: School,
        roles: ["admin"],
      },
      { title: "Dashboard", messageKey: "nav.dashboard", href: "/", icon: LayoutDashboard },
      // Every seat, because the assistant has no access of its own: it reads
      // with the asker's token, so RLS and the matrix decide what each seat's
      // assistant can answer (0283). The menu has nothing to narrow.
      { title: "Ask SchoolOS", messageKey: "nav.assistant", href: "/assistant", icon: Sparkles },
    ],
  },
  // A family's own pages, the reference's Student and Parent Dashboard menu
  // (0346). Each is about one child the login is a family member of, read
  // through RLS or `family_owns_student`; a member of staff is offered none
  // of them, and each page tells a member of staff it is for families.
  {
    title: "My child",
    messageKey: "nav.family",
    items: [
      { title: "Fee Structure", messageKey: "nav.family.feeStructure", href: "/family/fee-structure", icon: ListOrdered, roles: ["parent", "student"] },
      { title: "Payment History", messageKey: "nav.family.payments", href: "/family/payments", icon: History, roles: ["parent", "student"] },
      { title: "Books Issued", messageKey: "nav.family.books", href: "/family/books", icon: BookOpen, roles: ["parent", "student"] },
      { title: "Exams Time Table", messageKey: "nav.family.exams", href: "/family/exams", icon: CalendarClock, roles: ["parent", "student"] },
      { title: "Exam Admit Card", messageKey: "nav.family.admitCard", href: "/family/admit-card", icon: IdCard, roles: ["parent", "student"] },
      { title: "Certificates", messageKey: "nav.family.certificates", href: "/family/certificates", icon: Award, roles: ["parent", "student"] },
      { title: "Attendance", messageKey: "nav.family.attendance", href: "/family/attendance", icon: CalendarCheck, roles: ["parent", "student"] },
      { title: "Stationary Issued", messageKey: "nav.family.stationery", href: "/family/stationery", icon: ShoppingBag, roles: ["parent", "student"] },
      { title: "Account Settings", messageKey: "nav.family.profile", href: "/family/profile", icon: UserCog, roles: ["parent", "student"] },
    ],
  },
  {
    title: "People",
    messageKey: "nav.people",
    items: [
      {
        title: "Students",
        messageKey: "nav.students",
        href: "/students",
        icon: GraduationCap,
        roles: ["admin", "teacher", "accountant", "librarian"],
      },
      // The reference's birthday list. Read from the roll through the same
      // policies, so it is offered to the same four roles as the roll.
      // Kinds of student (0281, 0328): Regular, Carry Forward, Management
      // Quota and whatever a college adds. Written by an administrator or an
      // accountant -- the policy on student_types -- so offered to them.
      {
        title: "Student Types",
        messageKey: "nav.studentTypes",
        href: "/students/types",
        setup: true,
        icon: Tags,
        roles: ["admin", "accountant"],
      },
      {
        title: "Student Birthdays",
        messageKey: "nav.studentBirthdays",
        href: "/students/birthdays",
        icon: Cake,
        roles: ["admin", "teacher", "accountant", "librarian"],
      },
      // Before a student exists. An enquiry holds a child's date of birth and a
      // family's phone number before either has any relationship with the
      // school, so RLS keeps the whole module to the office and the menu says
      // the same.
      {
        title: "Front office",
        messageKey: "nav.frontOffice",
        href: "/front-office",
        icon: DoorOpen,
        roles: ["admin", "accountant"],
      },
      // The reference's SM Gate Pass (0342): visits that name a student, on
      // the same visitor log and so for the same two seats.
      {
        title: "Gate Passes",
        messageKey: "nav.gatePasses",
        href: "/front-office/gate-passes",
        icon: DoorOpen,
        roles: ["admin", "accountant"],
      },
      {
        title: "Import students",
        messageKey: "nav.importStudents",
        href: "/students/import",
        setup: true,
        icon: FileUp,
        roles: ["admin"],
      },
      // Cards for a whole class. The same audience as the roll, deliberately:
      // a card carries the name, class, admission number and guardian phone
      // that `/students` already shows these roles, and RLS decides *which*
      // children -- a class teacher printing "their" class gets their own. The
      // page gates on `students.view` and this list agrees with it.
      {
        title: "ID cards",
        messageKey: "idCard.title",
        href: "/students/id-cards",
        setup: true,
        icon: IdCard,
        roles: ["admin", "teacher", "accountant", "librarian"],
      },
      // Certificates sit with People rather than under Reports: a leaving
      // certificate is an act performed on a child's record -- it takes them
      // off the roll -- and not a way of looking something up. The register
      // report is separately in the catalog for the auditor.
      {
        title: "Certificates",
        messageKey: "nav.certificates",
        href: "/certificates",
        icon: FileBadge,
        roles: ["admin", "teacher", "accountant"],
      },
    ],
  },
  {
    title: "Academics",
    messageKey: "nav.academics",
    items: [
      {
        title: "Academics",
        messageKey: "nav.academics",
        href: "/academics",
        setup: true,
        icon: Library,
        roles: ["admin", "teacher", "accountant"],
      },
      // The reference's Manage Medium and Manage House (0328): short lists an
      // administrator writes once and the admission form reads.
      {
        title: "Mediums",
        messageKey: "nav.mediums",
        href: "/academics/mediums",
        setup: true,
        icon: Languages,
        roles: ["admin", "teacher", "accountant"],
      },
      {
        title: "Subject Types",
        messageKey: "nav.subjectTypes",
        href: "/academics/subject-types",
        setup: true,
        icon: Tags,
        roles: ["admin", "teacher", "accountant"],
      },
      {
        title: "Houses",
        messageKey: "nav.houses",
        href: "/academics/houses",
        setup: true,
        icon: Flag,
        roles: ["admin", "teacher", "accountant"],
      },
      // The reference's Class Groups (0341): classes grouped under a head.
      {
        title: "Class Groups",
        messageKey: "nav.classGroups",
        href: "/academics/class-groups",
        setup: true,
        icon: FolderTree,
        roles: ["admin", "teacher", "accountant"],
      },
      // The year everything is filed under, and the only place the flag that
      // decides it can be moved. Its own entry rather than a card on
      // /academics: `reference.checks` links straight here, and a critic whose
      // link lands on a page where you then have to hunt is one people stop
      // following.
      {
        title: "Academic years",
        messageKey: "nav.academicYears",
        href: "/academics/sessions",
        setup: true,
        icon: CalendarRange,
        roles: ["admin"],
      },
      // Elective choice (0282): the office allots subjects to a class, and a
      // student picks from those on their own login. Two entries because they
      // are two screens for two audiences. A parent reaches the second one
      // read-only -- their children's subjects -- because a choice is a family
      // matter even though `subject_choice_save` takes the student from the
      // login and so only the student can make it.
      {
        title: "Elective subjects",
        messageKey: "nav.electives",
        href: "/academics/electives",
        setup: true,
        icon: ListTodo,
        roles: ["admin"],
      },
      {
        title: "My subjects",
        messageKey: "nav.mySubjects",
        href: "/my-subjects",
        icon: ListTodo,
        roles: ["student", "parent"],
      },
      {
        title: "Timetable",
        messageKey: "nav.classRoutine",
        href: "/timetable",
        icon: CalendarRange,
      },
      {
        title: "My week",
        messageKey: "nav.myWeek",
        href: "/timetable/me",
        icon: CalendarClock,
        roles: ["admin", "teacher"],
      },
      // Staff only, and deliberately not admin-only: a teacher opening this
      // sees what *they* are covering, which is the half of the question a
      // paper roster on a noticeboard answers badly. The office's half — who
      // is away, who is free — is gated inside the page on
      // `substitutions.manage`, because it is built on a table a teacher
      // cannot read across. See migration 0158.
      {
        title: "Substitutions",
        messageKey: "nav.cover",
        href: "/timetable/substitutions",
        icon: UserCheck,
        roles: ["admin", "teacher"],
      },
      {
        title: "Attendance",
        messageKey: "nav.attendance",
        href: "/attendance",
        icon: ClipboardCheck,
        roles: ["admin", "teacher"],
      },
      // A family asks for leave and a teacher decides it. That sentence stood
      // here with no `roles` list under it, ending "RLS narrows what each of
      // them sees" -- which is true of the four roles it was checked against
      // and false of the other two. `student_leave_requests` has SELECT
      // policies for an administrator, a class teacher, a student and a
      // guardian, and **none for an accountant or a librarian**. Measured as
      // each of them on the live college: 0 rows. Two seats were offered a
      // board headed "A family tells the school a child will be away" and
      // shown nothing on it, for ever.
      {
        title: "Student leave",
        messageKey: "nav.studentLeave",
        href: "/attendance/leave",
        icon: CalendarOff,
        roles: ["admin", "teacher", "parent", "student"],
      },
      // Not an accountant, and the reason is a disagreement rather than a
      // preference. `attendance_records` carries a `staff roles view
      // attendance` policy covering admin AND accountant, so an accountant can
      // read every register row in the college — while the matrix gives them no
      // attendance permission at all, and `attendance.summary` in the report
      // catalogue is gated on `attendance.view`, which they do not hold.
      //
      // So the catalogue already said an accountant may not run this question,
      // and this screen was handing them the same answer from the menu. Rule 4:
      // when the menu and the matrix disagree, decide which one is wrong.
      {
        title: "Attendance report",
        messageKey: "nav.attendanceReport",
        href: "/attendance/report",
        icon: BarChart3,
        roles: ["admin", "teacher"],
      },
      // The subject register (0329): taken by whoever teaches the subject,
      // who is often not the class teacher. Its functions decide who may.
      {
        title: "Subject attendance",
        messageKey: "nav.subjectAttendance",
        href: "/attendance/subject",
        icon: BookOpenCheck,
        roles: ["admin", "teacher"],
      },
      {
        title: "Exams",
        messageKey: "nav.exams",
        href: "/exams",
        icon: PenSquare,
        roles: ["admin", "teacher"],
      },
      // Admit cards are printed on exams.manage, which a college gives its
      // examination officer -- often a teacher -- so a teacher is a candidate
      // for it; the page refuses in a sentence until the matrix says yes.
      // Printed a few times a year, in exam season, so it folds into Setup.
      {
        title: "Admit Cards",
        messageKey: "nav.admitCards",
        href: "/exams/admit-cards",
        setup: true,
        icon: IdCard,
        roles: ["admin", "teacher"],
      },
      // The reference's Exam Groups (0341), set up once a year like admit
      // cards, for the same two seats as the exams screen.
      {
        title: "Exam Groups",
        messageKey: "nav.examGroups",
        href: "/exams/groups",
        setup: true,
        icon: Layers,
        roles: ["admin", "teacher"],
      },
      {
        title: "Promotion",
        messageKey: "nav.promotion",
        href: "/promotion",
        setup: true,
        icon: ArrowUpNarrowWide,
        roles: ["admin"],
      },
      // Two screens behind one address -- a teacher's list of what they set, a
      // family's list of what they have to do -- because telling a parent to
      // visit a different URL from their child is exactly the kind of thing
      // that gets a product ignored. That is still the design; what was wrong
      // was the audience.
      //
      // "Two screens" names two of the six roles and the entry named none, so
      // an accountant and a librarian were offered it and fell through to the
      // family screen. `homework` has no SELECT policy for either of them --
      // measured as each on the live college, **0 rows** and **0 children** --
      // so the screen greeted them as a family and had nothing to show. The
      // page now chooses by `roles.tier` rather than by two role codes, and
      // this list says who the address is for.
      {
        title: "Homework",
        messageKey: "nav.homework",
        href: "/homework",
        icon: NotebookPen,
        roles: ["admin", "teacher", "parent", "student"],
      },
      // Homework's audience, for homework's reason: the subject teacher
      // schedules, the class and its families join, the administrator does
      // either. `live_classes` carries homework's policies row for row, so an
      // accountant or a librarian would find an empty list here -- which is why
      // neither is offered it.
      {
        title: "Live classes",
        messageKey: "nav.liveClasses",
        href: "/live-classes",
        icon: Video,
        roles: ["admin", "teacher", "parent", "student"],
      },
      // Mirrors `/live-classes`: the teacher sets a test, the class sits it, a
      // guardian sees the mark. Not an accountant or a librarian -- neither is a
      // candidate for `onlinetests.*`, and the tests' policies give them no row.
      {
        title: "Online tests",
        messageKey: "nav.onlineTests",
        href: "/online-tests",
        icon: FileQuestion,
        roles: ["admin", "teacher", "parent", "student"],
      },
      // Class tests (0304): the subject teacher sets and marks them, the family
      // reads their own child's marks. Not an accountant or a librarian --
      // neither is a candidate for exams.grade, and the policies give them no row.
      {
        title: "Class tests",
        messageKey: "nav.classTests",
        href: "/class-tests",
        icon: ClipboardCheck,
        roles: ["admin", "teacher", "parent", "student"],
      },
      // Staff only. The page reads nothing -- it turns a code into an address
      // and the record page decides -- but a family has no card to scan, and a
      // student or guardian scanning their own would only arrive where the menu
      // already takes them.
      {
        title: "Scan a card",
        messageKey: "nav.scanCard",
        href: "/scan",
        icon: ScanLine,
        roles: ["admin", "teacher", "accountant", "librarian"],
      },
      {
        title: "Study material",
        messageKey: "nav.studyMaterial",
        href: "/study-material",
        icon: FolderOpen,
      },
      // Study material placed in a chapter of a class's syllabus (0347). Who
      // writes one is the study-material policy (administrator, teacher); a
      // family reads their own class's published ones. An accountant or a
      // librarian has no class and would see an empty page.
      // The reference's SM Tickets (0348): something to be done about a
      // student. Every seat has a use for it -- the administrator manages,
      // staff work the tickets assigned to them, a family raises and follows
      // their child's -- and the policies decide which rows each reads.
      {
        title: "Tickets",
        messageKey: "nav.tickets",
        href: "/tickets",
        icon: TicketIcon,
        roles: ["admin", "teacher", "accountant", "librarian", "parent", "student"],
      },
      // The reference's SM Chat (0350): a teacher or the office starts a
      // conversation with students they may reach, a family messages their
      // child's teachers. An accountant or a librarian teaches nobody and is
      // reached by nobody, so the page would only ever be empty for them.
      {
        title: "Chat",
        messageKey: "nav.chat",
        href: "/chat",
        icon: MessagesSquare,
        roles: ["admin", "teacher", "parent", "student"],
      },
      // The reference's SM Activities (0348). Written by the administrator;
      // staff read who is on what. A family sees the fee on its account.
      {
        title: "Activities",
        messageKey: "nav.activities",
        href: "/activities",
        icon: Trophy,
        roles: ["admin", "teacher", "accountant"],
      },
      {
        title: "Lessons",
        messageKey: "nav.lessons",
        href: "/lessons",
        icon: BookMarked,
        roles: ["admin", "teacher", "parent", "student"],
      },
      // The family's own cards. Staff reach a class's cards from the exam
      // itself, because printing is something you do to a class, not to the
      // school -- so this entry is only for the people who have exactly one
      // card to look at.
      {
        title: "Report cards",
        messageKey: "nav.reportCards",
        href: "/report-card",
        icon: ScrollText,
        roles: ["parent", "student"],
      },
      // Transport sits with the academic group rather than with fees, because
      // the question people bring to it is "which bus does my child take", not
      // "what does it cost".
      //
      // This entry's comment used to claim there was no `roles` filter here --
      // "a family reaching it sees only their own arrangement, which RLS decides
      // rather than the menu" -- while the list below it said
      // ["admin", "teacher", "accountant"]. The code was right and the comment
      // was describing an intention nobody had implemented, which is worse than
      // no comment: it is the reason nobody noticed a family had no transport
      // screen at all. The fleet is staff-only; the family's own arrangement is
      // the entry underneath.
      {
        title: "Transport",
        messageKey: "nav.transport",
        href: "/transport",
        icon: Bus,
        roles: ["admin", "teacher", "accountant"],
      },
      // The family's own arrangement, which is a different question from the
      // fleet. Every transport and hostel screen is staff-only, so the seat a
      // family is billed for each month was on their phone and nowhere on the
      // web -- rule 4's "a charge with no link is a bill a family cannot check",
      // one module along. RLS already scoped the read paths to their own
      // children; what was missing was the door.
      {
        title: "Bus and boarding",
        messageKey: "nav.arrangements",
        href: "/arrangements",
        icon: Bus,
        roles: ["parent", "student"],
      },
      {
        title: "Bus assignments",
        messageKey: "nav.busAssignments",
        href: "/transport/assignments",
        setup: true,
        icon: MapPin,
        roles: ["admin"],
      },
      {
        title: "Hostel",
        messageKey: "nav.hostel",
        href: "/hostel",
        icon: BedDouble,
        roles: ["admin", "teacher", "accountant"],
      },
    ],
  },
  {
    title: "Staff",
    messageKey: "nav.staff",
    items: [
      // The roster itself, and the only surface `staff_exit` has. Gated on
      // `staff.view` inside `staff_roster` rather than here — this `roles`
      // filter is a menu, not a boundary, and the two must not disagree about
      // who may look.
      {
        title: "Staff list",
        messageKey: "nav.staffList",
        href: "/staff",
        icon: Users,
        roles: ["admin"],
      },
      // The reference's Staff Rating (0344): a student rates their own
      // teachers and the administrator reads the summary. A teacher reads no
      // ratings, their own included, so the entry is for these two seats.
      {
        title: "Staff Rating",
        messageKey: "nav.staffRatings",
        href: "/staff/ratings",
        icon: Star,
        roles: ["admin", "student"],
      },
      // Mirrors the roster entry above rather than widening it. The *gate* is
      // `staff.view`, checked inside `getStaffCards` because RLS on `staff` is
      // role-wide and narrows nothing — so if a college grants that permission
      // to somebody else, both of these lists move together or the menu starts
      // disagreeing with the boundary.
      {
        title: "Staff ID cards",
        messageKey: "idCard.staffTitle",
        href: "/staff/id-cards",
        setup: true,
        icon: IdCard,
        roles: ["admin"],
      },
      {
        title: "Staff attendance",
        messageKey: "nav.staffAttendance",
        href: "/hr",
        icon: CalendarCheck,
        roles: ["admin", "teacher", "accountant", "librarian"],
      },
      // Everybody *employed here* has leave, and hiding the screen from the
      // people who take it is how a form ends up on paper. That sentence stood
      // here with no `roles` list under it, so it also reached a parent: signed
      // in as a guardian this page renders the heading "Leave" over the words
      // "Your leave, and what is left of each kind. Only unpaid leave reaches a
      // payslip" and an empty board. The list is the sentence, written down.
      // The reader's side of the register. Administrator only, because both
      // tables' policies are -- a device secret and every punch at the gate are
      // the office's -- and `hr.manage`, the page's own gate, is administrator
      // alone in the default matrix, so the menu and the boundary agree.
      {
        title: "Attendance readers",
        messageKey: "nav.biometric",
        href: "/hr/biometric",
        setup: true,
        icon: Fingerprint,
        roles: ["admin"],
      },
      {
        title: "Leave",
        messageKey: "nav.leave",
        href: "/hr/leave",
        icon: Plane,
        roles: ["admin", "teacher", "accountant", "librarian"],
      },
      {
        title: "Salary structures",
        messageKey: "nav.salaryStructures",
        href: "/hr/salary",
        setup: true,
        icon: Sigma,
        roles: ["admin", "accountant"],
      },
      // One address, two screens, same as `/homework`: a teacher gets their own
      // payslips here and an accountant gets the runs. Both halves are about a
      // person the school pays -- so the roles list is what the second screen
      // already assumed. Without it a guardian's menu offered them "Payroll",
      // which renders "My pay -- what you were paid, month by month" to
      // somebody the school does not employ.
      {
        title: "Payroll",
        messageKey: "nav.payroll",
        href: "/payroll",
        icon: Wallet,
        roles: ["admin", "teacher", "accountant", "librarian"],
      },
    ],
  },
  {
    title: "Finance",
    messageKey: "nav.finance",
    items: [
      // The family's door into this module, and the only entry in the group a
      // family sees. Everything behind it was already readable -- a parent
      // holds `fees.view`, `fees_student_balances()` is row-scoped to their own
      // children, and `/fees/students/[id]` has always rendered read-only for
      // anybody without `fees.collect`. What was missing was the link: eight
      // fee screens, all of them `roles: ["admin", "accountant"]`, and a
      // dashboard card quoting a total with nowhere to go from it.
      {
        title: "Fees",
        messageKey: "nav.familyFees",
        href: "/fees/family",
        icon: IndianRupee,
        roles: ["student", "parent"],
      },
      {
        title: "Fee counter",
        messageKey: "nav.feeCounter",
        href: "/fees/counter",
        icon: IndianRupee,
        roles: ["admin", "accountant"],
      },
      {
        title: "Balances",
        messageKey: "nav.balances",
        href: "/fees",
        icon: BarChart3,
        roles: ["admin", "accountant"],
      },
      {
        title: "Invoices",
        messageKey: "nav.invoices",
        href: "/fees/invoices",
        icon: FileText,
        roles: ["admin", "accountant"],
      },
      {
        title: "Day book",
        messageKey: "nav.dayBook",
        href: "/fees/daybook",
        icon: BookOpenCheck,
        roles: ["admin", "accountant"],
      },
      // Sits next to fee setup because it is the other half of the same
      // configuration: the structure says what a class pays, the calendar says
      // when each of those is collected. Neither is any use alone.
      {
        title: "Billing periods",
        messageKey: "nav.billingPeriods",
        href: "/fees/instalments",
        setup: true,
        icon: CalendarRange,
        roles: ["admin", "accountant"],
      },
      // A teacher gets `concessions.view` but not the menu entry: they meet a
      // concession while looking at one child's account, not by browsing the
      // school's whole discount policy.
      {
        title: "Concessions",
        messageKey: "nav.concessions",
        href: "/fees/concessions",
        setup: true,
        icon: BadgePercent,
        roles: ["admin", "accountant"],
      },
      {
        title: "Fee setup",
        messageKey: "nav.feeSetup",
        href: "/fees/setup",
        setup: true,
        icon: Settings2,
        roles: ["admin", "accountant"],
      },
      // The general ledger. RLS restricts every accounts table to these two
      // roles anyway; the filter keeps the menu honest rather than offering a
      // page that would render empty.
      {
        title: "Accounts",
        messageKey: "nav.accounts",
        href: "/accounts",
        icon: Landmark,
        roles: ["admin", "accountant"],
      },
      {
        title: "Voucher book",
        messageKey: "nav.voucherBook",
        href: "/accounts/vouchers",
        icon: BookText,
        roles: ["admin", "accountant"],
      },
      // The reference's Expenses and Donation: vouchers on an expense or an
      // income account, read and written through the books (0321), so the
      // same two roles as the ledger.
      {
        title: "Expenses",
        messageKey: "nav.expenses",
        href: "/accounts/expenses",
        icon: Receipt,
        roles: ["admin", "accountant"],
      },
      {
        title: "Donation",
        messageKey: "nav.donations",
        href: "/accounts/donations",
        icon: HandCoins,
        roles: ["admin", "accountant"],
      },
      // The store sits in Finance rather than with the academic modules: what
      // people ask of it is "what did we spend and what is left", and the
      // librarian is in here because in most schools the store keeper and the
      // librarian are the same person.
      {
        title: "Store and stock",
        messageKey: "nav.inventory",
        href: "/inventory",
        icon: Boxes,
        roles: ["admin", "accountant", "librarian", "teacher"],
      },
    ],
  },
  {
    title: "Reports and alerts",
    messageKey: "nav.insight",
    items: [
      // No `roles` filter: `report_list` already narrows the catalog to what a
      // role may run, so a librarian sees the two reports they can run rather
      // than a menu item that leads to an empty page.
      { title: "Reports",
 messageKey: "nav.reports", href: "/reports", icon: FileSpreadsheet },
      // `checks_run()` gates every check on the matrix and names the ones it
      // withheld, which is why a *staff* role with a narrow matrix still gets
      // this entry: a page saying "your role does not see this" is more use
      // than a menu item that vanished. See migration 0188.
      //
      // A family is not that case. Measured as a guardian: one of the nine
      // checks ran -- `fees.billing`, about the school's own fee-head setup --
      // and eight were withheld, so the screen was eight refusals and one
      // finding a parent can do nothing about. Migration 0200 moves that
      // check's permission to `fees.collect` for the reason 0189 gave, and the
      // list here says who the screen is for.
      //
      // The difference between a teacher and a parent here is not the count.
      // On the demo matrix a teacher and a librarian run **0 of 9** too, and
      // they keep the entry: a school can give a teacher `students.manage` and
      // the page fills in, which is a matrix decision it may revisit any
      // Tuesday. Nobody gives a guardian `staff.manage`. Where the count is a
      // problem it is the matrix's to fix, and the page names every check it
      // withheld so it is visible there rather than here.
      {
        title: "Needs attention",
        messageKey: "nav.checks",
        href: "/checks",
        icon: ShieldAlert,
        roles: ["admin", "teacher", "accountant", "librarian"],
      },
    ],
  },
  {
    title: "Communication",
    messageKey: "nav.communication",
    items: [
      // No `roles` filter: every account has an inbox, and hiding it from
      // students and parents is exactly how a "we told you" message ends up
      // nowhere.
      { title: "Notifications",
 messageKey: "nav.notifications", href: "/notifications", icon: Bell },
      {
        title: "Compose",
        messageKey: "nav.compose",
        href: "/notifications/compose",
        icon: PenLine,
        roles: ["admin"],
      },
      {
        title: "Delivery log",
        messageKey: "nav.deliveryLog",
        href: "/notifications/log",
        setup: true,
        icon: ScrollText,
        roles: ["admin"],
      },
      {
        title: "Channels",
        messageKey: "nav.channels",
        href: "/notifications/channels",
        setup: true,
        icon: Radio,
        roles: ["admin"],
      },
      // The only screen in this group that sends without anybody pressing
      // anything, which is why an accountant may look at it and only an
      // administrator may switch one on.
      {
        title: "Automatic messages",
        messageKey: "nav.schedules",
        href: "/notifications/schedules",
        setup: true,
        icon: AlarmClock,
        roles: ["admin", "accountant"],
      },
      // No `roles` at all: the notice board is for everybody, and *which*
      // notices somebody sees is the RLS policy's business rather than the
      // menu's. A nav entry that guessed at the audience would be a second
      // answer to a question Postgres already answers.
      {
        title: "Notice board",
        messageKey: "nav.notices",
        href: "/notices",
        icon: ClipboardList,
      },
      // No `roles`, for the notice board's reason: school_calendar() is an
      // invoker over holidays, exams, fee due dates and notices, so each seat
      // sees the dates its own policies allow (0297).
      {
        title: "School calendar",
        messageKey: "nav.calendar",
        href: "/calendar",
        icon: CalendarDays,
      },
      // The reference's Events (0343). Every seat: the office runs them, and a
      // family puts its own child on one through event_join.
      {
        title: "Events",
        messageKey: "nav.events",
        href: "/events",
        icon: PartyPopper,
      },
    ],
  },
  {
    title: "Library",
    messageKey: "nav.library",
    items: [
      { title: "Catalog",
 messageKey: "nav.catalog", href: "/library/books", icon: BookOpen },
      {
        title: "Members",
        messageKey: "nav.members",
        href: "/library/members",
        icon: Users,
        roles: ["admin", "librarian", "teacher", "accountant"],
      },
      {
        title: "Issues & returns",
        messageKey: "nav.issuesReturns",
        href: "/library/issues",
        icon: ListChecks,
        roles: ["admin", "librarian", "teacher", "accountant"],
      },
    ],
  },
  {
    // No `roles` filter anywhere in this group: which language the application
    // speaks to somebody is theirs to choose, whatever they are here to do.
    title: "Settings",
    messageKey: "nav.settings",
    items: [
      // Not every role, though `settings` is readable by every tenant member
      // and the page renders read-only without `settings.manage`. These are the
      // three who act on a setting's consequences -- a librarian wants to know
      // the fine rate, an accountant whether online payments are on. A parent
      // has no question this screen answers.
      {
        title: "School settings",
        messageKey: "nav.schoolSettings",
        href: "/settings/school",
        setup: true,
        icon: Settings2,
        roles: ["admin", "accountant", "librarian"],
      },
      // Who may sign in to this school. Admin only, and that is not a menu
      // decision -- `invitations` has carried an admin-only policy since
      // migration 0005, so the two agree rather than the menu guessing.
      {
        title: "People and invitations",
        messageKey: "nav.team",
        href: "/settings/team",
        setup: true,
        icon: UserPlus,
        roles: ["admin"],
      },
      // The plan is readable by every member of the school by policy, but the
      // people who act on a ceiling are the ones who admit children and hire
      // staff. A teacher is a candidate for neither.
      {
        title: "Plan",
        messageKey: "nav.plan",
        href: "/settings/plan",
        setup: true,
        icon: CreditCard,
        roles: ["admin", "accountant"],
      },
      // What each role may do. `admin` only for the same reason as the two
      // above: `role_permissions` carries an admins-only write policy, so the
      // menu and the boundary agree rather than the menu guessing. Every member
      // *can* read the matrix -- `hasPermission()` has always needed that -- but
      // a screen of sixty-four checkboxes nobody may tick is not a screen.
      {
        title: "Roles and permissions",
        messageKey: "nav.permissions",
        href: "/settings/permissions",
        setup: true,
        icon: KeyRound,
        roles: ["admin"],
      },
      // Background work. **Every staff role**, and the roles list is derived
      // from the queue rather than guessed: `jobs` is row-scoped by policy —
      // an administrator sees the college's, everybody else sees the ones they
      // started — so anybody who can *start* one must be able to see that it
      // stopped. Today that is `accounts.manage` (an accountant) and
      // `users.manage` (an administrator), and a librarian or teacher granted
      // either on a Tuesday finds the page already working. A family starts
      // nothing, so the list stops at staff.
      {
        title: "Background tasks",
        messageKey: "nav.jobs",
        href: "/settings/jobs",
        setup: true,
        icon: Hourglass,
        roles: ["admin", "accountant", "teacher", "librarian"],
      },
      { title: "Language", messageKey: "app.language", href: "/settings/language", icon: Languages },
      // How the app looks to the person reading it -- a palette and light or
      // dark, in their own cookie -- so every seat has it, like Language.
      { title: "Appearance", messageKey: "settings.appearance.nav", href: "/settings/appearance", icon: Palette },
    ],
  },
];

/**
 * The modules a school can leave out of its menu (`modules.menu`, 0326), and
 * the addresses each one owns. Presentation only: a switched-off module's
 * pages still check their own permissions, as the reference's "Menu show"
 * switches do.
 */
export const MODULE_PREFIXES: Record<string, readonly string[]> = {
  library: ["/library"],
  transport: ["/transport", "/arrangements"],
  hostel: ["/hostel"],
  inventory: ["/inventory"],
  exams: ["/exams", "/online-tests", "/class-tests", "/report-card"],
  accounts: ["/accounts"],
  payroll: ["/payroll", "/hr/salary"],
  certificates: ["/certificates"],
  homework: ["/homework"],
  live_classes: ["/live-classes"],
};

function hiddenByModule(href: string, hidden: readonly string[]): boolean {
  const path = href.split("?")[0];
  return hidden.some((m) =>
    (MODULE_PREFIXES[m] ?? []).some((p) => path === p || path.startsWith(`${p}/`)),
  );
}

export function navForRole(roleCode: string, hiddenModules: readonly string[] = []): NavGroup[] {
  // The filter decides what a role may be offered; the reference grouping only
  // rearranges what survived it (see reference-navigation.ts). A school's own
  // menu switches then leave out whole modules, which can only take away.
  return referenceNavigation(
    NAV_GROUPS.map((group) => ({
      ...group,
      items: group.items.filter(
        (item) => (!item.roles || item.roles.includes(roleCode)) && !hiddenByModule(item.href, hiddenModules),
      ),
    })).filter((group) => group.items.length > 0),
  );
}

/**
 * One role's tree, split into what is used every day and what is set up once.
 * Takes the already-filtered tree -- `navForRole` stays the only filter (its
 * two call sites are guarded) -- and moves nothing between roles.
 */
/**
 * The order a college sets itself up in, which is the order the Setup section
 * reads (the eSkooly comparison: its menu runs General settings, Classes,
 * Subjects, Students, Employees, Fees...). The college first, then the year and
 * its classes, then what they pay, then the people, then the rest. An entry not
 * listed here keeps its place after the listed ones, so adding a setup screen
 * cannot make one disappear -- only land at the end until somebody places it.
 */
export const SETUP_ORDER: readonly string[] = [
  "/settings/school",
  "/academics/sessions",
  "/academics",
  "/academics/electives",
  "/fees/setup",
  "/fees/instalments",
  "/fees/concessions",
  "/hr/salary",
  "/students/import",
  // Before the team: a provider is what delivers the invitations (0310).
  "/notifications/channels",
  "/settings/team",
  "/settings/permissions",
  "/transport/assignments",
  "/students/id-cards",
  "/staff/id-cards",
  "/promotion",
  "/notifications/schedules",
  "/notifications/log",
  "/hr/biometric",
  "/settings/plan",
];

export function splitSetup(groups: NavGroup[]): { daily: NavGroup[]; setup: NavItem[] } {
  const daily = groups
    .map((group) => ({ ...group, items: group.items.filter((item) => !item.setup) }))
    .filter((group) => group.items.length > 0);
  const rank = (href: string) => {
    const i = SETUP_ORDER.indexOf(href);
    return i === -1 ? SETUP_ORDER.length : i;
  };
  // A stable sort: unlisted entries keep the menu's own order among themselves.
  const setup = groups
    .flatMap((group) => group.items.filter((item) => item.setup))
    .map((item, i) => ({ item, i }))
    .sort((a, b) => rank(a.item.href) - rank(b.item.href) || a.i - b.i)
    .map(({ item }) => item);
  return { daily, setup };
}
