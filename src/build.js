// Splits the story into scenes, checks every quote against its own scene, and writes the page.
const fs = require('fs');
const path = require('path');
const D = require('./data.js');

const norm = s => s.replace(/--/g, '—').replace(/\s+/g, ' ').trim();
const raw = fs.readFileSync(path.join(__dirname, 'scandal.txt'), 'utf8');

// Parts are headed "I.", "II.", "III." on their own line; paragraphs are separated by blank lines.
const blocks = raw.split(/\n\s*\n/).map(b => b.trim()).filter(Boolean);
const paras = []; let part = null;
for (const b of blocks) {
  if (/^(I|II|III)\.$/.test(b)) { part = b.slice(0, -1); continue; }
  paras.push({ part, text: norm(b) });
}

// Scene starts from anchors, searched in order.
let from = 0; const starts = [];
for (const s of D.scenes) {
  const a = norm(s.anchor);
  const i = paras.findIndex((p, k) => k >= from && p.text.includes(a));
  if (i < 0) throw new Error(`Anchor not found for scene ${s.id}: ${a}`);
  starts.push(i); from = i + 1;
}
const scenes = D.scenes.map((s, k) => {
  const end = k + 1 < starts.length ? starts[k + 1] : paras.length;
  const ps = paras.slice(starts[k], end);
  const parts = new Set(ps.map(p => p.part));
  if (parts.size !== 1) throw new Error(`Scene ${s.id} crosses a part boundary`);
  const { anchor, ...rest } = s;
  return { ...rest, part: ps[0].part, paras: ps.map(p => p.text) };
});
const sceneText = id => scenes[id - 1].paras.join('\n');

// Verify every quote.
const fails = []; let checked = 0;
const check = (where, scene, q) => { checked++; if (!sceneText(scene).includes(norm(q))) fails.push(`${where} (scene ${scene}): ${q}`); };
const ids = new Set(D.entities.map(e => e.id));
const needId = (id, where) => { if (!ids.has(id)) fails.push(`Unknown entity ${id} in ${where}`); };

D.entities.forEach(e => e.names.forEach(n => { if (n[2]) check(`name ${e.id}`, n[0], n[2]); }));
D.obs.forEach(o => { needId(o[0], 'obs'); check(`fact ${o[0]}`, o[1], o[3]); });
D.rels.forEach(r => { needId(r[0], 'rel'); needId(r[1], 'rel'); check(`rel ${r[0]}→${r[1]}`, r[3], r[4]); });
D.questions.forEach(q => { check(`question raised`, q.raised, q.rq); check(`question answered`, q.answered, q.aq); });
D.merges.forEach(m => check(`merge ${m.from}`, m.at, m.quote));
scenes.forEach(s => [...s.present, ...s.mentioned, ...(s.place ? [s.place] : [])].forEach(id => needId(id, `scene ${s.id}`)));

// Alias coverage: how many reader links each alias makes (helps spot dead aliases).
const dead = [];
D.entities.forEach(e => e.match.forEach(([t, f, to]) => {
  const hit = scenes.some(s => s.id >= f && (!to || s.id <= to) && s.paras.some(p => p.includes(t)));
  if (!hit) dead.push(`${e.id}: "${t}"`);
}));

console.log(`paragraphs ${paras.length}, scenes ${scenes.length}: ${scenes.map(s => s.paras.length).join(' ')}`);
console.log(`quotes checked ${checked}, failed ${fails.length}`);
fails.forEach(f => console.log('  FAIL', f));
if (dead.length) console.log('aliases with no hits:', dead.join('; '));
if (fails.length) process.exit(1);

const out = {
  book: D.book, parts: D.parts, scenes, ignore: D.ignore, merges: D.merges,
  entities: D.entities.map(e => ({ ...e, names: e.names.map(n => [n[0], n[1], n[2] ? norm(n[2]) : null]) })),
  obs: D.obs.map(o => [o[0], o[1], o[2], norm(o[3])]),
  rels: D.rels.map(r => [r[0], r[1], r[2], r[3], norm(r[4]), r[5] || null]),
  questions: D.questions.map(q => ({ ...q, rq: norm(q.rq), aq: norm(q.aq) })),
};
// app.html is the page body; index.html wraps it as a standalone document for GitHub Pages.
// `node src/build.js --fragment` also writes dist/book-graph.html (body only) for publishing as a claude.ai artifact.
const tpl = fs.readFileSync(path.join(__dirname, 'app.html'), 'utf8');
const json = JSON.stringify(out).replace(/</g, '\\u003c');
const body = tpl.replace('/*__DATA__*/null', () => json);
const cut = body.indexOf('<div class="app">');
const headTags = body.slice(0, cut).replace('<meta name="claude:viewport-fit-sides" content="cover">\n', '');
const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="description" content="Book Graph prototype: a spoiler-safe graph of A Scandal in Bohemia that grows as you read.">
<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0}img{max-width:100%}[hidden]{display:none!important}</style>
${headTags.trim()}
</head>
<body>
${body.slice(cut)}
</body>
</html>
`;
const root = path.join(__dirname, '..');
fs.writeFileSync(path.join(root, 'index.html'), page);
console.log('wrote index.html', Math.round(page.length / 1024) + ' KB');
if (process.argv.includes('--fragment')) {
  fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
  fs.writeFileSync(path.join(root, 'dist', 'book-graph.html'), body);
  console.log('wrote dist/book-graph.html');
}
