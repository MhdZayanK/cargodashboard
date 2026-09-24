// API response shape (matches app/api/dashboard/route.ts)
export type DashboardData = {
  kpis: {
    totalTonnage: number;
    monthlyVariance: number | null;
    yearlyVariance: number | null;
    avgDailyTonnage: number;
  };
  yoy: { year: string; tonnage: number }[];
  monthly: { month: string; tonnage: number }[];
  flowType: { name: string; value: number }[];
  topAirlines: { name: string; value: number }[];
  meta?: { recordCount: number; hasData: boolean };
};