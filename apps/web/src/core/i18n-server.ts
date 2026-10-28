import "server-only";

import { cookies } from "next/headers";
import type { Language } from "./i18n";

export async function getRequestLanguage(): Promise<Language> {
  return (await cookies()).get("av8_language")?.value === "en" ? "en" : "ar";
}
