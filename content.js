// Receives captured pages from injected.js, converts them to lead rows, sends to background.
const DETAIL_BASE = "https://beautyworld-dubai.ae.messefrankfurt.com/dubai/en/exhibitor-search.detail.html/";

function decodeHtml(str) {
  if (!str) return "";
  const t = document.createElement("textarea");
  t.innerHTML = str;
  return t.value;
}

function mapHit(hit) {
  const ex = hit.exhibitor || {};
  const hall = ex.exhibition?.exhibitionHall?.[0] || {};
  const stand = hall.stand?.[0] || {};
  const addr = ex.address || {};
  const rdm = ex.addressrdm || {};

  const categories = (ex.categories || []).flatMap((c) =>
    c.subCategories?.length ? c.subCategories.map((s) => s.name) : [c.name]
  );

  const social = {};
  (ex.social || []).forEach((s) => {
    if (!s.url) return;
    social[s.network] = social[s.network] ? `${social[s.network]} | ${s.url}` : s.url;
  });
  const mainNets = ["linkedin", "instagram", "facebook"];
  const otherSocial = Object.entries(social)
    .filter(([net]) => !mainNets.includes(net))
    .map(([net, url]) => `${net}: ${url}`)
    .join(" | ");

  return {
    companyName: decodeHtml(ex.name).trim(),
    exhibitorId: ex.id || "",
    detailUrl: ex.rewriteId ? `${DETAIL_BASE}${ex.rewriteId}.html` : "",
    hall: hall.name || "",
    booth: stand.name || "",
    country: addr.country?.label || "",
    city: addr.city || "",
    address: [rdm.building, addr.street, [addr.zip, addr.city].filter(Boolean).join(" "), addr.country?.label]
      .filter(Boolean).join(", "),
    phone: addr.tel || "",
    email: addr.email || "",
    website: ex.homepage || ex.href || "",
    shortDescription: ex.description?.text || "",
    productCategories: categories.join("; "),
    linkedin: social.linkedin || "",
    instagram: social.instagram || "",
    facebook: social.facebook || "",
    otherSocial,
    moreAboutUs: (ex.catalogExtraText || []).join("\n"),
    products: (ex.products?.products || []).map((p) => decodeHtml(p.name).trim()).filter(Boolean).join("; "),
    brands: (ex.exhibition?.synonyme || []).map((b) => decodeHtml(b.name).trim()).filter(Boolean).join("; "),
    sponsoredListing: hit.polePosition === true ? "yes" : "",
    scrapedDate: new Date().toISOString().slice(0, 10),
  };
}

const AUTO_DELAY_MS = 3000;   // pause before moving to the next page
const AUTO_WAIT_MS = 30000;   // no data within this time → retry
const capturedPages = new Set();

window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  const data = event.data;
  if (!data || data.type !== "SHIPCUBE_EXHIBITOR_PAGE") return;

  const result = data.result || {};
  capturedPages.add(Number(result.metaData?.currentPage));

  chrome.runtime.sendMessage(
    { type: "LEADS_CAPTURED", leads: (result.hits || []).map(mapHit), meta: result.metaData || {}, pageUrl: location.href },
    (res) => {
      if (chrome.runtime.lastError || !res?.nextUrl) return;
      setTimeout(() => { location.href = res.nextUrl; }, AUTO_DELAY_MS);
    }
  );
});

// Watchdog: if auto-collect is running and this page sent nothing, ask background to retry.
chrome.runtime.sendMessage({ type: "AUTO_STATUS" }, (res) => {
  if (chrome.runtime.lastError || !res?.running) return;
  setTimeout(() => {
    if (capturedPages.has(res.page)) return;
    chrome.runtime.sendMessage({ type: "PAGE_TIMEOUT", page: res.page }, (r) => {
      if (!chrome.runtime.lastError && r?.action === "reload" && r.nextUrl) location.href = r.nextUrl;
    });
  }, AUTO_WAIT_MS);
});