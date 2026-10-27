import type { ReactNode } from "react";

import { PageEnter } from "@/components/motion/motion";

/** Remade on every navigation, so each new page eases in. */
export default function Template({ children }: { children: ReactNode }) {
  return <PageEnter>{children}</PageEnter>;
}
