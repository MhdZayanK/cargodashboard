import { jsPDF } from "jspdf";
import type { DashboardData } from "../api/dashboard/types";

export type ExportOptions = {
  data: DashboardData;
  filters: Record<string, string>;
  date: string;
  periodLabel: string;
  generatedBy?: string;
  /** Element that contains the four chart panels (each marked with data-export-chart). */
  chartsRoot: HTMLElement | null;
};

type RGB = [number, number, number];

const RED: RGB = [185, 28, 28];
const DARK: RGB = [17, 24, 39];
const GRAY: RGB = [107, 114, 128];
const LIGHT: RGB = [229, 231, 235];
const PANEL: RGB = [243, 244, 246];
const GREEN: RGB = [22, 163, 74];

const PAGE_W = 210;
const PAGE_H = 297;
const MARGIN = 14;
const CONTENT_W = PAGE_W - MARGIN * 2;

// jsPDF's built-in fonts only cover basic Latin, so avoid symbols like ▲ ▼ —.
const fmtTonnes = (n: number) => `${n.toLocaleString("en-US", { maximumFractionDigits: 2 })} t`;
const fmtVariance = (v: number | null) =>
  v === null ? "N/A" : `${v >= 0 ? "+" : "-"}${Math.abs(v).toFixed(1)}%`;
const varianceColor = (v: number | null): RGB => (v === null ? DARK : v >= 0 ? GREEN : RED);

// ---------------------------------------------------------------------------
// Image helpers
// ---------------------------------------------------------------------------

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Image failed to load"));
    img.src = src;
  });
}

/** Renders a Recharts <svg> to a crisp PNG data URL. */
async function svgToPng(svg: SVGSVGElement, scale = 3) {
  const rect = svg.getBoundingClientRect();
  const width = Math.round(rect.width);
  const height = Math.round(rect.height);
  if (!width || !height) return null;

  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("width", String(width));
  clone.setAttribute("height", String(height));
  if (!clone.getAttribute("viewBox")) clone.setAttribute("viewBox", `0 0 ${width} ${height}`);
  // Text inherits its font from page CSS, which is lost once the SVG is standalone.
  clone.setAttribute("style", "font-family: Arial, Helvetica, sans-serif; background: #ffffff;");

  const xml = new XMLSerializer().serializeToString(clone);
  const img = await loadImage("data:image/svg+xml;charset=utf-8," + encodeURIComponent(xml));

  const canvas = document.createElement("canvas");
  canvas.width = width * scale;
  canvas.height = height * scale;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  return { dataUrl: canvas.toDataURL("image/png"), ratio: width / height };
}

async function loadLogo() {
  try {
    const img = await loadImage("/sats-logo.png");
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0);
    return { dataUrl: canvas.toDataURL("image/png"), ratio: img.naturalWidth / img.naturalHeight };
  } catch {
    return null; // The report still works without the logo.
  }
}

// ---------------------------------------------------------------------------
// Drawing helpers
// ---------------------------------------------------------------------------

function drawTable(
  doc: jsPDF,
  x: number,
  y: number,
  w: number,
  title: string,
  headers: [string, string],
  rows: [string, string][]
): number {
  const rowH = 5.5;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(...DARK);
  doc.text(title, x, y);
  y += 3;

  doc.setFillColor(...PANEL);
  doc.rect(x, y, w, rowH, "F");
  doc.setFontSize(7.5);
  doc.setTextColor(...GRAY);
  doc.text(headers[0], x + 2, y + 3.8);
  doc.text(headers[1], x + w - 2, y + 3.8, { align: "right" });
  y += rowH;

  doc.setFont("helvetica", "normal");
  doc.setTextColor(...DARK);
  doc.setDrawColor(...LIGHT);
  doc.setLineWidth(0.2);

  const body: [string, string][] = rows.length ? rows : [["No data", ""]];
  body.forEach(([a, b]) => {
    doc.text(a, x + 2, y + 3.8);
    doc.text(b, x + w - 2, y + 3.8, { align: "right" });
    doc.line(x, y + rowH, x + w, y + rowH);
    y += rowH;
  });

  return y + 7;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function exportDashboardPdf(opts: ExportOptions): Promise<void> {
  const { data, filters, date, periodLabel, generatedBy, chartsRoot } = opts;

  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const logo = await loadLogo();

  // ---- Header ----------------------------------------------------------
  let y = 12;
  if (logo) {
    const h = 9;
    doc.addImage(logo.dataUrl, "PNG", MARGIN, y, h * logo.ratio, h);
  }

  const stamp = new Date().toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...GRAY);
  doc.text(`Generated ${stamp}`, PAGE_W - MARGIN, y + 4, { align: "right" });
  if (generatedBy) doc.text(`By ${generatedBy}`, PAGE_W - MARGIN, y + 8.5, { align: "right" });

  y = 30;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(17);
  doc.setTextColor(...DARK);
  doc.text("Cargo Operation Dashboard", MARGIN, y);

  y += 5.5;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...GRAY);
  doc.text("Executive Performance Report - Cargo Operations - SATS KSA", MARGIN, y);

  y += 4;
  doc.setDrawColor(...RED);
  doc.setLineWidth(0.6);
  doc.line(MARGIN, y, PAGE_W - MARGIN, y);

  y += 6;
  doc.setFontSize(8);
  const filterLine = [
    `Period: ${periodLabel}${date ? " (single day)" : ""}`,
    `Station: ${filters.station}`,
    `Flow type: ${filters.flowType}`,
    `Flight type: ${filters.flightType}`,
    `Cargo category: ${filters.cargoCategory}`,
  ].join("   |   ");
  const filterLines = doc.splitTextToSize(filterLine, CONTENT_W) as string[];
  doc.text(filterLines, MARGIN, y);
  y += filterLines.length * 4 + 4;

  // ---- KPI cards -------------------------------------------------------
  const kpis: { label: string; value: string; sub: string; color: RGB }[] = [
    {
      label: "TOTAL TONNAGE",
      value: fmtTonnes(data.kpis.totalTonnage),
      sub: periodLabel,
      color: DARK,
    },
    {
      label: "MONTHLY VARIANCE",
      value: fmtVariance(data.kpis.monthlyVariance),
      sub: "vs previous month",
      color: varianceColor(data.kpis.monthlyVariance),
    },
    {
      label: "YEARLY VARIANCE",
      value: fmtVariance(data.kpis.yearlyVariance),
      sub: "vs previous year",
      color: varianceColor(data.kpis.yearlyVariance),
    },
    {
      label: "AVG DAILY TONNAGE",
      value: fmtTonnes(data.kpis.avgDailyTonnage),
      sub: "Selected period",
      color: DARK,
    },
  ];

  const gap = 4;
  const kpiW = (CONTENT_W - gap * 3) / 4;
  const kpiH = 24;
  kpis.forEach((k, i) => {
    const x = MARGIN + i * (kpiW + gap);
    doc.setDrawColor(...LIGHT);
    doc.setLineWidth(0.3);
    doc.setFillColor(255, 255, 255);
    doc.roundedRect(x, y, kpiW, kpiH, 1.5, 1.5, "FD");
    doc.setFillColor(...RED);
    doc.rect(x, y + 1, 1.2, kpiH - 2, "F");

    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.5);
    doc.setTextColor(...GRAY);
    doc.text(k.label, x + 4, y + 6);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.setTextColor(...k.color);
    doc.text(k.value, x + 4, y + 14.5);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(...GRAY);
    doc.text((doc.splitTextToSize(k.sub, kpiW - 6) as string[])[0], x + 4, y + 20);
  });
  y += kpiH + 8;

  // ---- Charts (2 x 2) --------------------------------------------------
  doc.setFillColor(...RED);
  doc.rect(MARGIN, y - 2.5, 2, 2, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(...DARK);
  doc.text("PERFORMANCE TRENDS", MARGIN + 4, y - 0.8);
  y += 4;

  const charts = [
    { key: "yoy", title: "Year-over-Year Tonnage Performance", subtitle: "Annual tonnage by financial year" },
    { key: "monthly", title: "Monthly Tonnage Trend", subtitle: "Monthly tonnage across the selected year" },
    { key: "flow", title: "Flow Type Mix %", subtitle: "Share of tonnage by flow type" },
    { key: "airlines", title: "Top 5 Airlines by Tonnage", subtitle: "Share of tonnage by airline" },
  ];

  const cardW = (CONTENT_W - gap) / 2;
  const cardH = 72;
  const imgBoxW = cardW - 6;
  const imgBoxH = 46;

  for (let i = 0; i < charts.length; i++) {
    const c = charts[i];
    const cx = MARGIN + (i % 2) * (cardW + gap);
    const cy = y + Math.floor(i / 2) * (cardH + gap);

    doc.setDrawColor(...LIGHT);
    doc.setLineWidth(0.3);
    doc.setFillColor(255, 255, 255);
    doc.roundedRect(cx, cy, cardW, cardH, 1.5, 1.5, "FD");

    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.5);
    doc.setTextColor(...DARK);
    doc.text(c.title, cx + 3, cy + 6);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(...GRAY);
    doc.text(c.subtitle, cx + 3, cy + 10.5);

    const svg = chartsRoot?.querySelector<SVGSVGElement>(
      `[data-export-chart="${c.key}"] svg.recharts-surface`
    );
    let png: Awaited<ReturnType<typeof svgToPng>> = null;
    if (svg) {
      try {
        png = await svgToPng(svg);
      } catch {
        png = null;
      }
    }

    if (png) {
      let w = imgBoxW;
      let h = w / png.ratio;
      if (h > imgBoxH) {
        h = imgBoxH;
        w = h * png.ratio;
      }
      doc.addImage(png.dataUrl, "PNG", cx + 3 + (imgBoxW - w) / 2, cy + 14 + (imgBoxH - h) / 2, w, h);
    } else {
      doc.setFontSize(8);
      doc.setTextColor(...GRAY);
      doc.text("No data for these filters", cx + cardW / 2, cy + 14 + imgBoxH / 2, { align: "center" });
    }

    // The pie legend is HTML on the page, so it is written out here.
    if (c.key === "flow" && data.flowType.length) {
      doc.setFontSize(7.5);
      doc.setTextColor(...DARK);
      const legend = data.flowType.map((f) => `${f.name} ${f.value}%`).join("    ");
      doc.text(legend, cx + cardW / 2, cy + cardH - 5, { align: "center" });
    }
  }

  // ---- Page 2: data tables ---------------------------------------------
  doc.addPage();
  let ty = 20;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(...DARK);
  doc.text("Data tables", MARGIN, ty);
  ty += 3;
  doc.setDrawColor(...RED);
  doc.setLineWidth(0.6);
  doc.line(MARGIN, ty, PAGE_W - MARGIN, ty);
  ty += 9;

  const colW = (CONTENT_W - 8) / 2;
  const leftX = MARGIN;
  const rightX = MARGIN + colW + 8;

  drawTable(
    doc,
    leftX,
    ty,
    colW,
    `Monthly tonnage (${filters.year})`,
    ["Month", "Tonnage"],
    data.monthly.map((m) => [m.month, fmtTonnes(m.tonnage)])
  );

  let ry = drawTable(
    doc,
    rightX,
    ty,
    colW,
    "Year-over-year tonnage",
    ["Year", "Tonnage"],
    data.yoy.map((r) => [r.year, fmtTonnes(r.tonnage)])
  );
  ry = drawTable(
    doc,
    rightX,
    ry,
    colW,
    "Flow type mix",
    ["Flow type", "Share"],
    data.flowType.map((f) => [f.name, `${f.value}%`])
  );
  drawTable(
    doc,
    rightX,
    ry,
    colW,
    "Top 5 airlines",
    ["Airline", "Share"],
    data.topAirlines.map((a) => [a.name, `${a.value}%`])
  );

  // ---- Footer on every page --------------------------------------------
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setDrawColor(...LIGHT);
    doc.setLineWidth(0.3);
    doc.line(MARGIN, PAGE_H - 12, PAGE_W - MARGIN, PAGE_H - 12);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(...GRAY);
    doc.text("SATS KSA - Cargo Operations", MARGIN, PAGE_H - 7.5);
    doc.text(`Page ${p} of ${pages}`, PAGE_W - MARGIN, PAGE_H - 7.5, { align: "right" });
  }

  const safePeriod = periodLabel.replace(/[^a-zA-Z0-9-]+/g, "-");
  doc.save(`SATS-Cargo-Dashboard-${safePeriod}.pdf`);
}