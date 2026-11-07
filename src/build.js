// Builds the page from every book in books/: splits each text into scenes, checks every quote
// against its own scene, and writes index.html.
// `node src/build.js --fragment` also writes dist/book-graph.html (body only) for publishing as a claude.ai artifact.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const BOOKS = ['scandal-in-bohemia', 'red-headed-league']; // library order

const norm = s => s.replace(/--/g, '—').replace(/\s+/g, ' ').trim();
let failed = false;

function buildBook(id) {
  const dir = path.join(ROOT, 'books', id);
  const D = require(path.join(dir, 'data.js'));
  const raw = fs.readFileSync(path.join(dir, 'text.txt'), 'utf8');

  // Optional part headings ("I.", "II.", ...) on their own line; paragraphs are separated by blank lines.
  const blocks = raw.split(/\n\s*\n/).map(b => b.trim()).filter(Boolean);
  const paras = []; let part = null;
  for (const b of blocks) {
    if (/^(I|II|III|IV|V|VI)\.$/.test(b)) { part = b.slice(0, -1); continue; }
    paras.push({ part, text: norm(b) });
  }

  let from = 0; const starts = [];
  for (const s of D.scenes) {
    const a = norm(s.anchor);
    const i = paras.findIndex((p, k) => k >= from && p.text.includes(a));
    if (i < 0) throw new Error(`${id}: anchor not found for scene ${s.id}: ${a}`);
    starts.push(i); from = i + 1;
  }
  const scenes = D.scenes.map((s, k) => {
    const end = k + 1 < starts.length ? starts[k + 1] : paras.length;
    const ps = paras.slice(starts[k], end);
    if (new Set(ps.map(p => p.part)).size !== 1) throw new Error(`${id}: scene ${s.id} crosses a part boundary`);
    const { anchor, ...rest } = s;
    return { ...rest, part: ps[0].part, paras: ps.map(p => p.text) };
  });
  const sceneText = sid => scenes[sid - 1].paras.join('\n');

  const fails = []; let checked = 0;
  const check = (where, sid, q) => { checked++; if (!sceneText(sid).includes(norm(q))) fails.push(`${where} (scene ${sid}): ${q}`); };
  const ids = new Set(D.entities.map(e => e.id));
  const needId = (eid, where) => { if (!ids.has(eid)) fails.push(`unknown entity "${eid}" in ${where}`); };

  D.entities.forEach(e => {
    e.names.forEach(n => { if (n[2]) check(`name ${e.id}`, n[0], n[2]); });
    (e.aka || []).forEach(n => check(`aka ${e.id}`, n[0], n[2]));
  });
  D.obs.forEach(o => { needId(o[0], 'fact'); check(`fact ${o[0]}`, o[1], o[3]); });
  D.rels.forEach(r => { needId(r[0], 'link'); needId(r[1], 'link'); check(`link ${r[0]}→${r[1]}`, r[3], r[4]); });
  D.questions.forEach(q => { check('question raised', q.raised, q.rq); check('question answered', q.answered, q.aq); q.about.forEach(a => needId(a, 'question')); });
  D.merges.forEach(m => { needId(m.from, 'merge'); needId(m.into, 'merge'); check(`merge ${m.from}`, m.at, m.quote); });
  scenes.forEach(s => [...s.present, ...s.mentioned, ...(s.place ? [s.place] : [])].forEach(x => needId(x, `scene ${s.id}`)));

  const dead = [];
  D.entities.forEach(e => e.match.forEach(([t, f, to]) => {
    if (!scenes.some(s => s.id >= f && (!to || s.id <= to) && s.paras.some(p => p.includes(t)))) dead.push(`${e.id}: "${t}"`);
  }));

  console.log(`${id}: ${paras.length} paragraphs, ${scenes.length} scenes, ${D.entities.length} entities, ${D.obs.length} facts, ${D.rels.length} links`);
  console.log(`  quotes checked ${checked}, failed ${fails.length}`);
  fails.forEach(f => console.log('  FAIL', f));
  if (dead.length) console.log('  aliases with no hits:', dead.join('; '));
  if (fails.length) failed = true;

  return {
    id, book: D.book, defaultPos: D.defaultPos || 1, parts: D.parts || [], scenes, ignore: D.ignore || [], merges: D.merges,
    entities: D.entities.map(e => ({
      ...e,
      names: e.names.map(n => [n[0], n[1], n[2] ? norm(n[2]) : null]),
      aka: (e.aka || []).map(n => [n[0], n[1], norm(n[2])]),
    })),
    obs: D.obs.map(o => [o[0], o[1], o[2], norm(o[3])]),
    rels: D.rels.map(r => [r[0], r[1], r[2], r[3], norm(r[4]), r[5] || null]),
    questions: D.questions.map(q => ({ ...q, rq: norm(q.rq), aq: norm(q.aq) })),
  };
}

const library = BOOKS.map(buildBook);
if (failed) process.exit(1);

const tpl = fs.readFileSync(path.join(__dirname, 'app.html'), 'utf8');
const json = JSON.stringify({ books: library }).replace(/</g, '\\u003c');
const body = tpl.replace('/*__DATA__*/null', () => json);
const cut = body.indexOf('<div class="app">');
const headTags = body.slice(0, cut).replace('<meta name="claude:viewport-fit-sides" content="cover">\n', '');
const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="description" content="Book Graph prototype: a spoiler-safe graph of a story's people, places and things that grows as you read.">
<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0}img{max-width:100%}[hidden]{display:none!important}</style>
${headTags.trim()}
</head>
<body>
${body.slice(cut)}
</body>
</html>
`;
fs.writeFileSync(path.join(ROOT, 'index.html'), page);
console.log('wrote index.html', Math.round(page.length / 1024) + ' KB');
if (process.argv.includes('--fragment')) {
  fs.mkdirSync(path.join(ROOT, 'dist'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'dist', 'book-graph.html'), body);
  console.log('wrote dist/book-graph.html');
}
