# Book Graph

Claude writes the code for this project; Jono reviews previews on his phone and approves.

## Decisions so far
- A hosted web app, phone first. No Obsidian integration.
- Capture is automatic, extracted from the book's text. Only images the user attaches; nothing generated.
- Public-domain books first. Long-term plan: The Hound of the Baskervilles, then Pride and Prejudice, Dracula, The Count of Monte Cristo.
- Later phases use the Claude API on Jono's key through a Cloudflare Worker, extracting only chapters as they are reached.

## This prototype
- Static page, no external services. Extraction is pre-written in `src/data.js`.
- Every fact, link, question and name reveal carries a quote that must appear verbatim in its scene. `node src/build.js` enforces this; keep it that way.
- Spoiler safety lives in the as-of helpers in `src/app.html` (`visible`, `nameAt`, `obsAt`, `relsAt`, `resolve`). Every view must read through them.
- Rebuild `index.html` after any change in `src/`, and commit both.
