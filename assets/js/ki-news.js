// KI-News des Tages: aggregiert und filtert öffentliche RSS-Feeds nach KI-relevanten Meldungen.

const RANGE_DAYS = { "1d": 1, "3d": 3, "7d": 7 };

const GOOGLE_NEWS_TERMS = [
  '"Künstliche Intelligenz"',
  "KI-System",
  "KI-Modell",
  '"generative KI"',
  "ChatGPT",
  "OpenAI",
  "Google Gemini",
  "Anthropic Claude",
  "Microsoft Copilot",
  "DeepSeek",
  "Mistral AI",
  "Midjourney",
  "Sprachmodell",
  '"Machine Learning"',
];

// Wird nur auf allgemeine (nicht KI-spezifische) Feeds angewendet.
const AI_PATTERNS = [
  /\bKI\b/,
  /\bKI-/,
  /künstliche intelligenz/i,
  /chatgpt/i,
  /openai/i,
  /machine learning/i,
  /maschinelles lernen/i,
  /neuronale netze/i,
  /sprachmodell/i,
  /generative ki/i,
  /deepmind/i,
  /anthropic/i,
  /\bclaude\b/i,
  /gemini/i,
  /copilot/i,
  /\bllm\b/i,
  /midjourney/i,
  /mistral/i,
  /deepseek/i,
  /large language model/i,
];

const CORS_PROXIES = [
  (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  (url) => `https://corsproxy.io/?url=${encodeURIComponent(url)}`,
];

const loadingState = document.getElementById("loadingState");
const errorState = document.getElementById("errorState");
const emptyState = document.getElementById("emptyState");
const newsList = document.getElementById("newsList");
const rangeSelect = document.getElementById("rangeSelect");
const searchInput = document.getElementById("searchInput");
const refreshBtn = document.getElementById("refreshBtn");
const retryBtn = document.getElementById("retryBtn");
const lastUpdated = document.getElementById("lastUpdated");
const todayDate = document.getElementById("todayDate");

let currentItems = [];
let searchDebounce = null;

todayDate.textContent = new Date().toLocaleDateString("de-DE", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});

function buildGoogleNewsUrl(range) {
  const query = `(${GOOGLE_NEWS_TERMS.join(" OR ")}) when:${range}`;
  return `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=de&gl=DE&ceid=DE:de`;
}

function feedConfig(range) {
  return [
    { type: "google", name: "Google News", url: buildGoogleNewsUrl(range), filterKeywords: false },
    { type: "atom", name: "heise online", url: "https://www.heise.de/rss/heise-atom.xml", filterKeywords: true },
    { type: "rss", name: "Golem.de", url: "https://www.golem.de/rss.php?feed=RSS2.0", filterKeywords: true },
    { type: "rss", name: "t3n", url: "https://t3n.de/rss.xml", filterKeywords: true },
    { type: "rss", name: "netzpolitik.org", url: "https://netzpolitik.org/feed/", filterKeywords: true },
  ];
}

async function fetchViaProxies(url) {
  let lastError = null;
  for (const buildProxyUrl of CORS_PROXIES) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 12000);
      const response = await fetch(buildProxyUrl(url), { signal: controller.signal });
      clearTimeout(timeoutId);
      if (!response.ok) continue;
      const text = await response.text();
      if (text && text.length > 50) return text;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error(`Konnte Feed nicht laden: ${url}`);
}

function getText(el, tag) {
  const node = el.querySelector(tag);
  return node ? node.textContent.trim() : "";
}

function stripHtml(html) {
  const doc = new DOMParser().parseFromString(html || "", "text/html");
  return (doc.body.textContent || "").trim();
}

function isAiRelated(text) {
  return AI_PATTERNS.some((pattern) => pattern.test(text));
}

function extractGoogleItem(itemEl) {
  const rawTitle = getText(itemEl, "title");
  const link = getText(itemEl, "link");
  const pubDate = new Date(getText(itemEl, "pubDate"));
  const sourceEl = itemEl.querySelector("source");
  let source = sourceEl ? sourceEl.textContent.trim() : "Google News";
  let title = rawTitle;

  if (sourceEl && title.endsWith(` - ${source}`)) {
    title = title.slice(0, -(` - ${source}`.length)).trim();
  } else if (!sourceEl) {
    const idx = title.lastIndexOf(" - ");
    if (idx > 0) {
      source = title.slice(idx + 3).trim();
      title = title.slice(0, idx).trim();
    }
  }

  const summary = stripHtml(getText(itemEl, "description"));
  return { title, link, pubDate, source, summary };
}

function extractAtomItem(entryEl, sourceName) {
  const title = getText(entryEl, "title");
  const linkEl = entryEl.querySelector("link");
  const link = linkEl ? linkEl.getAttribute("href") || linkEl.textContent.trim() : "";
  const dateText = getText(entryEl, "updated") || getText(entryEl, "published");
  const pubDate = new Date(dateText);
  const summary = stripHtml(getText(entryEl, "summary") || getText(entryEl, "content"));
  return { title, link, pubDate, source: sourceName, summary };
}

function extractRssItem(itemEl, sourceName) {
  const title = getText(itemEl, "title");
  const link = getText(itemEl, "link");
  const pubDate = new Date(getText(itemEl, "pubDate"));
  const summary = stripHtml(getText(itemEl, "description"));
  return { title, link, pubDate, source: sourceName, summary };
}

async function loadFeed(feed, cutoffDate) {
  const xmlText = await fetchViaProxies(feed.url);
  const doc = new DOMParser().parseFromString(xmlText, "application/xml");
  if (doc.querySelector("parsererror")) {
    throw new Error(`Feed konnte nicht geparst werden: ${feed.name}`);
  }

  let items;
  if (feed.type === "google") {
    items = [...doc.querySelectorAll("item")].map(extractGoogleItem);
  } else if (feed.type === "atom") {
    items = [...doc.querySelectorAll("entry")].map((el) => extractAtomItem(el, feed.name));
  } else {
    items = [...doc.querySelectorAll("item")].map((el) => extractRssItem(el, feed.name));
  }

  items = items.filter((item) => item.title && item.link && !isNaN(item.pubDate));

  if (feed.filterKeywords) {
    items = items.filter((item) => isAiRelated(`${item.title} ${item.summary}`));
  }

  return items.filter((item) => item.pubDate >= cutoffDate);
}

function dedupe(items) {
  const seen = new Set();
  const result = [];
  for (const item of items) {
    const key = item.title
      .toLowerCase()
      .replace(/[^a-z0-9äöüß]+/g, "")
      .slice(0, 50);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function relativeTime(date) {
  const diffMin = Math.round((date - Date.now()) / 60000);
  const rtf = new Intl.RelativeTimeFormat("de", { numeric: "auto" });
  if (Math.abs(diffMin) < 60) return rtf.format(diffMin, "minute");
  const diffHour = Math.round(diffMin / 60);
  if (Math.abs(diffHour) < 24) return rtf.format(diffHour, "hour");
  const diffDay = Math.round(diffHour / 24);
  return rtf.format(diffDay, "day");
}

function truncate(str, maxLength) {
  if (!str) return "";
  return str.length > maxLength ? `${str.slice(0, maxLength).trim()}…` : str;
}

function hideAllStates() {
  loadingState.hidden = true;
  errorState.hidden = true;
  emptyState.hidden = true;
  newsList.hidden = true;
}

function showLoading() {
  hideAllStates();
  loadingState.hidden = false;
}

function showError() {
  hideAllStates();
  errorState.hidden = false;
}

function showEmpty() {
  hideAllStates();
  emptyState.hidden = false;
}

function renderList(items) {
  const query = searchInput.value.trim().toLowerCase();
  const filtered = query
    ? items.filter((item) => `${item.title} ${item.summary}`.toLowerCase().includes(query))
    : items;

  if (filtered.length === 0) {
    showEmpty();
    return;
  }

  newsList.innerHTML = "";
  filtered.forEach((item) => {
    const li = document.createElement("li");
    li.className = "news-card";

    const meta = document.createElement("div");
    meta.className = "news-card-meta";

    const sourceSpan = document.createElement("span");
    sourceSpan.className = "news-source";
    sourceSpan.textContent = item.source;

    const timeSpan = document.createElement("span");
    timeSpan.textContent = relativeTime(item.pubDate);

    meta.append(sourceSpan, timeSpan);

    const h3 = document.createElement("h3");
    const a = document.createElement("a");
    a.href = item.link;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.textContent = item.title;
    h3.appendChild(a);

    const p = document.createElement("p");
    p.textContent = truncate(item.summary, 160);

    li.append(meta, h3, p);
    newsList.appendChild(li);
  });

  hideAllStates();
  newsList.hidden = false;
}

function updateLastUpdated() {
  const now = new Date();
  lastUpdated.textContent = `Zuletzt aktualisiert: ${now.toLocaleTimeString("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
  })} Uhr`;
  lastUpdated.hidden = false;
}

async function loadNews() {
  showLoading();
  lastUpdated.hidden = true;

  const range = rangeSelect.value;
  const days = RANGE_DAYS[range];
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const feeds = feedConfig(range);

  const results = await Promise.allSettled(feeds.map((feed) => loadFeed(feed, cutoff)));

  let allItems = [];
  let anySucceeded = false;
  results.forEach((result) => {
    if (result.status === "fulfilled") {
      anySucceeded = true;
      allItems = allItems.concat(result.value);
    }
  });

  if (!anySucceeded) {
    showError();
    return;
  }

  allItems = dedupe(allItems);
  allItems.sort((a, b) => b.pubDate - a.pubDate);
  currentItems = allItems.slice(0, 30);

  if (currentItems.length === 0) {
    showEmpty();
    updateLastUpdated();
    return;
  }

  renderList(currentItems);
  updateLastUpdated();
}

refreshBtn.addEventListener("click", loadNews);
retryBtn.addEventListener("click", loadNews);
rangeSelect.addEventListener("change", loadNews);
searchInput.addEventListener("input", () => {
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(() => {
    if (currentItems.length > 0) renderList(currentItems);
  }, 250);
});

loadNews();
