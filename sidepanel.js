const $ = (id) => document.getElementById(id);

const COLUMNS = [
  ["Company Name", "companyName"],
  ["Exhibitor Page", "detailUrl"],
  ["Hall", "hall"],
  ["Booth", "booth"],
  ["Country", "country"],
  ["City", "city"],
  ["Address", "address"],
  ["Company Phone", "phone"],
  ["Company Email", "email"],
  ["Company Website", "website"],
  ["Exhibitor Description", "shortDescription"],
  ["Product Category", "productCategories"],
  ["Products / Services", "products"],
  ["Brands", "brands"],
  ["More About", "moreAboutUs"],
  ["LinkedIn", "linkedin"],
  ["Instagram", "instagram"],
  ["Facebook", "facebook"],
  ["Other Social", "otherSocial"],
  ["Sponsored Listing", "sponsoredListing"],
  ["Scraped Date", "scrapedDate"],
  ["Exhibitor ID", "exhibitorId"],
];

// ---------- display ----------
async function render() {
  const { leads = {}, meta = {}, log = [], auto = {} } = await chrome.storage.local.get(["leads", "meta", "log", "auto"]);
  $("captured").textContent = Object.keys(leads).length;
  $("total").textContent = meta.hitsTotal ?? "–";
  $("lastPage").textContent = meta.lastPage ?? "–";
  $("log").textContent = log.join("\n");
  $("autoStatus").textContent = auto.running
    ? `Auto-collect: running — page ${auto.page}${auto.totalPages ? " of " + auto.totalPages : ""}`
    : auto.done ? "Auto-collect: finished ✔" : "Auto-collect: idle";
  $("stopBtn").disabled = !auto.running;
}

chrome.storage.onChanged.addListener(render);
render();

// ---------- auto-collect ----------
$("startBtn").addEventListener("click", async () => {
  const res = await chrome.runtime.sendMessage({ type: "START_AUTO" });
  if (!res?.ok) alert(res?.error || "Could not start.");
});

$("stopBtn").addEventListener("click", () => chrome.runtime.sendMessage({ type: "STOP_AUTO" }));

// ---------- CSV ----------
function csvCell(v) {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

$("exportBtn").addEventListener("click", async () => {
  const { leads = {} } = await chrome.storage.local.get("leads");
  const rows = Object.values(leads).sort((a, b) => a.companyName.localeCompare(b.companyName));
  if (!rows.length) return alert("Nothing captured yet.");

  const lines = [COLUMNS.map(([h]) => csvCell(h)).join(",")];
  for (const r of rows) lines.push(COLUMNS.map(([, k]) => csvCell(r[k])).join(","));

  const blob = new Blob(["\uFEFF" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `shipcube-beautyworld-leads-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

// ---------- clear ----------
$("clearBtn").addEventListener("click", async () => {
  if (!confirm("Delete all captured companies?")) return;
  await chrome.storage.local.set({ leads: {}, meta: {}, log: [], auto: { running: false, page: 0, totalPages: null, done: false } });
  render();
});

// ---------- Google Sheets ----------
chrome.storage.local.get("sheetUrl").then(({ sheetUrl }) => { if (sheetUrl) $("sheetUrl").value = sheetUrl; });
$("sheetUrl").addEventListener("change", () => chrome.storage.local.set({ sheetUrl: $("sheetUrl").value.trim() }));

$("sheetBtn").addEventListener("click", async () => {
  const url = $("sheetUrl").value.trim();
  if (!url.startsWith("https://script.google.com/") || !url.endsWith("/exec")) return alert("Paste the Web app URL ending in /exec first.");
  await chrome.storage.local.set({ sheetUrl: url });

  const { leads = {} } = await chrome.storage.local.get("leads");
  const rows = Object.values(leads)
    .sort((a, b) => a.companyName.localeCompare(b.companyName))
    .map((r) => Object.fromEntries(COLUMNS.map(([h, k]) => [h, r[k] ?? ""])));
  if (!rows.length) return alert("Nothing captured yet.");

  const BATCH = 150;
  let added = 0, total = 0;
  $("sheetBtn").disabled = true;
  try {
    for (let i = 0; i < rows.length; i += BATCH) {
      $("sheetStatus").textContent = `Sending ${Math.min(i + BATCH, rows.length)} / ${rows.length}…`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ rows: rows.slice(i, i + BATCH) }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Sheet rejected the data");
      added += data.added;
      total = data.totalRows;
    }
    $("sheetStatus").textContent = `Done: ${added} new rows added. Sheet now has ${total} companies.`;
  } catch (e) {
    $("sheetStatus").textContent = "Error: " + e.message;
  } finally {
    $("sheetBtn").disabled = false;
  }
});