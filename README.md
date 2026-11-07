# Book Graph

A reading companion that builds a graph of a story's people, places and things as you read, and only ever shows what the story has told you so far.

This is the proof-of-concept prototype. It has two public-domain stories from The Adventures of Sherlock Holmes: "A Scandal in Bohemia" (15 scenes) and "The Red-Headed League" (14 scenes). The extraction was done ahead of time and is bundled into the page, so the page needs no server or API key.

It also has one film, "The Empire Strikes Back" (1980, 18 scenes in four sequences). A film has no public text to quote, so `books/empire-strikes-back/text.txt` holds Claude's own scene notes, written from the film and checked against [Wikipedia's plot summary](https://en.wikipedia.org/wiki/The_Empire_Strikes_Back). Facts quote those notes, so the same quote check and spoiler rules apply.

**Live page:** https://jonomf.github.io/book-graph/

## What it does

- **Library.** Tap the book title to switch stories. Each book keeps its own reading position and pictures, and each has its own link (`#scandal-in-bohemia`, `#red-headed-league`).
- **Reading position.** One slider sets where you are in the story. Every view filters to it, so scrubbing back hides later facts, names and links.
- **Read.** The scene text, with known names linked. On wide screens the text sits beside the other views: drag the divider to resize it (double-click to reset), or hide it with the Hide text button.
- **Graph.** People, places, things and groups, coloured by type. New items pulse; links that are no longer true are dashed.
- **Timeline.** Who is on stage, or only mentioned, in each scene.
- **Index and Log.** Everything known so far, what each scene added, and open and answered questions.
- **Quotes.** Every fact cites a quote, and the page checks each quote word for word against its own scene before showing it.
- **Pictures.** You can attach an image to any entity. It's stored in your browser only.

## Files

| Path | What it is |
| --- | --- |
| `index.html` | The built page (served by GitHub Pages). Don't edit by hand. |
| `books/<id>/text.txt` | The text to quote: a public-domain story (Project Gutenberg eBook #1661), or scene notes for a film. One paragraph per block. Optional part headings on their own line: `I.`, `II.` for books, `# Name` for a film's sequences. |
| `books/<id>/data.js` | The extraction: scenes, entities, facts, links, questions, name reveals, aliases and merges, each with a quote |
| `src/app.html` | The app: markup, styles and script. The build inserts the data. |
| `src/build.js` | Splits each text into scenes, checks every quote, and writes `index.html`. The `BOOKS` list sets library order. |

To add a book, create `books/<id>/` with both files and add the id to `BOOKS` in `src/build.js`.

## Build

```
node src/build.js
```

The build fails if any quote is missing from the scene it's filed under. It needs Node only, no packages. The page loads d3 7.8.5 and Google Fonts from their CDNs.
