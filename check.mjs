// Molnversion av skidskolebevakningen. Körs av GitHub Actions (se .github/workflows/bevakning.yml).
// Öppnar SkiStars bokningssida i Chrome, fäller ut alla grupper och letar efter rätt samlingsplats.
// Vid träff skickas en push-notis via ntfy. Avslutas med felkod om sidan inte gick att läsa,
// så att GitHub visar körningen som misslyckad.

import { chromium } from 'playwright-core';

const URL = process.env.BOOKING_URL ||
  'https://www.skistar.com/sv/boka-online/SkiSchool/?d=2027-03-15&l=3&r=5:&mb=1&agg=146&tid=1';
const PLACE = (process.env.PLACE || 'turist').toLowerCase();
const TOPIC = process.env.NTFY_TOPIC || '';
const NOTIFY = process.env.NOTIFY !== 'false';

const stamp = () => new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
const log = (msg) => console.log(`${stamp()}  ${msg}`);

async function notify(title, body, priority) {
  if (!NOTIFY) { log('Notis avstängd för den här körningen.'); return; }
  if (!TOPIC) throw new Error('Hemligheten NTFY_TOPIC saknas i repot.');
  const res = await fetch(`https://ntfy.sh/${TOPIC}`, {
    method: 'POST',
    headers: { Title: title, Priority: priority, Tags: 'skier', Click: URL },
    body,
  });
  if (!res.ok) throw new Error(`ntfy svarade ${res.status}`);
}

async function readPage() {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 2400 }, locale: 'sv-SE' });
    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    return await page.evaluate(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const main = () => document.querySelector('main');
      const re = /^\s*\d+\s+grupper\s*$/i;
      const toggles = () => [...document.querySelectorAll('main *')].filter((e) =>
        re.test(e.textContent || '') && ![...e.children].some((c) => re.test(c.textContent || '')));
      let waited = 0;
      while (waited < 30000 && toggles().length === 0) { await sleep(500); waited += 500; }
      await sleep(1500);
      const t = toggles();
      for (const e of t) { e.click(); await sleep(500); }
      await sleep(1500);
      return { courses: t.length, title: document.title, text: main() ? main().innerText : '' };
    });
  } finally {
    await browser.close();
  }
}

try {
  const page = await readPage();
  if (!/Boka skidlektion/i.test(page.text)) {
    throw new Error(`Sidan laddades inte som väntat (titel: ${page.title}).`);
  }
  const lines = page.text.split('\n').map((l) => l.trim()).filter(Boolean);

  // En gruppraden är en kort rad med samlingsplatsen, följd av en rad med tiden (t.ex. 09:00-10:30 ...).
  const groups = [];
  for (let i = 0; i < lines.length - 1; i++) {
    if (lines[i].length < 100 && /^\d{2}:\d{2}\s*-\s*\d{2}:\d{2}/.test(lines[i + 1])) {
      groups.push(`${lines[i]} | ${lines[i + 1]}`);
    }
  }
  const hits = groups.filter((g) => g.toLowerCase().includes(PLACE));

  if (hits.length > 0) {
    log(`TRÄFF (${PLACE}): ${hits.join(' ; ')}`);
    await notify('Plats finns: Turistsenteret, Trysil!', `Boka nu:\n${hits.join('\n')}`, 'urgent');
  } else {
    log(`Ingen träff på '${PLACE}'. Kurser: ${page.courses}. Grupper som finns: ${groups.join(' ; ') || '(inga)'}`);
  }
} catch (err) {
  log(`FEL: ${err.message}`);
  process.exit(1);
}
