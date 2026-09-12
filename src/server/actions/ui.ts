"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { ENTITY_COOKIE_NAME, YEAR_COOKIE_NAME } from "@/lib/auth/constants";
import { SCOPE_COOKIE_OPTIONS } from "@/lib/ui-scope";
import { requireUser } from "@/lib/auth/current-user";

export async function selectEntityAction(code: string): Promise<void> {
  await requireUser();
  const jar = await cookies();
  jar.set(ENTITY_COOKIE_NAME, code.slice(0, 20), SCOPE_COOKIE_OPTIONS);
  jar.delete(YEAR_COOKIE_NAME);
  revalidatePath("/", "layout");
}

export async function selectYearAction(year: number): Promise<void> {
  await requireUser();
  const jar = await cookies();
  jar.set(YEAR_COOKIE_NAME, String(Math.trunc(year)), SCOPE_COOKIE_OPTIONS);
  revalidatePath("/", "layout");
}
