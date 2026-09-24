import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyToken } from "@/lib/auth";

export const dynamic = "force-dynamic";

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// `weight` is stored in kg. If it is already stored in tonnes, set this to 1.
const KG_PER_TONNE = 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

// Set DEBUG_DASHBOARD=true in .env.local to see query logs in the terminal.
const DEBUG = process.env.DEBUG_DASHBOARD === "true";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getAuthUser(req: NextRequest) {
  const token = req.cookies.get("token")?.value;
  if (!token) return null;
  try {
    return verifyToken(token);
  } catch {
    return null;
  }
}

/** Returns null for empty values and for "All", so those filters are skipped. */
function cleanFilter(value: string | null): string | null {
  const trimmed = value?.trim();
  if (!trimmed || trimmed.toLowerCase() === "all") return null;
  return trimmed;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

const toTonnes = (kg: number | null | undefined) => (kg ?? 0) / KG_PER_TONNE;

const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();

/** Adds months in UTC, clamping the day (e.g. 31 Mar - 1 month = 28/29 Feb). */
function addMonthsUTC(date: Date, months: number): Date {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() + months;
  const d = date.getUTCDate();
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(d, lastDay)));
}

/** Parses "YYYY-MM-DD" into a UTC midnight Date, or null if invalid. */
function parseDay(value: string | null): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const d = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function percentChange(current: number, previous: number): number | null {
  return previous > 0 ? round2(((current - previous) / previous) * 100) : null;
}

/** Runs async work with at most `limit` running at once (protects small DB connection pools). */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

// ---------------------------------------------------------------------------
// GET /api/dashboard
// Query params: year, month, date (YYYY-MM-DD, optional), station, flowType,
// flightType, cargoCategory. Any filter that is missing or "All" is ignored.
// ---------------------------------------------------------------------------

async function handle(req: NextRequest) {
  console.log(">>> dashboard route v2 hit"); // temporary marker, remove once confirmed
  const user = getAuthUser(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);

  const station = cleanFilter(searchParams.get("station"));
  const flowType = cleanFilter(searchParams.get("flowType"));
  const flightType = cleanFilter(searchParams.get("flightType"));
  const cargoCategory = cleanFilter(searchParams.get("cargoCategory"));

  // A specific day (optional) overrides year/month.
  const day = parseDay(searchParams.get("date"));

  const parsedYear = parseInt(searchParams.get("year") ?? "", 10);
  const yearNum = day
    ? day.getUTCFullYear()
    : Number.isNaN(parsedYear)
    ? new Date().getUTCFullYear()
    : parsedYear;

  const monthParam = cleanFilter(searchParams.get("month"));
  const monthIndex = day ? day.getUTCMonth() : monthParam ? MONTH_NAMES.indexOf(monthParam) : -1;

  const baseWhere: Record<string, any> = {};
  if (station) baseWhere.station = { equals: station, mode: "insensitive" };
  if (flowType) baseWhere.flowType = { equals: flowType, mode: "insensitive" };
  if (flightType) baseWhere.flightType = { equals: flightType, mode: "insensitive" };
  if (cargoCategory) baseWhere.cargoCategory = { equals: cargoCategory, mode: "insensitive" };

  // Selected period: a single day, a month, or the whole year.
  let periodStart: Date;
  let periodEnd: Date;
  if (day) {
    periodStart = day;
    periodEnd = new Date(day.getTime() + DAY_MS);
  } else if (monthIndex >= 0) {
    periodStart = new Date(Date.UTC(yearNum, monthIndex, 1));
    periodEnd = new Date(Date.UTC(yearNum, monthIndex + 1, 1));
  } else {
    periodStart = new Date(Date.UTC(yearNum, 0, 1));
    periodEnd = new Date(Date.UTC(yearNum + 1, 0, 1));
  }

  /** The same period, shifted by N months (used for previous month / year). */
  const shiftPeriod = (months: number) => {
    const start = addMonthsUTC(periodStart, months);
    const end = day ? new Date(start.getTime() + DAY_MS) : addMonthsUTC(periodEnd, months);
    return { start, end };
  };

  // `movementDate` is the single date used for filtering/grouping
  // (Import -> ata, Export/Transit -> atd, falling back to std, then ata).
  const whereBetween = (start: Date, end: Date) => ({
    ...baseWhere,
    movementDate: { gte: start, lt: end },
  });

  const sumTonnes = async (start: Date, end: Date) => {
    const agg = await prisma.cargoRecord.aggregate({
      where: whereBetween(start, end),
      _sum: { weight: true },
    });
    return toTonnes(agg._sum.weight);
  };

  const periodWhere = whereBetween(periodStart, periodEnd);
  const prevMonth = shiftPeriod(-1);
  const prevYear = shiftPeriod(-12);
  const yoyYears = Array.from({ length: 5 }, (_, i) => yearNum - 4 + i);

  if (DEBUG) {
    console.log("DEBUG filters:", JSON.stringify(baseWhere));
    console.log("DEBUG period:", periodStart.toISOString(), "->", periodEnd.toISOString());
  }

  // Phase 1: the five main queries for the selected period.
  const [periodAgg, prevMonthTonnes, prevYearTonnes, flowGroups, airlineGroups] = await Promise.all([
    prisma.cargoRecord.aggregate({
      where: periodWhere,
      _sum: { weight: true },
      _count: { _all: true },
    }),
    // Monthly variance only makes sense when a month or a day is selected.
    monthIndex >= 0 ? sumTonnes(prevMonth.start, prevMonth.end) : Promise.resolve(null),
    sumTonnes(prevYear.start, prevYear.end),
    prisma.cargoRecord.groupBy({
      by: ["flowType"],
      where: periodWhere,
      _sum: { weight: true },
    }),
    prisma.cargoRecord.groupBy({
      by: ["carrierName"],
      where: periodWhere,
      _sum: { weight: true },
      orderBy: { _sum: { weight: "desc" } },
      take: 5,
    }),
  ]);

  // Phase 2: 5 yearly + 12 monthly sums, at most 3 at a time.
  const trendRanges: [Date, Date][] = [
    ...yoyYears.map((y): [Date, Date] => [new Date(Date.UTC(y, 0, 1)), new Date(Date.UTC(y + 1, 0, 1))]),
    ...MONTH_NAMES.map((_, m): [Date, Date] => [
      new Date(Date.UTC(yearNum, m, 1)),
      new Date(Date.UTC(yearNum, m + 1, 1)),
    ]),
  ];
  const trendTonnes = await mapLimit(trendRanges, 3, ([start, end]) => sumTonnes(start, end));
  const yoyTonnes = trendTonnes.slice(0, yoyYears.length);
  const monthlyTonnes = trendTonnes.slice(yoyYears.length);

  if (DEBUG) {
    console.log("DEBUG periodAgg:", JSON.stringify(periodAgg));
  }

  // --- KPIs ---
  const recordCount = periodAgg._count._all;
  const periodWeight = periodAgg._sum.weight ?? 0;
  const totalTonnage = toTonnes(periodWeight);

  const daysInPeriod = Math.max(1, Math.round((periodEnd.getTime() - periodStart.getTime()) / DAY_MS));
  const avgDailyTonnage = totalTonnage / daysInPeriod;

  const monthlyVariance = prevMonthTonnes === null ? null : percentChange(totalTonnage, prevMonthTonnes);
  const yearlyVariance = percentChange(totalTonnage, prevYearTonnes);

  // --- Year-over-year (last 5 years) ---
  const yoy = yoyYears.map((y, i) => ({ year: y.toString(), tonnage: round2(yoyTonnes[i]) }));

  // --- Monthly trend (selected year) ---
  const monthly = MONTH_NAMES.map((month, i) => ({ month, tonnage: round2(monthlyTonnes[i]) }));

  // --- Flow type mix (selected period) ---
  const flowTotal = flowGroups.reduce((sum, g) => sum + (g._sum.weight ?? 0), 0);
  const flowTypeBreakdown = flowGroups
    .filter((g) => g.flowType)
    .map((g) => ({
      name: titleCase(g.flowType as string), // "IMPORT" -> "Import"
      value: flowTotal > 0 ? Math.round(((g._sum.weight ?? 0) / flowTotal) * 1000) / 10 : 0,
    }));

  // --- Top 5 airlines (selected period) ---
  const topAirlines = airlineGroups
    .filter((g) => g.carrierName)
    .map((g) => ({
      name: g.carrierName as string,
      value: periodWeight > 0 ? Math.round(((g._sum.weight ?? 0) / periodWeight) * 1000) / 10 : 0,
    }));

  return NextResponse.json({
    kpis: {
      totalTonnage: round2(totalTonnage),
      monthlyVariance,
      yearlyVariance,
      avgDailyTonnage: round2(avgDailyTonnage),
    },
    yoy,
    monthly,
    flowType: flowTypeBreakdown,
    topAirlines,
    meta: {
      recordCount,
      hasData: recordCount > 0,
    },
  });
}

export async function GET(req: NextRequest) {
  try {
    return await handle(req);
  } catch (error) {
    console.error("Dashboard API error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: process.env.NODE_ENV === "production" ? "Internal server error" : message },
      { status: 500 }
    );
  }
}