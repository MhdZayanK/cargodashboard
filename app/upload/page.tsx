"use client";

import { useState } from "react";

export default function UploadPage() {
  const [file, setFile] = useState<File | null>(null);
  const [station, setStation] = useState("DMM");
  const [flowType, setFlowType] = useState("Import");
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleUpload = async () => {
    if (!file) return;
    setLoading(true);
    setStatus(null);
    const formData = new FormData();
    formData.append("file", file);
    formData.append("station", station);
    formData.append("flowType", flowType);

    try {
      const res = await fetch("/api/upload", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed");
      setStatus(`Imported ${data.recordsImported} records.`);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center px-4">
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 w-full max-w-md space-y-4">
        <h1 className="text-lg font-semibold text-gray-900">Import Cargo Data</h1>

        <div>
          <label className="block text-sm text-gray-600 mb-1">Station</label>
          <select
            value={station}
            onChange={(e) => setStation(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
          >
            {["DMM", "RUH", "JED", "MED", "DXB"].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm text-gray-600 mb-1">Flow Type</label>
          <select
            value={flowType}
            onChange={(e) => setFlowType(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
          >
            {["Import", "Export", "Transit"].map((f) => (
              <option key={f}>{f}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm text-gray-600 mb-1">Excel file</label>
          <input
            type="file"
            accept=".xlsx"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="w-full text-sm"
          />
        </div>

        <button
          onClick={handleUpload}
          disabled={!file || loading}
          className="w-full bg-red-700 hover:bg-red-800 disabled:opacity-50 text-white text-sm font-medium py-2.5 rounded-lg"
        >
          {loading ? "Uploading..." : "Upload"}
        </button>

        {status && <p className="text-sm text-gray-600">{status}</p>}
      </div>
    </div>
  );
}