chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

const SITE = "https://beautyworld-dubai.ae.messefrankfurt.com/";
const LIST_URL = SITE + "dubai/en/exhibitor-search.html";
const PAGE_SIZE = 90;
const MAX_RETRIES = 2;
const pageUrl = (page) => `${LIST_URL}?page=${page}&pagesize=${PAGE_SIZE}`;

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const run = async () => {
    if (msg.type === "LEADS_CAPTURED") return handleCaptured(msg, sender);
    if (msg.type === "START_AUTO") return startAuto();
    if (msg.type === "STOP_AUTO") return stopAuto("Stopped by user.");
    if (msg.type === "AUTO_STATUS") return autoStatus(sender);
    if (msg.type === "PAGE_TIMEOUT") return pageTimeout(msg, sender);
    return {};
  };
  run()
    .then((r) => sendResponse({ ok: true, ...(r || {}) }))
    .catch(async (e) => { await addLog("Error: " + e.message); sendResponse({ ok: false, error: e.message }); });
  return true;
});

async function getAuto() {
  const { auto = { running: false, page: 0, totalPages: null, done: false, retries: 0 } } = await chrome.storage.local.get("auto");
  return auto;
}
const setAuto = (auto) => chrome.storage.local.set({ auto });

async function addLog(line) {
  const { log = [] } = await chrome.storage.local.get("log");
  log.unshift(`[${new Date().toLocaleTimeString()}] ${line}`);
  await chrome.storage.local.set({ log: log.slice(0, 60) });
}

async function startAuto() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url?.startsWith(SITE)) throw new Error("Open the Beautyworld exhibitor list in the active tab first.");
  const prev = await getAuto();
  const resume = !prev.done && prev.page > 1 && prev.totalPages && prev.page <= prev.totalPages;
  const auto = { running: true, tabId: tab.id, page: resume ? prev.page : 1, totalPages: resume ? prev.totalPages : null, retries: 0, done: false };
  await setAuto(auto);
  await addLog(resume ? `Resuming from page ${auto.page}.` : `Auto-collect started (${PAGE_SIZE} per page).`);
  await chrome.tabs.update(auto.tabId, { url: pageUrl(auto.page) });
}

async function stopAuto(reason) {
  const auto = await getAuto();
  await setAuto({ ...auto, running: false });
  await addLog(reason);
}

async function autoStatus(sender) {
  const auto = await getAuto();
  return { running: auto.running && sender.tab?.id === auto.tabId, page: auto.page };
}

async function pageTimeout({ page }, sender) {
  const auto = await getAuto();
  if (!auto.running || sender.tab?.id !== auto.tabId || auto.page !== page) return { action: "none" };
  if (auto.retries < MAX_RETRIES) {
    await setAuto({ ...auto, retries: auto.retries + 1 });
    await addLog(`Page ${page}: nothing received — retry ${auto.retries + 1}.`);
    return { action: "reload", nextUrl: pageUrl(page) };
  }
  await stopAuto(`Page ${page} failed ${MAX_RETRIES + 1} times. Stopped — click Start to resume.`);
  return { action: "stop" };
}

async function handleCaptured({ leads, meta, pageUrl: fromUrl }, sender) {
  const { leads: stored = {} } = await chrome.storage.local.get("leads");
  let added = 0;
  for (const lead of leads) {
    const key = lead.exhibitorId || lead.detailUrl || lead.companyName;
    if (!key) continue;
    if (!stored[key]) added++;
    stored[key] = lead;
  }
  await chrome.storage.local.set({
    leads: stored,
    meta: { hitsTotal: meta.hitsTotal, hitsPerPage: meta.hitsPerPage, lastPage: meta.currentPage, lastUrl: fromUrl },
  });
  await addLog(`Page ${meta.currentPage ?? "?"}: ${leads.length} received, ${added} new (total ${Object.keys(stored).length})`);

  const auto = await getAuto();
  if (!auto.running || sender.tab?.id !== auto.tabId) return {};
  if (Number(meta.currentPage) !== auto.page) return {};

  const totalPages = Math.ceil((meta.hitsTotal || 0) / (meta.hitsPerPage || PAGE_SIZE)) || auto.page;
  if (auto.page >= totalPages) {
    await setAuto({ ...auto, running: false, totalPages, done: true });
    await addLog(`Done — all ${totalPages} pages collected. ${Object.keys(stored).length} companies.`);
    return { done: true };
  }
  const nextPage = auto.page + 1;
  await setAuto({ ...auto, page: nextPage, totalPages, retries: 0 });
  return { nextUrl: pageUrl(nextPage) };
}