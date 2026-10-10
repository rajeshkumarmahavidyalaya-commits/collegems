/**
 * Everything the public website says about the college, in one place.
 *
 * No page writes a fact of its own: a figure typed into a heading is a figure
 * that disagrees with the contact page the next time somebody edits one of
 * them (CLAUDE.md rule 5, `formatMoney` under four names). Edit here.
 *
 * **Provenance.** The college has no website of its own that could be read, so
 * these facts come from public directory listings (Careers360, CollegeBatch,
 * Collegedunia, Shiksha), which disagree in places. Where they did, the note
 * beside the value says so. Nothing below was invented to fill a page: where a
 * fact is unknown the field is `null`, and the page that would show it leaves
 * the line out rather than printing a guess. Have the principal's office read
 * this file once before the site goes live.
 *
 * Deliberately no imports: this module is read by client components (the
 * header) and must not drag anything with it.
 */

export type Programme = {
  slug: string;
  name: string;
  short: string;
  level: "Undergraduate" | "Postgraduate" | "Professional";
  /** The regulatory norm for the degree, not a figure quoted by a directory. */
  duration: string;
  summary: string;
  eligibility: string;
  selection: string;
  /** Approved intake, where a source states one. Null otherwise. */
  seats: number | null;
  approval: string | null;
};

export type Facility = {
  key: string;
  title: string;
  body: string;
};

export type Update = {
  date: string;
  title: string;
  href: string | null;
};

export const COLLEGE = {
  name: "Rajesh Kumar Mahavidyalaya",
  /** Directories spell it "Maha Vidyalaya"; the college's own records use one word. */
  city: "Jaunpur",
  state: "Uttar Pradesh",
  established: 2005,
  affiliation: "Veer Bahadur Singh Purvanchal University, Jaunpur",
  affiliationShort: "VBSPU, Jaunpur",
  approval: "NCTE",
  type: "Private, co-educational",
  campusAcres: 5,
  tagline: "A place to learn, teach and begin.",
  intro:
    "A co-educational college in Jaunpur offering undergraduate, postgraduate and teacher-education programmes, affiliated to Veer Bahadur Singh Purvanchal University.",
  address: {
    lines: ["Near Primary School", "Kohara Sultanpur"],
    city: "Jaunpur",
    state: "Uttar Pradesh",
    // Careers360 gives 222132; CollegeBatch gives 222001 (the district HQ code).
    // 222132 is the one that matches the village. Confirm on a letterhead.
    pin: "222132",
  },
  /** Listed by CollegeBatch. Landline, so the STD code stays on the display form. */
  phone: { display: "05452-261186", tel: "+915452261186" },
  email: null as string | null,
  website: null as string | null,
  /** Who runs the office, and when. Unknown: left out of the contact page. */
  officeHours: null as string | null,
} as const;

/** The public application form (migration 0268) is keyed by the tenant slug. */
export const APPLY_PATH = "/apply/rajesh-kumar-mahavidyalaya";
export const LOGIN_PATH = "/login";

export const NAV = [
  { href: "/about", label: "About" },
  { href: "/programmes", label: "Programmes" },
  { href: "/admissions", label: "Admissions" },
  { href: "/facilities", label: "Facilities" },
  { href: "/contact", label: "Contact" },
] as const;

/** Every address the site serves. The middleware and the test both read this. */
export const SITE_PATHS = ["/home", ...NAV.map((n) => n.href)] as const;

/*
 * Durations are the national norms (UGC for a degree, NCTE for the B.Ed.), since
 * the directories leave them blank; the B.Ed. is two years and the one listing
 * that says one year is out of date.
 */
export const PROGRAMMES: readonly Programme[] = [
  {
    slug: "ba",
    name: "Bachelor of Arts",
    short: "B.A.",
    level: "Undergraduate",
    duration: "3 years",
    summary: "The three-year degree most students begin with: a broad arts education and the base for postgraduate study, teaching and competitive examinations.",
    eligibility: "Intermediate (10+2) from a recognised board.",
    selection: "Merit list prepared from the 10+2 result.",
    seats: null,
    approval: null,
  },
  {
    slug: "bed",
    name: "Bachelor of Education",
    short: "B.Ed.",
    level: "Professional",
    duration: "2 years",
    summary: "Professional training for school teachers, with classroom practice and teaching internships alongside the coursework.",
    eligibility: "A bachelor's degree from a recognised university, with the minimum marks set by NCTE and the university.",
    selection: "Uttar Pradesh B.Ed. Joint Entrance Examination, then the merit list and state counselling.",
    seats: 100,
    approval: "Approved by the National Council for Teacher Education (NCTE).",
  },
  {
    slug: "ma-sociology",
    name: "Master of Arts in Sociology",
    short: "M.A. Sociology",
    level: "Postgraduate",
    duration: "2 years",
    summary: "The study of society, institutions and social change, for students heading to research, public service, social work and teaching.",
    eligibility: "A bachelor's degree from a recognised university; subject requirements as set by the university.",
    selection: "Entrance examination or merit list, as notified for the session.",
    seats: null,
    approval: null,
  },
  {
    slug: "ma-home-science",
    name: "Master of Arts in Home Science",
    short: "M.A. Home Science",
    level: "Postgraduate",
    duration: "2 years",
    summary: "Advanced study in nutrition, human development, family resource management and textiles, with practical work.",
    eligibility: "A bachelor's degree from a recognised university; subject requirements as set by the university.",
    selection: "Entrance examination or merit list, as notified for the session.",
    seats: null,
    approval: null,
  },
] as const;

export const FACILITIES: readonly Facility[] = [
  { key: "library", title: "Library", body: "A reading room and lending library for coursework, reference and competitive-exam preparation." },
  { key: "labs", title: "Laboratories", body: "Practical spaces for the programmes that need them, including home-science work." },
  { key: "it", title: "IT lab", body: "Computers and internet access for coursework, online forms and digital skills." },
  { key: "auditorium", title: "Auditorium", body: "A hall for seminars, workshops, cultural programmes and college events." },
  { key: "sports", title: "Sports", body: "Space on a five-acre campus for games, practice and physical education." },
  { key: "medical", title: "Medical support", body: "First-aid and health support on campus." },
] as const;

export const ADMISSION_STEPS = [
  { title: "Choose a programme", body: "Read the programme page for eligibility, duration and how selection works." },
  { title: "Apply", body: "Fill in the online application, or visit the college office with your documents." },
  { title: "Selection", body: "Merit list or entrance examination, depending on the programme." },
  { title: "Verification and fees", body: "Bring originals for verification, pay the fee and receive your enrolment." },
] as const;

/** The usual set; the office confirms the list for the session. */
export const DOCUMENTS = [
  "Marksheets and certificates of the last qualifying examination",
  "Transfer or migration certificate, where applicable",
  "Character certificate",
  "Category or income certificate, if claiming a reservation or concession",
  "Aadhaar card or another photo ID",
  "Recent passport-size photographs",
] as const;

export const FAQ = [
  {
    q: "When do admissions open?",
    a: "Dates change every session and are set by the university and the state. Call the college office or check this page for the current notice.",
  },
  {
    q: "What are the fees?",
    a: "Fees differ by programme and session. The office will give you the current fee structure; nothing is charged when you submit the online application.",
  },
  {
    q: "How is the B.Ed. seat allotted?",
    a: "Through the Uttar Pradesh B.Ed. Joint Entrance Examination, the merit list and state counselling. The college is approved for 100 seats.",
  },
  {
    q: "Can I apply online?",
    a: "Yes. Use the Apply now button. If the form is closed for the session, call the office and they will tell you how to apply.",
  },
  {
    q: "I am already a student. Where do I log in?",
    a: "Students, parents and staff sign in through the portal for attendance, fees, homework, results and notices.",
  },
] as const;

/**
 * Notices for the home page. Empty on purpose: a "latest news" strip of
 * invented announcements is worse than none, and the section is not drawn
 * while this is empty. Newest first.
 */
export const UPDATES: readonly Update[] = [];

export function addressOneLine() {
  const a = COLLEGE.address;
  return [...a.lines, a.city, `${a.state} ${a.pin}`].join(", ");
}

export function mapsUrl() {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${COLLEGE.name}, ${addressOneLine()}`)}`;
}

export function programmeBySlug(slug: string) {
  return PROGRAMMES.find((p) => p.slug === slug) ?? null;
}
