# Book Graph

Claude writes the code for this project; Jono reviews previews on his phone and approves.

## Decisions so far
- A hosted web app, phone first. No Obsidian integration.
- Capture is automatic, extracted from the book's text. Only images the user attaches; nothing generated.
- Public-domain books first. Long-term plan: The Hound of the Baskervilles, then Pride and Prejudice, Dracula, The Count of Monte Cristo.
- Later phases use the Claude API on Jono's key through a Cloudflare Worker, extracting only chapters as they are reached.

## This prototype
- Static page, no external services. Each book lives in `books/<id>/` (`text.txt` + pre-written extraction in `data.js`); `BOOKS` in `src/build.js` lists them.
- Two books so far (A Scandal in Bohemia, The Red-Headed League) and one film (The Empire Strikes Back). Hold off on more until asked (token cost).
- Films (`book.kind: 'film'`): no screenplay or copyrighted text in the repo. `text.txt` is Claude's own scene notes; facts quote the notes. Sequences are `# Name` headings.
- Every fact, link, question and name reveal carries a quote that must appear verbatim in its scene. `node src/build.js` enforces this; keep it that way.
- Spoiler safety lives in the as-of helpers in `src/app.html` (`visible`, `nameAt`, `obsAt`, `relsAt`, `resolve`). Every view must read through them.
- Reading position and pictures are stored per book in the browser (`pos:<book>`, `img:<book>:<entity>`).
- Wide screens (960px and up): the text column width and hidden state are stored as `readW` and `readOff`. Phones show the text as its own tab instead.
- Rebuild `index.html` after any change in `src/` or `books/`, and commit both.
