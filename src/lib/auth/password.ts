/** What a Ledgerline password must be: long, mainly. Client-safe. */
export function passwordProblem(password: string): string | null {
  if (password.length < 10) return "At least 10 characters.";
  if (password.length > 72) return "No more than 72 characters.";
  if (/^(.)\1+$/.test(password)) return "Not one character over and over.";
  return null;
}
