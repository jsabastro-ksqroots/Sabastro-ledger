import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { ENTITY_COOKIE_NAME, YEAR_COOKIE_NAME } from "@/lib/auth/constants";

export interface UiScope {
  entities: { id: string; code: string; name: string }[];
  entity: { id: string; code: string; name: string } | null;
  years: { id: string; year: number; state: "OPEN" | "CLOSED" | "FILED" }[];
  year: { id: string; year: number; state: "OPEN" | "CLOSED" | "FILED" } | null;
}

/** The entity and tax year selected in the top bar (persisted in cookies). */
export async function getUiScope(): Promise<UiScope> {
  const jar = await cookies();
  const entities = await db.entity.findMany({
    where: { isActive: true },
    orderBy: { createdAt: "asc" },
    select: { id: true, code: true, name: true },
  });
  const wantedCode = jar.get(ENTITY_COOKIE_NAME)?.value;
  const entity = entities.find((e) => e.code === wantedCode) ?? entities[0] ?? null;
  const years = entity
    ? await db.taxYear.findMany({
        where: { entityId: entity.id },
        orderBy: { year: "desc" },
        select: { id: true, year: true, state: true },
      })
    : [];
  const wantedYear = Number(jar.get(YEAR_COOKIE_NAME)?.value);
  const year =
    years.find((y) => y.year === wantedYear) ??
    years.find((y) => y.state === "OPEN") ??
    years[0] ??
    null;
  return { entities, entity, years, year };
}

export const SCOPE_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/",
  maxAge: 60 * 60 * 24 * 365,
};
