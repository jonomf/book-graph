/* ===================== Adding titles: Wikipedia scan, your own text, AI analysis =====================
   Inlined into the page by src/build.js. Uses the app's globals (D, E, S, LIB, store, esc, $, scene, ...).
   Every added title has the same shape as a bundled one, so all views work unchanged. */

const canon = s => String(s == null ? '' : s)
  .replace(/[‘’‚‛′]/g, "'").replace(/[“”„‟″]/g, '"')
  .replace(/\s+/g, ' ').trim();
const slugify = s => canon(s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'item';
const htmlText = h => new DOMParser().parseFromString(String(h), 'text/html').body.textContent || '';
const escRe = t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const nameRegex = alts => new RegExp('(^|[^A-Za-zÀ-ÿ])(' + alts.slice().sort((a, b) => b.length - a.length).map(escRe).join('|') + ')(?![A-Za-zÀ-ÿ])', 'g');
function sentences(p) {
  const prot = p.replace(/\b(Mr|Mrs|Ms|Dr|St|Jr|Sr|Capt|Col|Gen|Lt|Sgt|Prof|Rev|Mt|vs|etc|No)\./g, '$1․').replace(/\b([A-Z])\./g, '$1․');
  return (prot.match(/[^.!?]+(?:[.!?]+["')\]]*|$)/g) || [prot]).map(s => s.replace(/․/g, '.').trim()).filter(Boolean);
}
const words = s => canon(s).split(' ').filter(Boolean).length;

/* ---------- Saved titles (IndexedDB, this browser only) ---------- */
const idb = (() => {
  let opening = null;
  const open = () => opening || (opening = new Promise((res, rej) => {
    try {
      const r = indexedDB.open('bookgraph', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('titles', { keyPath: 'id' });
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    } catch (e) { rej(e); }
  }));
  const run = async (mode, fn) => {
    const db = await open();
    return new Promise((res, rej) => {
      const t = db.transaction('titles', mode), req = fn(t.objectStore('titles'));
      t.oncomplete = () => res(req && 'result' in req ? req.result : undefined);
      t.onerror = () => rej(t.error); t.onabort = () => rej(t.error);
    });
  };
  return {
    all: () => run('readonly', st => st.getAll()),
    put: b => run('readwrite', st => st.put(JSON.parse(JSON.stringify(b)))),
    del: id => run('readwrite', st => st.delete(id)),
  };
})();
async function saveTitle(b) {
  b.checked = false;
  try { await idb.put(b); return true; } catch (e) { console.warn('Could not save', e); return false; }
}
function uniqueBookId(base) {
  let id = base, n = 2;
  while (LIB.books.some(b => b.id === id)) id = `${base}-${n++}`;
  return id;
}
async function addTitle(b) {
  b.id = uniqueBookId(b.id);
  LIB.books.push(b);
  const saved = await saveTitle(b);
  switchBook(b.id);
  return saved;
}
async function removeTitle(id) {
  const i = LIB.books.findIndex(b => b.id === id && b.user);
  if (i < 0) return;
  LIB.books.splice(i, 1);
  try { await idb.del(id); } catch (e) {}
  store.set('pos:' + id, null);
  if (S.book === id) { loadBook(LIB.books[0].id); renderReader(); showTab(S.tab); }
  openLibrary();
}

/* ---------- Wikipedia + Wikidata ---------- */
const WP = 'https://en.wikipedia.org/w/api.php', WD = 'https://www.wikidata.org/w/api.php';
async function mwApi(base, params, signal) {
  const u = new URL(base);
  for (const [k, v] of Object.entries({ format: 'json', formatversion: '2', origin: '*', ...params })) u.searchParams.set(k, v);
  let r;
  try { r = await fetch(u, { signal }); }
  catch (e) { if (e.name === 'AbortError') throw e; throw new Error('NETWORK'); }
  if (!r.ok) throw new Error(`Wikipedia answered with error ${r.status}.`);
  const j = await r.json();
  if (j.error) throw new Error(j.error.info || j.error.code);
  return j;
}
async function wpSearch(q, signal) {
  const j = await mwApi(WP, { action: 'query', list: 'search', srsearch: q, srlimit: '8', srprop: 'snippet', srnamespace: '0' }, signal);
  return (j.query?.search || []).map(s => ({ title: s.title, snippet: canon(htmlText(s.snippet)) }));
}
const linksOf = el => [...el.querySelectorAll('a[href]')].map(a => {
  const m = (a.getAttribute('href') || '').match(/^(?:\.\/|\/wiki\/)([^#?]+)/);
  if (!m) return null;
  const title = decodeURIComponent(m[1]).replace(/_/g, ' ');
  if (title.includes(':')) return null;
  return { text: canon(a.textContent), title };
}).filter(Boolean);
function cleanDoc(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('sup, .mw-editsection, style, script, table, figure, .thumb, .hatnote, .shortdescription, .mw-empty-elt, .reference, .noprint, .gallery, .mw-references-wrap, .navbox').forEach(n => n.remove());
  return doc;
}
// Paragraphs of a section, with sub-headings as part names and the links in each paragraph.
function parseSectionHTML(html) {
  const doc = cleanDoc(html);
  const out = []; let part = null;
  const walk = el => {
    for (const n of el.children) {
      const tag = n.tagName.toLowerCase();
      if (n.classList.contains('mw-heading')) { const h = n.querySelector('h3, h4, h5'); if (h) part = canon(h.textContent); continue; }
      if (/^h[3-5]$/.test(tag)) { part = canon(n.textContent); continue; }
      if (tag === 'h2') continue;
      if (tag === 'p') { const text = canon(n.textContent); if (text.length > 30) out.push({ part, text, links: linksOf(n) }); continue; }
      if (tag === 'ul' || tag === 'ol') {
        n.querySelectorAll(':scope > li').forEach(li => { const text = canon(li.textContent); if (text.length > 60) out.push({ part, text, links: linksOf(li) }); });
        continue;
      }
      if (tag === 'div' || tag === 'section' || tag === 'blockquote') walk(n);
    }
  };
  walk(doc.querySelector('.mw-parser-output') || doc.body);
  return out;
}
const NOT_A_NAME = /^(additionally|also|other|others|uncredited|cast|voices?|in addition|main|supporting|recurring|guest|minor|the following|various|including|see)\b/i;
const validName = n => n.length >= 2 && n.length <= 48 && /^[A-Z0-9"'À-Ý]/.test(n) && n.split(' ').length <= 6 && !NOT_A_NAME.test(n) && !/[.!?]$/.test(n);
// Character names from a "Cast" list ("Mark Hamill as Luke Skywalker") or a "Characters" list ("Elizabeth Bennet – the second daughter").
function parseCast(html, isCast) {
  const doc = cleanDoc(html), names = [];
  doc.querySelectorAll('li, dt').forEach(li => {
    const c = li.cloneNode(true);
    c.querySelectorAll('ul, ol, dl').forEach(x => x.remove());
    const t = canon(c.textContent);
    if (!t) return;
    const m = isCast && t.match(/\bas\s+(?:the\s+)?(.+?)(?=[,;:(\[]|\s[–—-]\s|$)/);
    const cand = m ? m[1] : t.split(/\s[–—-]\s|:\s|,\s|\s\(/)[0];
    cand.split(/\s*\/\s*|\s+and\s+/).forEach(n => {
      n = canon(n.replace(/^(?:a|an|the)\s+/i, '').replace(/["']/g, ''));
      if (validName(n)) names.push(n);
    });
  });
  return [...new Set(names)];
}
async function qidsForTitles(titles, signal) {
  const map = {};
  for (let i = 0; i < titles.length; i += 50) {
    const batch = titles.slice(i, i + 50);
    const j = await mwApi(WP, { action: 'query', prop: 'pageprops', ppprop: 'wikibase_item', redirects: '1', titles: batch.join('|') }, signal);
    const follow = {};
    (j.query?.normalized || []).forEach(x => { follow[x.from] = x.to; });
    (j.query?.redirects || []).forEach(x => { follow[x.from] = x.to; });
    const byTitle = {};
    (j.query?.pages || []).forEach(pg => { if (pg.pageprops?.wikibase_item) byTitle[pg.title] = pg.pageprops.wikibase_item; });
    batch.forEach(t => { let k = t, hops = 0; while (follow[k] && hops++ < 3) k = follow[k]; if (byTitle[k]) map[t] = byTitle[k]; });
  }
  return map;
}
async function wdEntities(ids, props, signal) {
  const out = {};
  for (let i = 0; i < ids.length; i += 50) {
    const j = await mwApi(WD, { action: 'wbgetentities', ids: ids.slice(i, i + 50).join('|'), props, languages: 'en' }, signal);
    Object.assign(out, j.entities || {});
  }
  return out;
}
const claimIds = (ent, p) => ((ent && ent.claims && ent.claims[p]) || []).map(c => c.mainsnak?.datavalue?.value?.id).filter(Boolean);
const wdLabel = ent => (ent && ent.labels && ent.labels.en && ent.labels.en.value) || null;
async function wikidataFor(page, paras, signal) {
  const res = { chars: [], places: [], kind: null, year: '', linkInfo: {}, family: [] };
  const linkTitles = [...new Set(paras.flatMap(p => p.links.map(l => l.title)))].slice(0, 150);
  const q = await qidsForTitles([page, ...linkTitles], signal);
  const workQ = q[page];
  if (!workQ) return res;
  const work = (await wdEntities([workQ], 'claims', signal))[workQ] || {};
  const charIds = claimIds(work, 'P674'), placeIds = claimIds(work, 'P840'), instanceIds = claimIds(work, 'P31');
  const roleIds = ((work.claims || {}).P161 || []).flatMap(c => ((c.qualifiers || {}).P453 || []).map(x => x.datavalue?.value?.id)).filter(Boolean);
  const date = ((work.claims || {}).P577 || (work.claims || {}).P571 || [])[0]?.mainsnak?.datavalue?.value?.time;
  if (date) res.year = String(parseInt(date.slice(1, 5), 10));
  const linkQ = linkTitles.map(t => q[t]).filter(Boolean);
  const ids = [...new Set([...charIds, ...placeIds, ...roleIds, ...linkQ, ...instanceIds])];
  const ents = ids.length ? await wdEntities(ids, 'labels|claims', signal) : {};
  const classIds = [...new Set(ids.flatMap(id => claimIds(ents[id], 'P31')))].filter(id => !ents[id]);
  const classes = classIds.length ? await wdEntities(classIds, 'labels', signal) : {};
  const classLabel = id => (wdLabel(ents[id]) || wdLabel(classes[id]) || '').toLowerCase();
  const typeOf = id => {
    const ls = claimIds(ents[id], 'P31').map(classLabel).join(' | ');
    if (!ls) return null;
    if (/spacecraft|starship|ship\b|vehicle|weapon|artifact|object|device/.test(ls)) return 'thing';
    if (/planet|city|town|village|country|location|place|island|building|castle|region|moon|station|world|realm|kingdom|street|settlement|mountain|river|forest|continent|land|star system/.test(ls)) return 'place';
    if (/character|human|person|deity|alien|droid|robot|creature|animal/.test(ls)) return 'person';
    if (/organi[sz]ation|group|faction|order|family|army|military|company|team|empire|government|band|gang|tribe|clan|dynasty/.test(ls)) return 'group';
    return 'thing';
  };
  const kinds = instanceIds.map(classLabel).join(' ');
  res.kind = /film/.test(kinds) ? 'film' : /television|series|episode/.test(kinds) ? 'tv' : /novel|book|story|literary|play/.test(kinds) ? 'book' : null;
  res.chars = [...charIds, ...roleIds].map(id => wdLabel(ents[id])).filter(Boolean);
  res.places = placeIds.map(id => wdLabel(ents[id])).filter(Boolean);
  linkTitles.forEach(t => { const id = q[t]; if (id && ents[id]) res.linkInfo[t] = { type: typeOf(id), label: wdLabel(ents[id]) }; });
  const fam = { P22: 'father', P25: 'mother', P26: 'spouse', P3373: 'sibling', P40: 'child' };
  ids.forEach(id => Object.entries(fam).forEach(([p, kind]) => claimIds(ents[id], p).forEach(o => {
    if (ents[o] && wdLabel(ents[id]) && wdLabel(ents[o])) res.family.push({ a: wdLabel(ents[id]), b: wdLabel(ents[o]), kind });
  })));
  return res;
}

const HONORIFIC = /^(mr|mrs|ms|miss|dr|sir|dame|lady|lord|king|queen|prince|princess|captain|capt|admiral|general|colonel|major|lieutenant|sergeant|count|countess|duke|duchess|baron|baroness|father|mother|uncle|aunt|professor|inspector|detective|master|saint|st|darth|emperor|empress|young|old|little|big)\.?$/i;
const PARTICLE = new Set(['the', 'a', 'an', 'of', 'and', 'de', 'la', 'le', 'van', 'von', 'der', 'du', 'del', 'da', 'di']);
const COMMON = new Set(['will', 'may', 'grace', 'hope', 'faith', 'rose', 'mark', 'page', 'new', 'great', 'black', 'white', 'green', 'brown', 'young', 'long', 'little', 'king', 'queen', 'man', 'woman', 'boy', 'girl']);
const CO = 'appears with';
const FAMILY = {
  father: { re: /\bfather\b|\bdad\b/i, label: 'father of', flip: true },
  mother: { re: /\bmother\b|\bmom\b|\bmum\b/i, label: 'mother of', flip: true },
  spouse: { re: /\bmarri|\bwife\b|\bhusband\b|\bwed/i, label: 'married to' },
  sibling: { re: /\bsister\b|\bbrother\b|\bsibling|\btwin\b/i, label: 'sibling of' },
  child: { re: /\bson\b|\bdaughter\b|\bchild/i, label: 'parent of' },
};
function sceneTitleFrom(text) {
  let t = sentences(text)[0] || text;
  if (t.length > 46) { const cut = t.search(/[,;:—]/); if (cut > 12 && cut < 46) t = t.slice(0, cut); }
  if (t.length > 46) t = t.slice(0, 46).replace(/\s+\S*$/, '') + '…';
  return t.replace(/[.,;:]$/, '');
}

// Builds a title from Wikipedia's plot paragraphs, deterministically: the same article always gives the same graph.
function assembleFromWikipedia(page, paras, castNames, wd) {
  let units = paras.map(p => ({ part: p.part, text: p.text, links: p.links }));
  if (units.length < 4) { // a short plot: use groups of three sentences so the slider has some steps
    const ss = units.flatMap(u => sentences(u.text).map(s => ({ part: u.part, text: s, links: u.links })));
    if (ss.length >= 8) {
      units = [];
      for (let i = 0; i < ss.length; i += 3) { const g = ss.slice(i, i + 3); units.push({ part: g[0].part, text: g.map(x => x.text).join(' '), links: g.flatMap(x => x.links) }); }
    }
  }
  // Candidate names
  const cands = new Map();
  const add = (name, type, alias) => {
    name = canon(String(name).replace(/\s*\(.*?\)\s*/g, ' '));
    if (!validName(name)) return null;
    const key = name.toLowerCase();
    let c = cands.get(key);
    if (!c) { c = { name, type: type || 'thing', aliases: new Set([name]) }; cands.set(key, c); }
    else if (type && type !== 'thing' && c.type === 'thing') c.type = type;
    if (alias && validName(alias)) c.aliases.add(canon(alias));
    return c;
  };
  castNames.forEach(n => add(n, 'person'));
  // Plot links tie names together: a cast name, the article it links to, and its Wikidata label are one entity
  const labelTo = new Map();
  const knownFor = l => { const info = wd.linkInfo[l.title]; return cands.get(canon(l.title).toLowerCase()) || (info && info.label && cands.get(info.label.toLowerCase())); };
  units.forEach(u => u.links.forEach(l => {
    const c = knownFor(l), info = wd.linkInfo[l.title];
    if (!c) return;
    if (l.text && validName(l.text)) c.aliases.add(l.text);
    if (info && info.label) { c.aliases.add(info.label); labelTo.set(info.label.toLowerCase(), c); }
    labelTo.set(canon(l.title).toLowerCase(), c);
  }));
  wd.chars.forEach(n => { const c = labelTo.get(n.toLowerCase()); if (c) c.aliases.add(n); else add(n, 'person'); });
  wd.places.forEach(n => { const c = labelTo.get(n.toLowerCase()); if (c) c.aliases.add(n); else add(n, 'place'); });
  units.forEach(u => u.links.forEach(l => {
    const known = knownFor(l) || labelTo.get(canon(l.title).toLowerCase());
    if (known) { if (l.text && validName(l.text)) known.aliases.add(l.text); return; }
    const info = wd.linkInfo[l.title];
    if (info && info.type) add(info.label || l.title, info.type, l.text);
  }));
  // Short forms for people ("Luke", "Skywalker"), only when no one else shares them
  const list = [...cands.values()];
  const toks = c => c.name.split(' ').filter(t => !PARTICLE.has(t.toLowerCase()) && !HONORIFIC.test(t) && t.length >= 3 && /^[A-ZÀ-Ý]/.test(t));
  const tokCount = new Map();
  list.filter(c => c.type === 'person').forEach(c => new Set(toks(c)).forEach(t => tokCount.set(t, (tokCount.get(t) || 0) + 1)));
  list.forEach(c => {
    if (c.type !== 'person' || c.name.split(' ').length < 2) return;
    const tk = toks(c);
    [tk[0], tk[tk.length - 1]].forEach(t => { if (t && tokCount.get(t) === 1 && !COMMON.has(t.toLowerCase())) c.aliases.add(t); });
  });
  // Find every name in every sentence
  const aliasTo = new Map();
  list.forEach((c, i) => c.aliases.forEach(a => { if (a.length >= 2 && !aliasTo.has(a)) aliasTo.set(a, i); }));
  const units2 = units.map(u => ({ ...u, sents: sentences(u.text) }));
  const re = aliasTo.size ? nameRegex([...aliasTo.keys()]) : null;
  const hits = units2.map(u => u.sents.map(s => {
    const h = new Set();
    if (re) { re.lastIndex = 0; let m; while ((m = re.exec(s))) h.add(aliasTo.get(m[2])); }
    return h;
  }));
  const ids = new Map(), used = new Set();
  list.forEach((c, i) => {
    if (!hits.some(sc => sc.some(h => h.has(i)))) return;
    let id = slugify(c.name), n = 2; while (used.has(id)) id = `${slugify(c.name)}-${n++}`;
    used.add(id); ids.set(i, id);
  });
  const firstScene = i => hits.findIndex(sc => sc.some(h => h.has(i))) + 1;
  const entities = [...ids].map(([i, id]) => {
    const c = list[i], f = firstScene(i);
    return { id, type: c.type, first: f, names: [[f, c.name]], match: [...c.aliases].filter(a => a.length >= 2).map(a => [a, f]), aka: [] };
  });
  const typeOfId = Object.fromEntries(entities.map(e => [e.id, e.type]));
  // Scenes
  const scenes = units2.map((u, k) => {
    const inScene = [...new Set(hits[k].flatMap(h => [...h]))].filter(i => ids.has(i)).map(i => ids.get(i));
    return {
      id: k + 1, title: sceneTitleFrom(u.text), part: u.part || null,
      place: inScene.find(id => typeOfId[id] === 'place') || null,
      present: inScene.filter(id => typeOfId[id] === 'person' || typeOfId[id] === 'group'),
      mentioned: inScene.filter(id => typeOfId[id] === 'place' || typeOfId[id] === 'thing'),
      paras: [u.text],
    };
  });
  const parts = [];
  scenes.forEach(s => { if (s.part && (!parts.length || parts[parts.length - 1].n !== s.part)) parts.push({ n: s.part, start: s.id }); });
  // Facts: the first sentence naming each entity in each scene. Links: names in the same sentence.
  const obs = [], rels = [], pairSeen = new Set();
  units2.forEach((u, k) => {
    const sid = k + 1, seenHere = new Set();
    u.sents.forEach((s, j) => {
      const here = [...hits[k][j]].filter(i => ids.has(i)).map(i => ids.get(i));
      here.forEach(id => { if (!seenHere.has(id)) { seenHere.add(id); obs.push([id, sid, '', s]); } });
      for (let a = 0; a < here.length; a++) for (let b = a + 1; b < here.length; b++) {
        const key = [here[a], here[b]].sort().join('|');
        if (!pairSeen.has(key)) { pairSeen.add(key); rels.push([here[a], here[b], CO, sid, s, null]); }
      }
    });
  });
  // Family ties from Wikidata, only where a sentence names both people and says the relationship
  const idByName = new Map();
  entities.forEach(e => e.match.forEach(([a]) => { if (!idByName.has(a.toLowerCase())) idByName.set(a.toLowerCase(), e.id); }));
  const famSeen = new Set();
  wd.family.forEach(f => {
    const ia = idByName.get(f.a.toLowerCase()), ib = idByName.get(f.b.toLowerCase()), rule = FAMILY[f.kind];
    if (!ia || !ib || !rule) return;
    const [from, to] = rule.flip ? [ib, ia] : [ia, ib];
    const key = rule.label === 'married to' || rule.label === 'sibling of' ? [from, to].sort().join('|') + rule.label : from + '|' + to + rule.label;
    if (famSeen.has(key)) return;
    for (let k = 0; k < units2.length; k++) for (let j = 0; j < units2[k].sents.length; j++) {
      const here = new Set([...hits[k][j]].map(i => ids.get(i)));
      const s = units2[k].sents[j];
      if (here.has(ia) && here.has(ib) && rule.re.test(s)) { famSeen.add(key); rels.push([from, to, rule.label, k + 1, s, null]); return; }
    }
  });
  const kind = wd.kind === 'film' ? 'film' : wd.kind;
  return {
    id: 'wp-' + slugify(page), user: true, origin: 'wikipedia', added: Date.now(),
    book: {
      title: page, author: 'Wikipedia', byline: kind === 'film' ? 'Film · Wikipedia plot' : kind === 'tv' ? 'TV · Wikipedia plot' : 'Wikipedia plot',
      year: wd.year || '', kind: 'summary', namedParts: true, readLabel: 'Plot',
      cover: page.replace(/^(The|A|An) /, '').charAt(0).toUpperCase(),
      source: `Wikipedia, "${page}" (CC BY-SA 4.0)`,
      sourceUrl: 'https://en.wikipedia.org/wiki/' + encodeURIComponent(page.replace(/ /g, '_')),
      about: "Built in your browser from Wikipedia's plot summary, without AI. Names come from the article's cast or character list, Wikidata and links in the plot. A link joins two names that appear in the same sentence, and family ties are added only where a sentence states them. Each fact is the sentence it came from. Analyze with AI to add labelled links, facts and questions.",
    },
    defaultPos: 1, parts, scenes, ignore: [], merges: [], entities, obs, rels, questions: [], ai: { done: [] },
  };
}
async function scanWikipedia(title, step, signal) {
  step('Reading the article');
  const sec = await mwApi(WP, { action: 'parse', page: title, prop: 'sections', redirects: '1' }, signal);
  const page = sec.parse.title, sections = sec.parse.sections || [];
  const top = sections.filter(s => +s.toclevel === 1);
  const find = re => top.find(s => re.test(canon(htmlText(s.line))));
  const plotSec = find(/^(plot|plot summary|synopsis|summary|story|storyline|plot overview|narrative)\b/i);
  if (!plotSec) throw new Error(`"${page}" has no plot section to read.`);
  const castSec = find(/^(cast|cast and characters|characters|main characters|principal characters|major characters|voice cast|starring|cast and roles)\b/i);
  step('Reading the plot');
  const ph = await mwApi(WP, { action: 'parse', page, section: plotSec.index, prop: 'text', redirects: '1', disableeditsection: '1', disablelimitreport: '1' }, signal);
  const paras = parseSectionHTML(ph.parse.text);
  if (!paras.length) throw new Error(`The plot section of "${page}" is empty.`);
  let castNames = [];
  if (castSec) {
    step('Reading the cast and characters');
    const ch = await mwApi(WP, { action: 'parse', page, section: castSec.index, prop: 'text', redirects: '1', disableeditsection: '1', disablelimitreport: '1' }, signal);
    castNames = parseCast(ch.parse.text, /cast|starring/i.test(htmlText(castSec.line)));
  }
  let wd = { chars: [], places: [], kind: null, year: '', linkInfo: {}, family: [] };
  try { step('Checking Wikidata'); wd = await wikidataFor(page, paras, signal); }
  catch (e) { if (e.name === 'AbortError') throw e; console.warn('Wikidata skipped:', e.message); }
  step('Finding names in the plot');
  return assembleFromWikipedia(page, paras, castNames, wd);
}

/* ---------- Your own text ---------- */
function titleFromText(title, author, body) {
  const lines = String(body).replace(/\r\n?/g, '\n');
  const HEAD = /^\s*(?:(chapter|book|part|act|scene|letter)\s+([0-9]+|[ivxlcdm]+|[a-z-]+)\b[^\n]{0,60}|([IVXLC]+)\.?)\s*$/i;
  const blocks = lines.split(/\n\s*\n/).map(b => b.trim()).filter(Boolean);
  const chapters = []; let cur = null;
  blocks.forEach(b => {
    const firstLine = b.split('\n')[0];
    if (HEAD.test(firstLine) && firstLine.length < 80) {
      cur = { title: canon(firstLine).replace(/\.$/, ''), paras: [] };
      chapters.push(cur);
      const rest = b.split('\n').slice(1).join(' ');
      if (rest.trim()) cur.paras.push(canon(rest));
    } else {
      if (!cur) { cur = { title: null, paras: [] }; chapters.push(cur); }
      cur.paras.push(canon(b));
    }
  });
  let units = chapters.filter(c => c.paras.length);
  // No headings (or one huge chunk): cut into sections of about 1,800 words on paragraph breaks
  if (units.length < 2 || units.some(u => words(u.paras.join(' ')) > 12000)) {
    const all = units.flatMap(u => u.paras), out = [];
    let acc = [], n = 0;
    all.forEach(p => { acc.push(p); n += words(p); if (n >= 1800) { out.push(acc); acc = []; n = 0; } });
    if (acc.length) out.push(acc);
    units = out.map((ps, i) => ({ title: `Section ${i + 1}`, paras: ps }));
  }
  if (!units.length) throw new Error('There is no text to add.');
  title = canon(title) || 'Untitled text';
  return {
    id: 'tx-' + slugify(title), user: true, origin: 'text', added: Date.now(),
    book: {
      title, author: canon(author) || 'Your text', byline: canon(author) || 'Your text', year: '', kind: 'text', readLabel: 'Read',
      cover: title.replace(/^(The|A|An) /, '').charAt(0).toUpperCase(),
      source: 'Text you added, kept in this browser',
      about: 'Your own text, kept in this browser. Analyze with AI to build the graph. It only reads up to where you are, one section at a time, and every item it adds must quote that section.',
    },
    defaultPos: 1, parts: [],
    scenes: units.map((u, i) => ({ id: i + 1, title: u.title || `Section ${i + 1}`, part: null, place: null, present: [], mentioned: [], paras: u.paras })),
    ignore: [], merges: [], entities: [], obs: [], rels: [], questions: [], ai: { done: [] },
  };
}

/* ---------- AI analysis ---------- */
const MODELS = [['claude-sonnet-5-5', 'Claude Sonnet 5.5 (balanced)'], ['claude-haiku-5-5', 'Claude Haiku 5.5 (cheapest)'], ['claude-opus-5-5', 'Claude Opus 5.5 (most capable)']];
const AI = Object.assign({ provider: 'auto', key: '', url: '', model: 'claude-sonnet-5-5' }, store.get('ai', {}));
let aiRun = null;         // { ctl, sid, msg } while analyzing
function aiProvider() {
  if (AI.provider === 'key') return AI.key ? 'key' : null;
  if (AI.provider === 'server') return AI.url ? 'server' : null;
  return AI.key ? 'key' : AI.url ? 'server' : null;
}
function aiProviderText() {
  const p = aiProvider();
  if (p === 'key') return `Runs on your Anthropic API key (${MODELS.find(m => m[0] === AI.model)?.[1].split(' (')[0] || AI.model}).`;
  if (p === 'server') return 'Runs through your own server.';
  return 'No AI set up yet.';
}
const AI_SCHEMA = {
  type: 'object',
  properties: {
    entities: { type: 'array', items: { type: 'object', properties: { ref: { type: 'string' }, name: { type: 'string' }, type: { type: 'string', enum: ['person', 'place', 'thing', 'group'] }, aliases: { type: 'array', items: { type: 'string' } }, quote: { type: 'string' } }, required: ['ref', 'name', 'type', 'quote'] } },
    renames: { type: 'array', items: { type: 'object', properties: { entity: { type: 'string' }, name: { type: 'string' }, quote: { type: 'string' } }, required: ['entity', 'name', 'quote'] } },
    merges: { type: 'array', items: { type: 'object', properties: { from: { type: 'string' }, into: { type: 'string' }, quote: { type: 'string' } }, required: ['from', 'into', 'quote'] } },
    facts: { type: 'array', items: { type: 'object', properties: { entity: { type: 'string' }, text: { type: 'string' }, quote: { type: 'string' } }, required: ['entity', 'text', 'quote'] } },
    links: { type: 'array', items: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' }, label: { type: 'string' }, quote: { type: 'string' } }, required: ['from', 'to', 'label', 'quote'] } },
    ended: { type: 'array', items: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' }, label: { type: 'string' } }, required: ['from', 'to'] } },
    questions: { type: 'array', items: { type: 'object', properties: { text: { type: 'string' }, about: { type: 'array', items: { type: 'string' } }, quote: { type: 'string' } }, required: ['text', 'quote'] } },
    answers: { type: 'array', items: { type: 'object', properties: { question: { type: 'string' }, answer: { type: 'string' }, quote: { type: 'string' } }, required: ['question', 'answer', 'quote'] } },
  },
  required: ['entities', 'facts', 'links'],
};
const AI_SHAPE = '{"entities":[{"ref":"n1","name":"","type":"person|place|thing|group","aliases":[""],"quote":""}],"renames":[{"entity":"id","name":"","quote":""}],"merges":[{"from":"id","into":"id","quote":""}],"facts":[{"entity":"id or ref","text":"","quote":""}],"links":[{"from":"id or ref","to":"id or ref","label":"","quote":""}],"ended":[{"from":"id","to":"id","label":""}],"questions":[{"text":"","about":["id or ref"],"quote":""}],"answers":[{"question":"q1","answer":"","quote":""}]}';
function aiPrompt(sid) {
  const s = scene(sid);
  const known = D.entities.filter(e => e.first <= sid && resolve(e.id, sid) === e.id)
    .map(e => ({ id: e.id, name: nameAt(e, sid), type: e.type, aliases: e.match.map(m => m[0]).filter(a => a !== nameAt(e, sid)).slice(0, 5) }));
  const openQs = D.questions.filter(q => q.raised < sid && !qDone(q, sid - 1)).map(q => ({ id: q.id, question: q.q }));
  const links = relsAt(sid - 1).filter(r => !r.ended && r.label !== CO).map(r => ({ from: r.a, to: r.b, label: r.label })).slice(-80);
  const text = s.paras.join('\n\n').slice(0, 180000);
  return `You are building a spoiler-safe map of a story, one scene at a time. Read only the scene below and report what it adds.

Rules:
- Use only the SCENE TEXT. Do not use anything you know about this work from elsewhere, and never mention or hint at later events.
- Every item needs "quote": an exact, unchanged, contiguous copy of 4 to 25 words from the scene text. Items whose quote is not in the text are thrown away.
- Refer to known entities by their "id". For a new entity, add it to "entities" with a short "ref" such as "n1", and use that ref in the other lists.
- Types: person (any character, including animals, creatures and robots), place, thing (objects, vehicles, documents), group (families, factions, organizations).
- facts: short statements, under 15 words, of what this scene shows about an entity.
- links: relationships or interactions, labelled in lowercase so they read "from LABEL to", e.g. "married to", "works for", "betrays", "lives at".
- ended: earlier links (see EXISTING LINKS) that this scene shows are no longer true.
- renames: when this scene reveals a known entity's real or fuller name.
- merges: when this scene reveals two entities are the same one; "from" is folded into "into".
- questions: mysteries this scene raises. answers: open questions (see OPEN QUESTIONS) this scene answers.
- Leave a list empty when nothing applies. Fewer solid items beat many weak ones.

KNOWN ENTITIES: ${JSON.stringify(known)}
OPEN QUESTIONS: ${JSON.stringify(openQs)}
EXISTING LINKS: ${JSON.stringify(links)}

SCENE ${sid}${s.part ? ` (${s.part})` : ''}: ${s.title}
SCENE TEXT:
"""
${text}
"""

Reply with only one JSON object in this shape:
${AI_SHAPE}`;
}
async function callAI(prompt, signal) {
  const p = aiProvider();
  if (p === 'key' || p === 'server') {
    const headers = { 'content-type': 'application/json', 'anthropic-version': '2023-06-01' };
    if (p === 'key') { headers['x-api-key'] = AI.key; headers['anthropic-dangerous-direct-browser-access'] = 'true'; }
    const body = {
      model: AI.model || 'claude-sonnet-5-5', max_tokens: 8000,
      messages: [{ role: 'user', content: prompt }],
      tools: [{ name: 'record_scene', description: 'Record what this scene adds to the story map.', input_schema: AI_SCHEMA }],
      tool_choice: { type: 'tool', name: 'record_scene' },
    };
    let r;
    try { r = await fetch(p === 'key' ? 'https://api.anthropic.com/v1/messages' : AI.url, { method: 'POST', headers, body: JSON.stringify(body), signal }); }
    catch (e) { if (e.name === 'AbortError') throw { code: 'cancelled', message: 'Stopped.' }; throw { code: 'network', message: "Couldn't reach the API from this page." }; }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw { code: 'http_' + r.status, message: (j.error && j.error.message) || `The API answered with error ${r.status}.` };
    const tu = (j.content || []).find(c => c.type === 'tool_use');
    if (!tu) throw { code: 'invalid_json', message: 'The answer had no structured result.' };
    return tu.input;
  }
  throw { code: 'no_provider', message: 'Set up AI first, in AI settings.' };
}
// Adds one scene's result to the open title. Anything whose quote isn't in the scene is dropped.
function applyAI(sid, out) {
  const text = canon(scene(sid).paras.join(' '));
  const q = x => { const c = canon(x); return c && words(c) >= 3 && text.includes(c) ? c : null; };
  const arr = x => Array.isArray(x) ? x : [];
  const refs = {}, known = new Set(D.entities.map(e => e.id));
  let added = 0;
  const id = x => { x = String(x || ''); if (refs[x]) return refs[x]; if (known.has(x)) return resolve(x, sid); return null; };
  arr(out.entities).forEach(n => {
    const name = canon(n.name);
    if (!name || !text.includes(name) && !q(n.quote)) return;
    const type = ['person', 'place', 'thing', 'group'].includes(n.type) ? n.type : 'thing';
    let nid = slugify(name), k = 2; while (known.has(nid)) nid = `${slugify(name)}-${k++}`;
    known.add(nid); refs[String(n.ref || name)] = nid;
    const aliases = [...new Set([name, ...arr(n.aliases).map(canon)])].filter(a => a.length >= 2 && a.length <= 48);
    D.entities.push({ id: nid, type, first: sid, names: [[sid, name]], match: aliases.map(a => [a, sid]), aka: [] });
    added++;
  });
  arr(out.renames).forEach(r => { const e = E[id(r.entity)] || D.entities.find(x => x.id === id(r.entity)); const qq = q(r.quote); const name = canon(r.name);
    if (e && qq && name && name !== nameAt(e, sid)) { e.names.push([sid, name, qq]); e.match.push([name, sid]); added++; } });
  arr(out.merges).forEach(m => { const a = id(m.from), b = id(m.into), qq = q(m.quote);
    if (a && b && a !== b && qq && !D.merges.some(x => x.from === a)) { D.merges.push({ from: a, into: b, at: sid, quote: qq }); added++; } });
  arr(out.facts).forEach(f => { const e = id(f.entity), qq = q(f.quote), t = canon(f.text);
    if (e && qq && t) { D.obs.push([e, sid, t, qq]); added++; } });
  arr(out.links).forEach(l => { const a = id(l.from), b = id(l.to), qq = q(l.quote), lab = canon(l.label).toLowerCase();
    if (a && b && a !== b && qq && lab) { D.rels.push([a, b, lab, sid, qq, null]); added++; } });
  arr(out.ended).forEach(x => { const a = id(x.from), b = id(x.to), lab = canon(x.label).toLowerCase();
    const r = D.rels.find(r => r[3] < sid && !r[5] && r[2] !== CO && resolve(r[0], sid) === a && resolve(r[1], sid) === b && (!lab || r[2] === lab));
    if (r) { r[5] = sid; added++; } });
  arr(out.questions).forEach(x => { const qq = q(x.quote), t = canon(x.text);
    if (qq && t) { D.questions.push({ id: 'q' + (D.questions.length + 1), q: t, about: arr(x.about).map(id).filter(Boolean), raised: sid, rq: qq, answered: null, a: null, aq: null }); added++; } });
  arr(out.answers).forEach(x => { const qn = D.questions.find(z => z.id === String(x.question)), qq = q(x.quote);
    if (qn && !qn.answered && qn.raised < sid && qq && canon(x.answer)) { qn.answered = sid; qn.a = canon(x.answer); qn.aq = qq; added++; } });
  refreshScenes();
  return added;
}
// Who is on stage in each scene, from the names in its text.
function refreshScenes() {
  const byAlias = new Map();
  D.entities.forEach(e => e.match.forEach(([t, f]) => { if (!byAlias.has(t)) byAlias.set(t, { id: e.id, from: f }); }));
  if (!byAlias.size) return;
  const re = nameRegex([...byAlias.keys()]);
  D.scenes.forEach(s => {
    const found = new Set();
    s.paras.forEach(p => { re.lastIndex = 0; let m; while ((m = re.exec(p))) { const a = byAlias.get(m[2]); if (a && a.from <= s.id) found.add(a.id); } });
    const t = id => (D.entities.find(e => e.id === id) || {}).type;
    s.present = [...found].filter(id => t(id) === 'person' || t(id) === 'group');
    s.mentioned = [...found].filter(id => t(id) === 'place' || t(id) === 'thing');
    if (!s.place) s.place = [...found].find(id => t(id) === 'place') || null;
  });
}
async function runAI() {
  if (aiRun) return;
  if (!D.user) return;
  if (!aiProvider()) { openLibrary('ai'); return; }
  const todo = D.scenes.filter(s => s.id <= S.pos && !D.ai.done.includes(s.id)).map(s => s.id);
  if (!todo.length) return;
  const bookId = D.id;
  aiRun = { ctl: new AbortController(), sid: todo[0], msg: '' };
  renderLog();
  for (const sid of todo) {
    if (S.book !== bookId) break;
    aiRun.sid = sid; aiRun.msg = ''; renderAIStatus();
    try {
      const out = await callAI(aiPrompt(sid), aiRun.ctl.signal);
      if (S.book !== bookId) break;
      const n = applyAI(sid, out || {});
      D.ai.done.push(sid);
      D.ai.provider = aiProvider(); D.ai.model = AI.model;
      D.checked = false; loadBookData();
      await saveTitle(D);
      aiRun.last = `Scene ${sid}: ${n} item${n === 1 ? '' : 's'} added.`;
      renderAll();
    } catch (e) {
      const code = e && e.code;
      aiRun.error = code === 'cancelled' ? null : aiErrorText(e);
      break;
    }
  }
  const err = aiRun.error;
  aiRun = null;
  renderAll();
  if (err) { const el = $('#ai-msg'); if (el) { el.textContent = err; el.classList.add('bad'); } }
}
function aiErrorText(e) {
  const c = e && e.code;
  if (c === 'rate_limited') return "You've hit a usage limit. Try again later.";
  if (c === 'invalid_json') return "Claude's answer couldn't be read. Try that scene again.";
  if (c === 'http_401') return 'The API key was refused. Check it in AI settings.';
  if (c === 'network') return "Couldn't reach the API from this page.";
  if (c === 'no_provider') return 'Set up AI first, in AI settings.';
  return (e && e.message) || 'Something went wrong. Try again.';
}
// Re-derive the open title's lookups after its data changed (keeps the reading position).
function loadBookData() {
  E = Object.fromEntries(D.entities.map(e => [e.id, e]));
  sceneText = D.scenes.map(s => s.paras.join('\n'));
  allQuotes = [
    ...D.obs.map(o => [o[1], o[3]]), ...D.rels.map(r => [r[3], r[4]]),
    ...D.questions.flatMap(q => q.answered ? [[q.raised, q.rq], [q.answered, q.aq]] : [[q.raised, q.rq]]),
    ...D.entities.flatMap(e => [...e.names.filter(n => n[2]).map(n => [n[0], n[2]]), ...e.aka.map(a => [a[0], a[2]])]),
    ...D.merges.map(m => [m.at, m.quote]),
  ];
  verified = allQuotes.filter(([s, q]) => quoteOK(s, q)).length;
  D.checked = true;
}
function aiCardHTML() {
  if (!D.user) return '';
  const done = D.ai.done.length, upTo = S.pos;
  const todo = D.scenes.filter(s => s.id <= upTo && !D.ai.done.includes(s.id)).length;
  const p = aiProvider();
  let h = `<section class="ai-card"><h2 class="sec-h">AI analysis <span class="n">${done} of ${N} scenes</span></h2>
    <p>${esc(aiProviderText())} It reads one scene at a time, only up to where you are, and keeps an item only if its quote is in that scene.</p>`;
  if (aiRun) h += `<div class="ai-row"><span class="ai-spin" aria-hidden="true"></span><span id="ai-msg">Analyzing scene ${aiRun.sid}…</span><button class="btn" type="button" data-act="ai-stop">Stop</button></div>`;
  else {
    h += `<div class="ai-row">${p
      ? (todo ? `<button class="btn primary" type="button" data-act="ai-run">${todo === 1 ? `Analyze scene ${D.scenes.find(s => s.id <= upTo && !D.ai.done.includes(s.id)).id}` : `Analyze ${todo} scenes, up to scene ${upTo}`}</button>` : `<span>Analyzed up to scene ${upTo}. Move forward to analyze more.</span>`)
      : `<button class="btn primary" type="button" data-act="ai-setup">Set up AI</button>`}
      <button class="btn" type="button" data-act="ai-setup">AI settings</button></div><div class="ai-msg" id="ai-msg" role="status"></div>`;
  }
  return h + `</section>`;
}
function renderAIStatus() { const el = $('#ai-msg'); if (el && aiRun) el.textContent = `Analyzing scene ${aiRun.sid}…` + (aiRun.last ? ` ${aiRun.last}` : ''); }

/* ---------- Library views ---------- */
let wpCtl = null;
function openLibrary(mode = true) {
  const had = S.sel; S.sel = null; S.lib = mode;
  if (had) renderGraph();
  const sh = $('#sheet');
  const head = (title, sub, back) => `<div class="sheet-h gutter"><div>${back ? `<button class="linkbtn" type="button" data-act="lib">‹ Library</button>` : `<span class="type">${esc(sub)}</span>`}<h2 id="sheet-title">${esc(title)}</h2></div>
      <button class="x" type="button" data-act="close" aria-label="Close">×</button></div>`;
  let h = '';
  if (mode === 'wp') {
    h = head('Add from Wikipedia', '', true) + `<div class="sheet-b gutter">
      <p class="shelf-note">Finds a book, film or show on Wikipedia and builds its graph from the plot summary, without AI. You can analyze it with AI afterwards.</p>
      <form class="addform" id="wp-form"><input class="search" id="wp-q" type="search" placeholder="Search Wikipedia" autocomplete="off" aria-label="Search Wikipedia"><button class="btn primary" type="submit">Search</button></form>
      <div class="results" id="wp-results"></div><div class="ai-msg" id="wp-status" role="status"></div></div>`;
  } else if (mode === 'text') {
    h = head('Add your own text', '', true) + `<div class="sheet-b gutter">
      <p class="shelf-note">Paste a story or choose a .txt file. Chapter headings become steps; otherwise it's cut into sections of about 1,800 words. The text stays in this browser. Use AI analysis to build its graph.</p>
      <div class="addform col"><input class="search" id="tx-title" placeholder="Title" aria-label="Title"><input class="search" id="tx-author" placeholder="Author (optional)" aria-label="Author">
      <textarea class="search area" id="tx-body" rows="8" placeholder="Paste the text here" aria-label="Text"></textarea>
      <div class="ai-row"><label class="btn file">Choose a .txt file<input type="file" id="tx-file" accept=".txt,text/plain" hidden></label><button class="btn primary" type="button" data-act="tx-add">Add to library</button></div>
      <div class="ai-msg" id="tx-status" role="status"></div></div></div>`;
  } else if (mode === 'ai') {
    const opt = (v, label, note, disabled) => `<label class="opt${disabled ? ' off' : ''}"><input type="radio" name="ai-p" value="${v}"${AI.provider === v ? ' checked' : ''}${disabled ? ' disabled' : ''}><span><b>${label}</b><small>${note}</small></span></label>`;
    const models = MODELS.map(([v, l]) => `<option value="${v}"${AI.model === v ? ' selected' : ''}>${esc(l)}</option>`).join('');
    h = head('AI settings', '', true) + `<div class="sheet-b gutter"><div class="addform col">
      ${opt('auto', 'Automatic', 'Uses your API key if you have added one, otherwise your server.')}
      ${opt('key', 'Your Anthropic API key', 'Billed to your API account, separate from a Claude plan.')}
      <input class="search" id="ai-key" type="password" placeholder="sk-ant-…" value="${esc(AI.key)}" autocomplete="off" aria-label="Anthropic API key">
      ${opt('server', 'Your own server', 'Any address that accepts Anthropic Messages API requests, such as a Cloudflare Worker holding your key.')}
      <input class="search" id="ai-url" type="url" placeholder="https://…" value="${esc(AI.url)}" aria-label="Server address">
      <label class="lbl" for="ai-model">Model for the API key or server</label><select class="search" id="ai-model">${models}</select>
      <div class="ai-row"><button class="btn primary" type="button" data-act="ai-save">Save</button><button class="btn" type="button" data-act="ai-clear">Forget key</button></div>
      <p class="shelf-note">Your key and server address are stored in this browser only, and sent only to Anthropic or your server.</p>
      <div class="ai-msg" id="ai-set-status" role="status"></div></div></div>`;
  } else {
    const covers = ['var(--accent)', 'var(--l2)', 'var(--l4)', 'var(--l5)', 'var(--l3)', 'var(--l7)'];
    h = head('Library', `${LIB.books.length} titles`) + `<div class="sheet-b gutter">
      <div class="ai-row"><button class="btn" type="button" data-act="add-wp">Add from Wikipedia</button><button class="btn" type="button" data-act="add-text">Add your own text</button><button class="btn" type="button" data-act="ai-setup">AI settings</button></div>
      <div class="shelf">`;
    LIB.books.forEach((b, i) => {
      const sp = savedPos(b), n = b.scenes.length, cur = b.id === S.book;
      const num = b.book.cover || (b.book.source.match(/Adventure ([IVX]+)$/) || [])[1] || b.book.title.charAt(0);
      const at = cur ? S.pos : sp;
      const tag = b.origin === 'wikipedia' ? ' · from Wikipedia' : b.origin === 'text' ? ' · your text' : '';
      const aiTag = b.ai && b.ai.done.length ? ` · AI ${b.ai.done.length}/${n}` : '';
      h += `<div class="vol-wrap"><button class="vol" type="button" data-book="${esc(b.id)}" aria-current="${cur}">
        <span class="cover" style="background:${covers[i % covers.length]}" aria-hidden="true">${esc(num)}</span>
        <span style="min-width:0"><span class="vol-t">${esc(b.book.title)}</span>
        <div class="vol-m">${esc(byline(b.book))} · ${n} ${n === 1 ? 'step' : 'steps'} · ${b.entities.length} names${tag}${aiTag}</div>
        <div class="vol-p">${at ? `<span class="prog"><i style="width:${(at / n) * 100}%"></i></span><span>${cur ? '<span class="pill">Reading</span> ' : ''}${at} of ${n}</span>` : `<span class="prog"><i style="width:0"></i></span><span>Not started</span>`}</div></span>
      </button>${b.user ? `<button class="linkbtn vol-x" type="button" data-remove="${esc(b.id)}">Remove</button>` : ''}</div>`;
    });
    h += `</div><p class="shelf-note">Titles you add are kept in this browser only. Each title keeps its own position and pictures.</p></div>`;
  }
  sh.innerHTML = h; sh.hidden = false; $('#scrim').hidden = false;
  if (mode === 'wp') $('#wp-q').focus();
  else if (mode === true) { const b = sh.querySelector('.vol[aria-current="true"]'); if (b) b.focus(); }
}
async function doWpSearch(q) {
  const box = $('#wp-results'), st = $('#wp-status');
  if (!q.trim()) return;
  if (wpCtl) wpCtl.abort();
  wpCtl = new AbortController();
  st.className = 'ai-msg'; st.textContent = 'Searching…'; box.innerHTML = '';
  try {
    const rs = await wpSearch(q, wpCtl.signal);
    st.textContent = rs.length ? '' : 'Nothing found. Try the full title.';
    box.innerHTML = rs.map(r => `<button class="res" type="button" data-wp="${esc(r.title)}"><b>${esc(r.title)}</b><small>${esc(r.snippet)}</small></button>`).join('');
  } catch (e) {
    if (e.name === 'AbortError') return;
    st.className = 'ai-msg bad';
    st.textContent = e.message === 'NETWORK' ? "This copy of Book Graph can't reach Wikipedia. Open the GitHub version to add titles from Wikipedia." : e.message;
  }
}
async function doWpAdd(title) {
  const st = $('#wp-status');
  if (wpCtl) wpCtl.abort();
  wpCtl = new AbortController();
  $('#wp-results').innerHTML = '';
  st.className = 'ai-msg';
  try {
    const b = await scanWikipedia(title, msg => { st.textContent = `${msg}…`; }, wpCtl.signal);
    if (!b.entities.length) throw new Error(`No names were found in the plot of "${b.book.title}".`);
    closeSheet();
    const saved = await addTitle(b);
    if (!saved) console.warn('This title will not be kept after you leave the page.');
  } catch (e) {
    if (e.name === 'AbortError') return;
    st.className = 'ai-msg bad';
    st.textContent = e.message === 'NETWORK' ? "This copy of Book Graph can't reach Wikipedia. Open the GitHub version to add titles from Wikipedia." : e.message;
  }
}
async function doTextAdd() {
  const st = $('#tx-status');
  try {
    const b = titleFromText($('#tx-title').value, $('#tx-author').value, $('#tx-body').value);
    closeSheet();
    await addTitle(b);
    showTab('log');
  } catch (e) { st.className = 'ai-msg bad'; st.textContent = e.message; }
}
function saveAISettings() {
  const pick = document.querySelector('input[name="ai-p"]:checked');
  AI.provider = pick ? pick.value : 'auto';
  AI.key = ($('#ai-key').value || '').trim();
  AI.url = ($('#ai-url').value || '').trim();
  AI.model = $('#ai-model').value;
  const ok = store.set('ai', AI);
  const st = $('#ai-set-status');
  st.className = 'ai-msg' + (aiProvider() ? '' : ' bad');
  st.textContent = !ok ? "Saved for now, but this browser won't keep it after you leave." : aiProvider() ? `Saved. ${aiProviderText()}` : 'Saved, but nothing is set up yet: add a key or server address.';
}

document.addEventListener('click', ev => {
  const t = ev.target.closest('[data-act], [data-wp], [data-remove]');
  if (!t) return;
  if (t.dataset.wp) return doWpAdd(t.dataset.wp);
  if (t.dataset.remove) return removeTitle(t.dataset.remove);
  const a = t.dataset.act;
  if (a === 'lib') return openLibrary();
  if (a === 'add-wp') return openLibrary('wp');
  if (a === 'add-text') return openLibrary('text');
  if (a === 'ai-setup') return openLibrary('ai');
  if (a === 'ai-save') return saveAISettings();
  if (a === 'ai-clear') { AI.key = ''; store.set('ai', AI); return openLibrary('ai'); }
  if (a === 'tx-add') return doTextAdd();
  if (a === 'ai-run') return runAI();
  if (a === 'ai-stop') { if (aiRun) aiRun.ctl.abort(); return; }
});
document.addEventListener('submit', ev => {
  if (ev.target.id === 'wp-form') { ev.preventDefault(); doWpSearch($('#wp-q').value); }
});
document.addEventListener('change', ev => {
  if (ev.target.id === 'tx-file' && ev.target.files[0]) {
    const f = ev.target.files[0], fr = new FileReader();
    fr.onload = () => { $('#tx-body').value = fr.result; if (!$('#tx-title').value) $('#tx-title').value = f.name.replace(/\.txt$/i, ''); };
    fr.readAsText(f);
  }
});
