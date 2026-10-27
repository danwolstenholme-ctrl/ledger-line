import "server-only";

import { cache } from "react";

import { getCurrentUser } from "@/lib/org";
import { i18nFor, type I18n } from ".";

/** The words, figures and dates of the person signed in, for a server component: `const { t, formatDate } = await getI18n()`. */
export const getI18n = cache(async (): Promise<I18n> => i18nFor((await getCurrentUser()).locale));
