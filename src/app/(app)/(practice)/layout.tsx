import { requirePracticeMember } from "@/lib/org";

/**
 * The practice's own pages: its dashboard, client files, deadlines, time,
 * fees and settings. A client company's own people are sent to their company.
 * (This is for where they land; what anyone can read is decided by row-level
 * security, whatever page they open.)
 */
export default async function PracticeLayout({ children }: { children: React.ReactNode }) {
  await requirePracticeMember();
  return children;
}
