import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AUTH_MODE } from "@/lib/auth/config";
import { signedIn } from "@/lib/auth/session";
import { NewPasswordForm } from "@/components/people/forms";

export const metadata: Metadata = { title: "New password" };
export const dynamic = "force-dynamic";

/** After the emailed link has signed the person in: their new password. */
export default async function NewPasswordPage() {
  if (AUTH_MODE !== "supabase") redirect("/sign-in");
  if (!(await signedIn())) redirect("/sign-in?problem=link");
  return <div className="ll-panel space-y-4 p-6">
    <h1 className="text-ink text-[18px] font-semibold">Set a new password</h1>
    <NewPasswordForm />
  </div>;
}
