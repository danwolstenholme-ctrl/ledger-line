import { LedgerlineMark } from "@/components/brand/ledgerline-mark";

/** Signing in, and joining from an invitation: before anyone is anybody, so no menu, no practice, just the task. */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <main className="flex min-h-dvh flex-col items-center px-4 py-10 sm:py-16">
    <div className="mb-8 flex items-center gap-2 text-[15px] font-semibold tracking-tight"><LedgerlineMark className="size-6" title="" />Ledgerline</div>
    <div className="w-full max-w-[420px]">{children}</div>
    <p className="text-ink-faint mt-10 text-center text-[11.5px]">Books, deadlines and client files for Cyprus accountants.</p>
  </main>;
}
