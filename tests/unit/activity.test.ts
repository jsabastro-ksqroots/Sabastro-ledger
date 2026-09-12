import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, disconnectDb } from "@/lib/db";
import {
  auditCsvHeader,
  auditRowToCsv,
  csvEscape,
  iterateAuditLog,
  listAuditActions,
  listAuditUsers,
  parseActivityParams,
  queryAuditLog,
} from "@/lib/activity";

const stamp = Date.now();
const PREFIX = `test.activity${stamp}.`;
let userId: string;

afterAll(async () => {
  await disconnectDb();
});

beforeAll(async () => {
  const user = await db.user.create({
    data: {
      email: `activity-${stamp}@test.local`,
      displayName: `Activity Tester ${stamp}`,
      passwordHash: "x",
      role: "VIEW_ONLY",
    },
  });
  userId = user.id;
  // Three rows on distinct calendar dates, newest first when sorted by `at`.
  await db.auditLog.create({
    data: {
      at: new Date("2001-03-10T12:00:00Z"),
      action: `${PREFIX}alpha`,
      userId,
      subjectType: "test",
      subjectLabel: `Alpha subject ${stamp}`,
      before: { a: 1 },
      after: { a: 2, b: 3 },
    },
  });
  await db.auditLog.create({
    data: {
      at: new Date("2001-03-20T12:00:00Z"),
      action: `${PREFIX}beta`,
      userId,
      subjectType: "test",
      subjectLabel: "Beta subject",
      reason: `Needle-${stamp} in the reason`,
      isLockOverride: true,
    },
  });
  await db.auditLog.create({
    data: {
      at: new Date("2001-03-30T12:00:00Z"),
      action: `${PREFIX}gamma`,
      subjectType: "test",
      subjectLabel: "Gamma subject",
    },
  });
});

describe("audit log queries", () => {
  it("filters by action prefix, newest first, and reports the total", async () => {
    const page = await queryAuditLog(db, { actionPrefix: PREFIX });
    expect(page.total).toBe(3);
    expect(page.rows.map((r) => r.action)).toEqual([
      `${PREFIX}gamma`,
      `${PREFIX}beta`,
      `${PREFIX}alpha`,
    ]);
    expect(page.rows[0]?.userName).toBeNull(); // system row
    expect(page.rows[1]?.userName).toBe(`Activity Tester ${stamp}`);
    expect(page.rows[1]?.isLockOverride).toBe(true);
  });

  it("filters by exact action, user and override flag", async () => {
    const exact = await queryAuditLog(db, { action: `${PREFIX}alpha` });
    expect(exact.total).toBe(1);
    expect(exact.rows[0]?.after).toEqual({ a: 2, b: 3 });
    const byUser = await queryAuditLog(db, { actionPrefix: PREFIX, userId });
    expect(byUser.total).toBe(2);
    const overrides = await queryAuditLog(db, { actionPrefix: PREFIX, isLockOverride: true });
    expect(overrides.rows.map((r) => r.action)).toEqual([`${PREFIX}beta`]);
  });

  it("treats from/to as inclusive calendar dates", async () => {
    const early = await queryAuditLog(db, {
      actionPrefix: PREFIX,
      from: "2001-03-01",
      to: "2001-03-15",
    });
    expect(early.rows.map((r) => r.action)).toEqual([`${PREFIX}alpha`]);
    const onTheDay = await queryAuditLog(db, {
      actionPrefix: PREFIX,
      from: "2001-03-20",
      to: "2001-03-20",
    });
    expect(onTheDay.rows.map((r) => r.action)).toEqual([`${PREFIX}beta`]);
    const openEnded = await queryAuditLog(db, { actionPrefix: PREFIX, from: "2001-03-11" });
    expect(openEnded.total).toBe(2);
  });

  it("matches free text against subject label, reason and action, case-insensitively", async () => {
    const byReason = await queryAuditLog(db, { text: `needle-${stamp}` });
    expect(byReason.rows.map((r) => r.action)).toEqual([`${PREFIX}beta`]);
    const byLabel = await queryAuditLog(db, {
      actionPrefix: PREFIX,
      text: `ALPHA SUBJECT ${stamp}`,
    });
    expect(byLabel.total).toBe(1);
    const byAction = await queryAuditLog(db, { text: `ACTIVITY${stamp}.GAMMA` });
    expect(byAction.total).toBe(1);
  });

  it("paginates with a stable total", async () => {
    const p1 = await queryAuditLog(db, { actionPrefix: PREFIX }, { page: 1, pageSize: 2 });
    const p2 = await queryAuditLog(db, { actionPrefix: PREFIX }, { page: 2, pageSize: 2 });
    const p3 = await queryAuditLog(db, { actionPrefix: PREFIX }, { page: 3, pageSize: 2 });
    expect(p1.total).toBe(3);
    expect(p2.total).toBe(3);
    expect(p1.rows).toHaveLength(2);
    expect(p2.rows).toHaveLength(1);
    expect(p3.rows).toHaveLength(0);
    expect(new Set([...p1.rows, ...p2.rows].map((r) => r.id.toString())).size).toBe(3);
    const capped = await queryAuditLog(db, { actionPrefix: PREFIX }, { pageSize: 5000 });
    expect(capped.pageSize).toBe(200);
  });

  it("lists distinct actions and the users who appear in the log", async () => {
    const actions = await listAuditActions(db);
    expect(actions).toEqual([...actions].sort());
    expect(actions).toContain(`${PREFIX}alpha`);
    expect(actions).toContain(`${PREFIX}beta`);
    expect(actions.filter((a) => a === `${PREFIX}alpha`)).toHaveLength(1);
    const users = await listAuditUsers(db);
    expect(users.some((u) => u.id === userId)).toBe(true);
  });

  it("iterates the log in batches for export, honouring the cap", async () => {
    const seen: string[] = [];
    for await (const batch of iterateAuditLog(db, { actionPrefix: PREFIX }, { batch: 2 })) {
      expect(batch.length).toBeLessThanOrEqual(2);
      seen.push(...batch.map((r) => r.action));
    }
    expect(seen).toEqual([`${PREFIX}gamma`, `${PREFIX}beta`, `${PREFIX}alpha`]);
    const capped: string[] = [];
    for await (const batch of iterateAuditLog(db, { actionPrefix: PREFIX }, { max: 2, batch: 10 }))
      capped.push(...batch.map((r) => r.action));
    expect(capped).toHaveLength(2);
  });
});

describe("filter parsing and CSV", () => {
  it("reads URL params leniently and drops nonsense", () => {
    const sp = new URLSearchParams({
      actionPrefix: "login.",
      from: "2026-01-01",
      to: "not-a-date",
      userId: "nope",
      overridesOnly: "1",
      page: "3",
      pageSize: "9999",
      text: "  ",
    });
    const parsed = parseActivityParams(sp);
    expect(parsed.filters).toEqual({
      actionPrefix: "login.",
      from: "2026-01-01",
      isLockOverride: true,
    });
    expect(parsed.page).toBe(3);
    expect(parsed.pageSize).toBe(200);
    // A reversed range is ignored rather than returning nothing.
    expect(parseActivityParams({ from: "2026-02-01", to: "2026-01-01" }).filters).toEqual({});
  });

  it("writes one CSV line per row without the JSON blobs", async () => {
    const page = await queryAuditLog(db, { action: `${PREFIX}alpha` });
    const row = page.rows[0]!;
    const line = auditRowToCsv(row);
    const header = auditCsvHeader();
    expect(header.split(",").length).toBe(line.trimEnd().split(",").length);
    expect(line).toContain(`${PREFIX}alpha`);
    expect(line).toContain(`Activity Tester ${stamp}`);
    expect(line).not.toContain('"a"'); // no JSON body
    const cells = line.trimEnd().split(",");
    const headers = header.trimEnd().split(",");
    expect(cells[headers.indexOf("before_field_count")]).toBe("1");
    expect(cells[headers.indexOf("after_field_count")]).toBe("2");
    const system = (await queryAuditLog(db, { action: `${PREFIX}gamma` })).rows[0]!;
    expect(auditRowToCsv(system).split(",")[2]).toBe("system");
  });

  it("escapes commas, quotes, newlines and formula-looking cells", () => {
    expect(csvEscape("plain")).toBe("plain");
    expect(csvEscape('a,b "c"')).toBe('"a,b ""c"""');
    expect(csvEscape("line1\nline2")).toBe('"line1\nline2"');
    expect(csvEscape("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(csvEscape(null)).toBe("");
  });
});
