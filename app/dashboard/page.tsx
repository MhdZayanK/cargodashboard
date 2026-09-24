"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import type { DashboardData } from "../api/dashboard/types";

// Where users are sent when they sign out or their session expires.
// Change this if your login page lives somewhere else.
const LOGIN_PATH = "/login";

// Colors per flow type (keys are lowercase; lookups are case-insensitive).
const FLOW_TYPE_COLORS: Record<string, string> = {
  export: "#b91c1c",
  import: "#9ca3af",
  transit: "#4b1d1d",
};
const FLOW_TYPE_FALLBACK_COLORS = ["#b91c1c", "#9ca3af", "#4b1d1d", "#e5e7eb", "#7f1d1d"];

// ---------------------------------------------------------------------------
// Filter configuration
// ---------------------------------------------------------------------------

type FilterKey =
  | "year"
  | "month"
  | "station"
  | "flowType"
  | "flightType"
  | "cargoCategory";

const ALL = "All";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const filterOptions: Record<FilterKey, string[]> = {
  year: ["2022", "2023", "2024", "2025", "2026"],
  month: MONTHS,
  station: [ALL, "DMM", "RUH", "JED", "MED", "DXB"],
  flowType: [ALL, "Export", "Import", "Transit"],
  flightType: [ALL, "Charter", "Scheduled", "Freighter"],
  cargoCategory: [ALL, "AOG", "General", "Perishable", "Dangerous Goods", "Live Animals"],
};

const filterLabels: Record<FilterKey, string> = {
  year: "Year",
  month: "Month",
  station: "Station",
  flowType: "Flow Type",
  flightType: "Flight Type",
  cargoCategory: "Cargo Category",
};

// Filters that are only sent to the API when they are not "All".
const OPTIONAL_FILTERS = ["station", "flowType", "flightType", "cargoCategory"] as const;

const DATE_MIN = `${filterOptions.year[0]}-01-01`;
const DATE_MAX = `${filterOptions.year[filterOptions.year.length - 1]}-12-31`;

function getDefaultFilters(): Record<FilterKey, string> {
  const today = new Date();
  const currentYear = String(today.getFullYear());
  const years = filterOptions.year;
  return {
    year: years.includes(currentYear) ? currentYear : years[years.length - 1],
    month: MONTHS[today.getMonth()],
    station: ALL,
    flowType: ALL,
    flightType: ALL,
    cargoCategory: ALL,
  };
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

type KpiTone = "positive" | "negative" | "neutral";

const formatTonnes = (n: number) =>
  `${n.toLocaleString("en-US", { maximumFractionDigits: 2 })} t`;

const formatVariance = (v: number | null) => {
  if (v === null) return "—";
  const sign = v >= 0 ? "▲" : "▼";
  return `${sign} ${Math.abs(v).toFixed(1)}%`;
};

const varianceTone = (v: number | null): KpiTone =>
  v === null ? "neutral" : v >= 0 ? "positive" : "negative";

const TONE_CLASSES: Record<KpiTone, string> = {
  positive: "text-green-600",
  negative: "text-red-600",
  neutral: "text-gray-900",
};

const getInitials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("") || "U";

// ---------------------------------------------------------------------------
// Small building blocks
// ---------------------------------------------------------------------------

type CurrentUser = {
  id: string | number | null;
  name: string;
  email: string | null;
  role: string | null;
};

// Fixed control height keeps every filter card the same size regardless of
// label length or number of characters in the selected value, so the row
// stays visually aligned at every breakpoint.
const FILTER_CARD_HEIGHT = "h-[64px] sm:h-[68px]";

function FilterDropdown({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  return (
    <label
      className={`flex ${FILTER_CARD_HEIGHT} w-full flex-col justify-between rounded-lg border border-gray-200 bg-white p-2 sm:p-2.5 transition-colors hover:border-red-300 focus-within:border-red-600 focus-within:ring-2 focus-within:ring-red-100`}
    >
      <span className="truncate text-[10px] text-gray-400">{label}</span>
      <div className="relative flex items-center">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full appearance-none truncate rounded bg-red-700 py-1.5 pl-2 pr-6 text-xs font-medium text-white outline-none cursor-pointer"
        >
          {options.map((opt) => (
            <option key={opt} value={opt} className="bg-white text-gray-900">
              {opt}
            </option>
          ))}
        </select>
        <svg
          className="pointer-events-none absolute right-2 h-3 w-3 shrink-0 text-white"
          viewBox="0 0 12 12"
          fill="none"
        >
          <path
            d="M2.5 4.5L6 8L9.5 4.5"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
    </label>
  );
}

function DateField({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label
      className={`flex ${FILTER_CARD_HEIGHT} w-full flex-col justify-between rounded-lg border border-gray-200 bg-white p-2 sm:p-2.5 transition-colors hover:border-red-300 focus-within:border-red-600 focus-within:ring-2 focus-within:ring-red-100`}
    >
      <span className="text-[10px] text-gray-400">Date (optional)</span>
      <input
        type="date"
        value={value}
        min={DATE_MIN}
        max={DATE_MAX}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded bg-red-700 px-2 py-1.5 text-xs font-medium text-white outline-none cursor-pointer [color-scheme:dark]"
      />
    </label>
  );
}

function Panel({
  title,
  subtitle,
  exportKey,
  children,
}: {
  title: string;
  subtitle: string;
  /** Lets the PDF export find this chart's <svg>. */
  exportKey: string;
  children: React.ReactNode;
}) {
  return (
    <div
      data-export-chart={exportKey}
      className="min-w-0 rounded-xl border border-gray-200 bg-white p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md"
    >
      <p className="truncate text-xs font-semibold text-gray-800">{title}</p>
      <p className="mb-3 truncate text-[11px] text-gray-400">{subtitle}</p>
      {children}
    </div>
  );
}

function ChartEmpty() {
  return (
    <div className="flex h-[180px] flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-gray-200 px-3 text-center">
      <p className="text-xs font-medium text-gray-500">No data for these filters</p>
      <p className="text-[11px] text-gray-400">Try choosing &ldquo;All&rdquo; or another period.</p>
    </div>
  );
}

// Profile menu: shows the signed-in user and lets them sign out.
// Click outside or press Escape to close.
function ProfileMenu({
  user,
  loading,
  signingOut,
  onSignOut,
}: {
  user: CurrentUser | null;
  loading: boolean;
  signingOut: boolean;
  onSignOut: () => void;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };

    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  const initials = user ? getInitials(user.name) : "";

  return (
    <div ref={containerRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
        className="flex items-center gap-1.5 rounded-full border border-transparent py-0.5 pl-0.5 pr-2 transition-colors hover:border-gray-200 hover:bg-gray-50"
      >
        <span
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white ${
            loading ? "animate-pulse bg-gray-300" : "bg-red-700"
          }`}
        >
          {initials}
        </span>
        <svg
          className={`h-3 w-3 shrink-0 text-gray-400 transition-transform ${
            open ? "rotate-180" : ""
          }`}
          viewBox="0 0 12 12"
          fill="none"
        >
          <path
            d="M2.5 4.5L6 8L9.5 4.5"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-40 mt-2 w-60 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg animate-in fade-in zoom-in-95 duration-100"
        >
          <div className="flex items-center gap-2.5 border-b border-gray-100 px-3 py-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-red-700 text-xs font-semibold text-white">
              {initials}
            </span>
            <div className="min-w-0">
              <p className="truncate text-xs font-semibold text-gray-900">
                {user?.name ?? "Signed in"}
              </p>
              {user?.email && (
                <p className="truncate text-[11px] text-gray-500">{user.email}</p>
              )}
              {user?.role && (
                <p className="mt-0.5 truncate text-[10px] uppercase tracking-wide text-gray-400">
                  {user.role}
                </p>
              )}
            </div>
          </div>
          <div className="py-1">
            <button
              role="menuitem"
              onClick={onSignOut}
              disabled={signingOut}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-red-700 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <svg className="h-3.5 w-3.5 shrink-0" viewBox="0 0 16 16" fill="none">
                <path
                  d="M6 2.5H3.5A1 1 0 0 0 2.5 3.5v9a1 1 0 0 0 1 1H6M10 11l3-3-3-3M13 8H6"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              {signingOut ? "Signing out…" : "Sign out"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function DashboardPage() {
  const router = useRouter();

  const [mounted, setMounted] = useState(false);
  const [filters, setFilters] = useState<Record<FilterKey, string>>(getDefaultFilters);
  // Optional single-day filter (YYYY-MM-DD). Empty = use the whole month.
  const [date, setDate] = useState("");
  const [now, setNow] = useState<Date | null>(null);

  const [user, setUser] = useState<CurrentUser | null>(null);
  const [userLoading, setUserLoading] = useState(true);
  const [signingOut, setSigningOut] = useState(false);

  const [dashboardData, setDashboardData] = useState<DashboardData | null>(null);
  const [loadingData, setLoadingData] = useState(true);
  const [dataError, setDataError] = useState<string | null>(null);

  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const chartsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMounted(true);
    setNow(new Date());
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

  // Load the signed-in user for the profile menu.
  useEffect(() => {
    let cancelled = false;

    fetch("/api/auth/me")
      .then(async (res) => {
        if (res.status === 401) {
          router.replace(LOGIN_PATH);
          return null;
        }
        if (!res.ok) throw new Error(`Request failed (${res.status})`);
        return res.json();
      })
      .then((body) => {
        if (!cancelled && body?.user) setUser(body.user as CurrentUser);
      })
      .catch(() => {
        /* The menu just falls back to a generic label. */
      })
      .finally(() => {
        if (!cancelled) setUserLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [router]);

  // Fetch live dashboard data whenever a filter (or the date) changes.
  useEffect(() => {
    const params = new URLSearchParams({
      year: filters.year,
      month: filters.month,
    });
    if (date) params.set("date", date);
    // Only send filters that are actually set. "All" means no filter.
    OPTIONAL_FILTERS.forEach((key) => {
      if (filters[key] !== ALL) params.set(key, filters[key]);
    });

    let cancelled = false;
    setLoadingData(true);
    setDataError(null);

    fetch(`/api/dashboard?${params.toString()}`)
      .then(async (res) => {
        if (res.status === 401) {
          router.replace(LOGIN_PATH);
          throw new Error("Your session has expired. Redirecting to sign in…");
        }
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `Request failed (${res.status})`);
        }
        return res.json();
      })
      .then((data: DashboardData) => {
        if (!cancelled) setDashboardData(data);
      })
      .catch((err: Error) => {
        if (!cancelled) {
          setDataError(err.message);
          setDashboardData(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingData(false);
      });

    return () => {
      cancelled = true;
    };
  }, [filters, date, router]);

  const updateFilter = (key: FilterKey, value: string) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
    // Picking a year or month means "the whole month", so drop the day filter.
    if (key === "year" || key === "month") setDate("");
  };

  // Picking a day also moves Year and Month to match it.
  const handleDateChange = (value: string) => {
    setDate(value);
    if (!value) return;
    const [y, m] = value.split("-");
    const monthName = MONTHS[parseInt(m, 10) - 1];
    if (filterOptions.year.includes(y) && monthName) {
      setFilters((prev) => ({ ...prev, year: y, month: monthName }));
    }
  };

  // Puts every filter back to its default (current month, everything else "All")
  // and clears the day filter. A new object is always set, so the data is
  // refetched even if the filters were already at their defaults.
  const resetFilters = () => {
    setFilters(getDefaultFilters());
    setDate("");
  };

  const defaults = getDefaultFilters();
  const changedFilterCount =
    (Object.keys(defaults) as FilterKey[]).filter((k) => filters[k] !== defaults[k]).length +
    (date ? 1 : 0);

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      router.replace(LOGIN_PATH);
      router.refresh();
    }
  };

  const periodLabel = date ? date : `${filters.month} ${filters.year}`;
  const stationLabel = filters.station === ALL ? "All stations" : filters.station;

  const canExport = !!dashboardData && !loadingData && !exporting;

  const handleExport = async () => {
    if (!dashboardData || exporting) return;
    setExporting(true);
    setExportError(null);
    try {
      // Loaded on demand so the PDF library isn't part of the initial page.
      const { exportDashboardPdf } = await import("../dashboard/exportPdf");
      await exportDashboardPdf({
        data: dashboardData,
        filters,
        date,
        periodLabel,
        generatedBy: user?.name,
        chartsRoot: chartsRef.current,
      });
    } catch (err) {
      console.error("PDF export failed:", err);
      setExportError(err instanceof Error ? err.message : "Couldn't create the PDF.");
    } finally {
      setExporting(false);
    }
  };

  const kpis: { label: string; value: string; sub: string; tone: KpiTone }[] = dashboardData
    ? [
        {
          label: "Total Tonnage",
          value: formatTonnes(dashboardData.kpis.totalTonnage),
          sub: `${periodLabel} · ${stationLabel}`,
          tone: "neutral",
        },
        {
          label: "Monthly Variance %",
          value: formatVariance(dashboardData.kpis.monthlyVariance),
          sub: "vs previous month",
          tone: varianceTone(dashboardData.kpis.monthlyVariance),
        },
        {
          label: "Yearly Variance %",
          value: formatVariance(dashboardData.kpis.yearlyVariance),
          sub: "vs previous year",
          tone: varianceTone(dashboardData.kpis.yearlyVariance),
        },
        {
          label: "Average Daily Tonnage",
          value: formatTonnes(dashboardData.kpis.avgDailyTonnage),
          sub: "Selected period",
          tone: "neutral",
        },
      ]
    : [];

  const yoyData = dashboardData?.yoy ?? [];
  const monthlyData = dashboardData?.monthly ?? [];
  const flowTypeData = (dashboardData?.flowType ?? []).map((f, i) => ({
    ...f,
    color:
      FLOW_TYPE_COLORS[f.name.toLowerCase()] ??
      FLOW_TYPE_FALLBACK_COLORS[i % FLOW_TYPE_FALLBACK_COLORS.length],
  }));
  const airlineData = dashboardData?.topAirlines ?? [];

  const hasYoyData = yoyData.some((d) => d.tonnage > 0);
  const hasMonthlyData = monthlyData.some((d) => d.tonnage > 0);
  const hasFlowData = flowTypeData.some((d) => d.value > 0);
  const hasAirlineData = airlineData.some((d) => d.value > 0);

  const selectedFlow = filters.flowType.toLowerCase();

  const formattedNow = now
    ? now.toLocaleString("en-GB", {
        weekday: "short",
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";

  const resetBadge =
    changedFilterCount > 0 ? (
      <span className="ml-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-red-700 px-1 text-[10px] font-semibold text-white">
        {changedFilterCount}
      </span>
    ) : null;

  return (
    <div className="min-h-screen bg-gray-100 pb-12">
      {/* Header — logo/title pinned to the start, live status + actions +
          profile pinned to the end, on every breakpoint. */}
      <div
        className={`sticky top-0 z-30 border-b-2 border-red-700 bg-white/95 backdrop-blur transition-all duration-500 ${
          mounted ? "translate-y-0 opacity-100" : "-translate-y-2 opacity-0"
        }`}
      >
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3 sm:px-6 sm:py-4">
          {/* Start */}
          <div className="flex min-w-0 items-center gap-3 sm:gap-4">
            <img
              src="/sats-logo.png"
              alt="SATS"
              className="h-7 w-auto shrink-0 sm:h-8"
            />
            <div className="min-w-0">
              <p className="truncate text-[9px] uppercase tracking-widest text-gray-400 sm:text-[10px]">
                Kingdom of Saudi Arabia · Cargo Operations
              </p>
              <h1 className="truncate text-base font-bold text-gray-900 sm:text-lg">
                Cargo Operation Dashboard
              </h1>
              <p className="truncate text-[10px] text-gray-400 sm:text-[11px]">
                Executive Performance Report · Cargo Operations · SATS KSA
              </p>
            </div>
          </div>

          {/* End */}
          <div className="flex shrink-0 items-center gap-2 sm:gap-3">
            {formattedNow && (
              <div className="mr-1 hidden flex-col items-end text-right lg:flex">
                <span className="text-xs font-medium text-gray-700">
                  {formattedNow}
                </span>
                <span className="flex items-center gap-1 text-[10px] text-green-600">
                  <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
                  Live data
                </span>
              </div>
            )}

            <button
              type="button"
              onClick={resetFilters}
              className="hidden items-center whitespace-nowrap rounded-lg border border-gray-300 px-2.5 py-2 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50 sm:inline-flex sm:px-3"
            >
              Reset filters
              {resetBadge}
            </button>

            <button
              type="button"
              onClick={handleExport}
              disabled={!canExport}
              className="hidden whitespace-nowrap rounded-lg bg-red-700 px-2.5 py-2 text-xs font-medium text-white shadow-sm transition-colors hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-50 sm:inline-block sm:px-3"
            >
              {exporting ? "Creating PDF…" : "Export report"}
            </button>

            <ProfileMenu
              user={user}
              loading={userLoading}
              signingOut={signingOut}
              onSignOut={handleSignOut}
            />
          </div>
        </div>

        {/* Compact action row for small screens, still spanning both ends */}
        <div className="flex items-center justify-between gap-2 border-t border-gray-100 px-4 py-2 sm:hidden">
          <button
            type="button"
            onClick={resetFilters}
            className="inline-flex items-center rounded-lg border border-gray-300 px-2.5 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50"
          >
            Reset filters
            {resetBadge}
          </button>
          <button
            type="button"
            onClick={handleExport}
            disabled={!canExport}
            className="rounded-lg bg-red-700 px-2.5 py-1.5 text-xs font-medium text-white shadow-sm transition-colors hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {exporting ? "Creating PDF…" : "Export report"}
          </button>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        {/* Filters */}
        <div
          className={`mt-4 grid grid-cols-2 gap-2.5 transition-all duration-500 delay-100 sm:mt-6 sm:grid-cols-3 sm:gap-3 md:grid-cols-4 xl:grid-cols-7 ${
            mounted ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0"
          }`}
        >
          <FilterDropdown
            label={filterLabels.year}
            value={filters.year}
            options={filterOptions.year}
            onChange={(v) => updateFilter("year", v)}
          />
          <FilterDropdown
            label={filterLabels.month}
            value={filters.month}
            options={filterOptions.month}
            onChange={(v) => updateFilter("month", v)}
          />
          <DateField value={date} onChange={handleDateChange} />
          <FilterDropdown
            label={filterLabels.station}
            value={filters.station}
            options={filterOptions.station}
            onChange={(v) => updateFilter("station", v)}
          />
          <FilterDropdown
            label={filterLabels.flowType}
            value={filters.flowType}
            options={filterOptions.flowType}
            onChange={(v) => updateFilter("flowType", v)}
          />
          <FilterDropdown
            label={filterLabels.flightType}
            value={filters.flightType}
            options={filterOptions.flightType}
            onChange={(v) => updateFilter("flightType", v)}
          />
          <FilterDropdown
            label={filterLabels.cargoCategory}
            value={filters.cargoCategory}
            options={filterOptions.cargoCategory}
            onChange={(v) => updateFilter("cargoCategory", v)}
          />
        </div>

        {dataError && (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-xs text-red-700">
            Couldn&apos;t load dashboard data: {dataError}
          </div>
        )}

        {exportError && (
          <div className="mt-4 flex items-start justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-xs text-red-700">
            <span>Couldn&apos;t create the PDF: {exportError}</span>
            <button
              type="button"
              onClick={() => setExportError(null)}
              className="shrink-0 font-medium underline"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* KPIs */}
        <div className="mt-6">
          <div className="mb-2 flex items-center gap-2">
            <span className="h-2 w-2 rounded-sm bg-red-700" />
            <p className="text-xs font-bold uppercase tracking-wide text-gray-700">
              Executive Summary
            </p>
          </div>
          <div
            className={`grid grid-cols-1 gap-3 transition-all duration-500 delay-150 sm:grid-cols-2 sm:gap-4 xl:grid-cols-4 ${
              mounted ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0"
            } ${loadingData && dashboardData ? "opacity-60" : ""}`}
          >
            {loadingData && !dashboardData
              ? Array.from({ length: 4 }).map((_, i) => (
                  <div
                    key={i}
                    className="min-w-0 animate-pulse rounded-xl border border-gray-200 border-l-4 border-l-gray-200 bg-white p-4 shadow-sm sm:p-5"
                  >
                    <div className="h-3 w-24 rounded bg-gray-200" />
                    <div className="mt-2 h-6 w-20 rounded bg-gray-200" />
                    <div className="mt-2 h-3 w-28 rounded bg-gray-100" />
                  </div>
                ))
              : kpis.map((kpi) => (
                  <div
                    key={kpi.label}
                    className="min-w-0 rounded-xl border border-gray-200 border-l-4 border-l-red-700 bg-white p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md sm:p-5"
                  >
                    <p className="truncate text-[11px] uppercase tracking-wide text-gray-400">
                      {kpi.label}
                    </p>
                    <p
                      className={`mt-1 truncate text-xl font-bold sm:text-2xl ${TONE_CLASSES[kpi.tone]}`}
                    >
                      {kpi.value}
                    </p>
                    <p className="mt-1 truncate text-[11px] text-gray-400">{kpi.sub}</p>
                  </div>
                ))}
          </div>
        </div>

        {/* Charts */}
        <div className="mt-8">
          <div className="mb-2 flex items-center gap-2">
            <span className="h-2 w-2 rounded-sm bg-red-700" />
            <p className="text-xs font-bold uppercase tracking-wide text-gray-700">
              Performance Trends
            </p>
          </div>
          <div
            ref={chartsRef}
            className={`grid grid-cols-1 gap-3 transition-all duration-700 delay-200 sm:grid-cols-2 sm:gap-4 xl:grid-cols-4 ${
              mounted ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0"
            } ${loadingData && dashboardData ? "opacity-60" : ""}`}
          >
            <Panel
              exportKey="yoy"
              title="Year-over-Year Tonnage Performance"
              subtitle="Annual tonnage by financial year"
            >
              {hasYoyData ? (
                <ResponsiveContainer width="100%" height={180}>
                  <LineChart data={yoyData}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                    <XAxis dataKey="year" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} allowDecimals />
                    <Tooltip formatter={(value) => formatTonnes(Number(value))} />
                    <Line
                      type="monotone"
                      dataKey="tonnage"
                      stroke="#b91c1c"
                      strokeWidth={2}
                      dot={{ r: 3 }}
                      isAnimationActive={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <ChartEmpty />
              )}
            </Panel>

            <Panel
              exportKey="monthly"
              title="Monthly Tonnage Trend"
              subtitle="Monthly tonnage across the selected year"
            >
              {hasMonthlyData ? (
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={monthlyData}>
                    <XAxis dataKey="month" tick={{ fontSize: 9 }} />
                    <YAxis tick={{ fontSize: 10 }} allowDecimals />
                    <Tooltip formatter={(value) => formatTonnes(Number(value))} />
                    <Bar dataKey="tonnage" radius={[2, 2, 0, 0]} isAnimationActive={false}>
                      {monthlyData.map((entry, i) => (
                        <Cell
                          key={i}
                          fill={entry.month === filters.month ? "#b91c1c" : "#d1d5db"}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <ChartEmpty />
              )}
            </Panel>

            <Panel
              exportKey="flow"
              title="Flow Type Mix %"
              subtitle="Share of tonnage by flow type"
            >
              {hasFlowData ? (
                <>
                  <ResponsiveContainer width="100%" height={180}>
                    <PieChart>
                      <Pie
                        data={flowTypeData}
                        dataKey="value"
                        nameKey="name"
                        innerRadius={45}
                        outerRadius={70}
                        paddingAngle={2}
                        isAnimationActive={false}
                      >
                        {flowTypeData.map((entry, i) => {
                          const isSelected = entry.name.toLowerCase() === selectedFlow;
                          return (
                            <Cell
                              key={i}
                              fill={entry.color}
                              stroke={isSelected ? "#111827" : "none"}
                              strokeWidth={isSelected ? 2 : 0}
                            />
                          );
                        })}
                      </Pie>
                      <Tooltip formatter={(value) => `${value}%`} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="mt-1 flex flex-wrap justify-center gap-3">
                    {flowTypeData.map((f) => (
                      <div
                        key={f.name}
                        className={`flex items-center gap-1 text-[10px] ${
                          f.name.toLowerCase() === selectedFlow
                            ? "font-semibold text-gray-900"
                            : "text-gray-500"
                        }`}
                      >
                        <span
                          className="h-2 w-2 rounded-sm"
                          style={{ backgroundColor: f.color }}
                        />
                        {f.name} {f.value}%
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <ChartEmpty />
              )}
            </Panel>

            <Panel
              exportKey="airlines"
              title="Top 5 Airlines by Tonnage"
              subtitle="Share of tonnage by airline"
            >
              {hasAirlineData ? (
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={airlineData} layout="vertical" margin={{ left: 20 }}>
                    <XAxis
                      type="number"
                      tick={{ fontSize: 10 }}
                      tickFormatter={(v) => `${v}%`}
                    />
                    <YAxis dataKey="name" type="category" width={90} tick={{ fontSize: 9 }} />
                    <Tooltip formatter={(value) => `${value}%`} />
                    <Bar
                      dataKey="value"
                      fill="#b91c1c"
                      radius={[0, 3, 3, 0]}
                      isAnimationActive={false}
                    />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <ChartEmpty />
              )}
            </Panel>
          </div>
        </div>
      </div>
    </div>
  );
}