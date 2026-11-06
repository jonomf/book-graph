# Book Graph

A reading companion that builds a graph of a story's people, places and things as you read, and only ever shows what the story has told you so far.

This is the proof-of-concept prototype. It uses "A Scandal in Bohemia" (Arthur Conan Doyle, 1891, public domain), split into 15 scenes. The extraction was done ahead of time and is bundled into the page, so the page needs no server or API key.

**Live page:** https://jonomf.github.io/book-graph/

## What it does

- **Reading position.** One slider sets where you are in the story. Every view filters to it, so scrubbing back hides later facts, names and links.
- **Read.** The scene text, with known names linked.
- **Graph.** People, places, things and groups, coloured by type. New items pulse; links that are no longer true are dashed.
- **Timeline.** Who is on stage, or only mentioned, in each scene.
- **Index and Log.** Everything known so far, what each scene added, and open and answered questions.
- **Quotes.** Every fact cites a quote, and the page checks each quote word for word against its own scene before showing it.
- **Pictures.** You can attach an image to any entity. It's stored in your browser only.

## Files

| Path | What it is |
| --- | --- |
| `index.html` | The built page (served by GitHub Pages). Don't edit by hand. |
| `src/scandal.txt` | Story text from Project Gutenberg eBook #1661, one paragraph per block, parts headed `I.`, `II.`, `III.` |
| `src/data.js` | The extraction: scenes, entities, facts, links, questions, name reveals, each with a quote |
| `src/app.html` | The app: markup, styles and script. The build inserts the data. |
| `src/build.js` | Splits the text into scenes, checks every quote, and writes `index.html` |

## Build

```
node src/build.js
```

The build fails if any quote is missing from the scene it's filed under. It needs Node only, no packages. The page loads d3 7.8.5 and Google Fonts from their CDNs.
