// Runs inside the page (browser context). Serialized + injected by scrape.js.
// Original leadsgen.md approach: click each result card -> read the side panel ->
// store the lead -> close panel -> REMOVE the card from the DOM -> next.
// Requires a wide/maximized window so the feed + side panel stay visible together
// (otherwise clicking a result navigates to the place-only page and kills the feed).
//
// startCapture(CONFIG) is non-blocking: it fills window.__mapsLeads (scrape order),
// then sets window.__MAPS_DONE so Node can poll progress and stream CSV.
function startCapture(CONFIG) {
  if (window.__MAPS_RUNNING) return;
  window.__MAPS_RUNNING = true;
  window.__MAPS_DONE = false;
  window.__STOP_MAPS_CAPTURE = false;
  window.__mapsLeads = [];
  window.__MAPS_EXIT_REASON = "";

  const leads = window.__mapsLeads;
  const seen = new Set(); // card-level dedup (place id / name segment)
  const seenContent = new Set(); // content-level dedup (name+phone+address)
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const clean = (v) =>
    String(v || "")
      .replace(/[\uE000-\uF8FF\uFE00-\uFE0F]/g, "") // strip Google icon-font glyphs
      .replace(/\s+/g, " ")
      .trim();

  const getFeed = () => document.querySelector('div[role="feed"]');
  const getPanel = () => document.querySelector('div[role="main"][aria-label]');

  function getCards() {
    const feed = getFeed();
    if (!feed) return [];
    return [...feed.querySelectorAll('div[role="article"]')].filter((card) =>
      card.querySelector('a[href*="/maps/place/"]')
    );
  }

  const getClickable = (card) => card.querySelector('a[href*="/maps/place/"]');

  function getCardKey(card) {
    const link = getClickable(card);
    const href = link?.href || "";
    const id = href.match(/!1s([^!]+)/)?.[1];
    if (id) return "id:" + id;
    const nameSeg = href.match(/\/maps\/place\/([^/]+)/)?.[1];
    return nameSeg ? "nm:" + nameSeg : href.split("?")[0] || link?.getAttribute("aria-label") || "";
  }

  async function waitForPanel(expectedName = "") {
    const started = Date.now();
    while (Date.now() - started < 6000) {
      const panel = getPanel();
      if (panel) {
        const panelName = clean(panel.getAttribute("aria-label"));
        if (
          !expectedName ||
          panelName.toLowerCase().includes(expectedName.toLowerCase().slice(0, 20))
        ) {
          return panel;
        }
        if (panelName) return panel;
      }
      await sleep(150);
    }
    return getPanel();
  }

  function getTextByDataItem(panel, id) {
    const el = panel?.querySelector(`[data-item-id="${id}"]`);
    return clean(el?.getAttribute("aria-label") || el?.innerText);
  }

  function getByAriaPrefix(panel, prefix) {
    const el = [...(panel?.querySelectorAll("[aria-label]") || [])].find((x) =>
      clean(x.getAttribute("aria-label")).startsWith(prefix)
    );
    if (!el) return "";
    return clean(el.getAttribute("aria-label")).replace(prefix, "").trim();
  }

  function captureLead() {
    const panel = getPanel();
    if (!panel) return null;

    const name = clean(panel.getAttribute("aria-label"));

    const ratingLabel =
      [...panel.querySelectorAll('[aria-label*="stars"]')]
        .map((x) => x.getAttribute("aria-label"))
        .find(Boolean) || "";
    const rating = ratingLabel.match(/([\d.]+)\s*stars/i)?.[1] || "";

    const reviewsLabel =
      [...panel.querySelectorAll('[aria-label*="reviews"], [aria-label*="review"]')]
        .map((x) => x.getAttribute("aria-label") || x.innerText)
        .find((x) => /reviews?/i.test(x || "")) || "";
    const reviews = reviewsLabel.match(/([\d,]+)\s*reviews?/i)?.[1]?.replace(/,/g, "") || "";

    const category =
      clean(panel.querySelector('button[jsaction*="category"]')?.innerText) ||
      clean(
        [...panel.querySelectorAll("button")]
          .map((b) => clean(b.innerText))
          .find((t) => t && !["Overview", "Reviews", "About"].includes(t))
      );

    const address = getByAriaPrefix(panel, "Address:") || getTextByDataItem(panel, "address");

    const websiteEl =
      panel.querySelector('a[data-item-id="authority"]') ||
      panel.querySelector('a[aria-label^="Website:"]');
    const website = websiteEl?.href || "";
    const websiteText = getByAriaPrefix(panel, "Website:") || clean(websiteEl?.innerText);

    const phoneEl =
      panel.querySelector('[data-item-id^="phone:tel:"]') ||
      [...panel.querySelectorAll("[aria-label]")].find((x) =>
        clean(x.getAttribute("aria-label")).startsWith("Phone:")
      );
    const phoneLabel = phoneEl?.getAttribute("aria-label") || "";
    const phone = phoneLabel.startsWith("Phone:")
      ? clean(phoneLabel.replace("Phone:", ""))
      : clean(phoneEl?.innerText);

    const plusCode = getByAriaPrefix(panel, "Plus code:") || getTextByDataItem(panel, "oloc");

    const hours = [...panel.querySelectorAll("table tr")]
      .map((row) => clean(row.innerText))
      .filter(Boolean)
      .join(" | ");

    const imageUrls = new Set();
    for (const img of panel.querySelectorAll("img[src]")) {
      const src = img.src;
      if (src && !src.includes("cleardot") && !src.includes("default_user") && !src.startsWith("data:")) {
        imageUrls.add(src);
      }
    }
    for (const el of panel.querySelectorAll('[style*="background-image"]')) {
      const style = el.getAttribute("style") || "";
      const match = style.match(/url\(["']?(.*?)["']?\)/i);
      if (match?.[1]) {
        const url = match[1].startsWith("//") ? location.protocol + match[1] : match[1];
        if (!url.includes("default_user")) imageUrls.add(url);
      }
    }

    return {
      name,
      category,
      rating,
      reviews,
      website,
      websiteText,
      phone,
      address,
      plusCode,
      hours,
      imageUrls: [...imageUrls].join(" | "),
      mapsUrl: location.href,
    };
  }

  function safeClosePanel() {
    const panel = getPanel();
    const closeBtn = panel?.querySelector('button[aria-label="Close"]');
    if (closeBtn) {
      closeBtn.click();
      return true;
    }
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", code: "Escape", keyCode: 27, which: 27, bubbles: true })
    );
    return false;
  }

  function removeCard(card) {
    const wrapper = card.parentElement;
    if (wrapper && wrapper.children.length === 1) wrapper.remove();
    else card.remove();
  }

  async function clickAndCapture(card) {
    const link = getClickable(card);
    if (!link) return false;

    const key = getCardKey(card);
    const expectedName = clean(link.getAttribute("aria-label"));

    if (!key || seen.has(key)) {
      removeCard(card);
      return false;
    }
    seen.add(key);

    card.scrollIntoView({ block: "center", behavior: "instant" });
    await sleep(80);
    link.click();

    const panel = await waitForPanel(expectedName);
    await sleep(CONFIG.clickDelay);

    if (!panel) {
      removeCard(card);
      return false;
    }

    const lead = captureLead();
    if (lead && lead.name) {
      const contentKey = `${lead.name}|${lead.phone}|${lead.address}`.toLowerCase();
      if (!seenContent.has(contentKey)) {
        seenContent.add(contentKey);
        leads.push(lead);
        console.log(`Captured #${leads.length}: ${lead.name}`);
      }
    }

    safeClosePanel();
    await sleep(CONFIG.closeDelay);
    if (card.isConnected) removeCard(card);
    return true;
  }

  async function scrollFeed() {
    const feed = getFeed();
    if (!feed) return false;
    feed.scrollBy({ top: CONFIG.scrollAmount, behavior: "instant" });
    await sleep(CONFIG.scrollDelay);
    return true;
  }

  (async () => {
    let exitReason = "unknown";
    let noCardRounds = 0;
    while (!window.__STOP_MAPS_CAPTURE && noCardRounds < CONFIG.maxNoCardRounds) {
      if (CONFIG.maxLeads && leads.length >= CONFIG.maxLeads) {
        exitReason = "max leads reached";
        break;
      }

      const cards = getCards();
      if (!cards.length) {
        noCardRounds++;
        await scrollFeed();
        continue;
      }
      noCardRounds = 0;

      await clickAndCapture(cards[0]);

      // Cheap end-of-list check: textContent (no layout reflow) scoped to the feed,
      // which stays small because we remove processed cards. Avoids the progressive
      // slowdown of document.body.innerText (full-page reflow every iteration).
      const feedEl = getFeed();
      if (feedEl && feedEl.textContent.includes("You've reached the end of the list")) {
        exitReason = "reached end of list";
        break;
      }
      if (getCards().length <= 2) await scrollFeed();
    }
    if (noCardRounds >= CONFIG.maxNoCardRounds) exitReason = "no more cards after scrolling";
    if (window.__STOP_MAPS_CAPTURE) exitReason = "stopped by user";

    window.__MAPS_EXIT_REASON = exitReason;
    window.__MAPS_DONE = true;
    window.__MAPS_RUNNING = false;
    console.log(`Done. Captured ${leads.length} leads. (${exitReason})`);
  })();
}

module.exports = { startCapture };
