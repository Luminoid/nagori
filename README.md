# Nagori

A guitar practice site you host with your own songs. This copy is configured for `https://guitar.luminoid.dev`, the author's instance; the name, Nagori (名残), is the trace a note leaves as it fades. Every song gets a chords view and a tab view, the video or a synthesized playback of the tab to follow bar by bar, and the left-hand finger positions for every part; beside the songs sit a metronome, a fretboard note map and a tuner. English and Chinese. Vanilla JavaScript, SVG and Web Audio, no build step, no dependencies: a folder of static files on any host.

The songs in this repository are a small public-domain collection. The author's own songs live in a separate private repository linked in as `private/`, which git ignores, so they never reach a deployment built from this one (see "A private collection"). To run the site with yours, see "Use it with your own songs".

## Use it with your own songs

On the site itself, without installing anything: the home page's "Your songs" panel reads a song folder (or a whole collection of them) from your disk, by picker or by drag and drop, and keeps it in your browser's storage. Those songs open, play and print like the others and stay on that device only; nothing is uploaded. It takes a single song folder or any folder that holds song folders at any depth (a fork's `data/songs`, a collection kept anywhere on disk); the layout is the one the importers write:

```
my-songs/                    any folder holding song folders, or a single song folder
  twelve-bar-blues/
    song.json                the song: title, tempo, sections, chords, the list of parts
    tracks/guitar.json       one file per part, the tab bar by bar
    tracks/bass.json
    curation.json            optional: the length shown on the card and the name to sort by
  another-song/
    ...
```

To run your own copy of the site with your songs built in:

1. Fork or download the repository and delete the folders under `data/songs/` you do not want (they are the public-domain starter collection).
2. Add songs: import a MusicXML score from Guitar Pro, MuseScore or TuxGuitar, or write the JSON by hand (`make example` drops a hand-written twelve-bar blues into the collection to start from). "Adding a song" below has the commands, [docs/song-format.md](docs/song-format.md) the format.
3. `make index` rebuilds the home page listing and writes each song's page from the song folders (the importers do it themselves), `make validate` checks every song, `make test` runs the test suite over your data too.
4. Edit `data/site.json`: the site's name and address, its default language (`"auto"` follows the browser, or `"en"` / `"zh"`), the copyright line, whether the host serves pages without their `.html` (`cleanUrls`, see "Deployment"), and per language the home page title and intro, the collection's name and the footer line. Empty fields keep the built-in text. The name also sits in the titles, meta tags and noscript lines of the four HTML files, in `manifest.webmanifest` and in `icons/og.svg` (regenerate `og.png` after editing it): search for "Nagori" to find every spot.
5. Deploy the folder as static files (see "Deployment"). The code is MIT licensed; the songs you add are yours to license.

## Features

- **Chords view**: chord diagrams with finger numbers, the chord sheet with chords over lyrics, and the section and chord that are sounding highlighted while the video plays. Songs whose source brings no chord sheet get one generated: the vocal track's syllables are aligned to its beats and the chord sounding at each syllable is placed above it (or, without lyrics, a bar-by-bar progression grid).
- **Tab view**: tablature with rhythm stems and beams, ties, hammer-ons/pull-offs, slides, bends, dead notes, let-ring marks, chord names and section markers, for each track (two lead guitars, rhythm guitar, overdubs, bass).
- **Video sync**: the official YouTube video with a per-bar sync map. A playhead follows the tab beat by beat, the page scrolls with it, and clicking any bar seeks the video. Playback speed, per-section looping, and a fine sync offset (saved per song).
- **Tab playback**: the transcription played in the browser at its written tempo (tempo map and time-signature changes included), every part synthesized as a plucked string (a Karplus-Strong string model through a resonant guitar body and a small room, no samples to download; every pluck is a little different, as a hand's are). Ties, let-ring, muted strums, hammer-ons, slides and bends are honoured; the same playhead, speed and section loop apply. Mute any part to play it yourself, add a metronome click, and pick the guitar sound (acoustic, clean electric, overdrive, nylon, palm mute). Switching between video and tab keeps the bar position, and pressing play inside the video switches back. `make render` writes the same mix to a WAV file for practice away from the browser.
- **Finger positions**: every fretted note in the tab carries a small finger number, and a gallery under the tab shows each part's positions per section as fretboard diagrams (chord shape held, strings picked, barre, base fret). The sidebar shows the positions of the section that is playing and highlights the one under the playhead.
- **Tools** (`tools.html`): a metronome (tempo slider and tap tempo, beats per bar, subdivisions, accent, space to start and stop), a chord dictionary (every root and the common qualities, drawn with finger numbers from the built-in library; click a shape to hear it), a fretboard chart with the note at every fret for standard tuning and the common alternatives (drop D, half step down, DADGAD, D A D F♯ B E, open G, bass; click a note to hear it, highlight a root and a scale, sharps or flats; the key and tuning chips on a song page open it with that scale and tuning selected), and a tuner (reference strings played with the same synthesis, or the microphone with a cents needle).
- **Offline**: a service worker keeps the pages, the tools and every song opened, so practice continues without a connection (the YouTube video excepted; tab playback works). Browsers without module workers (Firefox at the time of writing) simply stay online-only.
- **Printing**: the chords and tab views print on a light page without the header, video or controls.
- **Your songs**: a visitor adds song folders from their own disk (folder picker or drag and drop), checked and kept in the browser's IndexedDB, listed with a "yours" chip, opened through `song.html?id=<slug>&base=local`, removable from the card. Adding the same folder again is a sync: unchanged songs are left alone, changed ones updated in place (their date kept), and songs the folder no longer holds are offered for removal. Nothing leaves the browser.
- **Home page**: the collection sorted by artist (composers filed by surname where the curation says so), title, newest, key, tempo or length, with headings over each artist or key, a filter box, and the choice remembered and shareable as `?sort=`.
- **Two languages**: the whole interface in English or Simplified Chinese, switched from the header and remembered. Section names, part roles, tunings and keys from the song data are translated too; song titles and lyrics stay as written.

## Run it

Any static file server works; the scripts and tests need Node 18 or newer and Python 3.9 or newer, nothing else. From the project root:

```sh
make serve          # http://127.0.0.1:8123 (PORT=8080 for another port)
make test           # unit tests (node --test, plus python unittest for the importers, validator, index and chord detection)
make lint           # syntax check of every script
make validate                        # check every song folder against the data format
make index                           # rebuild data/songs.json from the song folders (and sitemap.xml + robots.txt once site.json has a url)
make example                         # copy examples/twelve-bar-blues into the collection
make report SONG=<slug> [TRACK=<id>] # print every computed finger position, per track and section
make propose SONG=<slug> TRACK=<id>   # chord-library voicings proposed from the shapes a track plays
make render SONG=<slug> FROM=11 TO=32 [MUTE=id,id] [SOUND=overdrive] [OUT=file.wav]   # the tab playback as a WAV
```

A song's page is `songs/<id>.html?view=tab|chords&track=<track>&source=video|tab&sound=<name>` (`make index` writes these; `song.html?id=<id>` opens the same page, and without `id` the first song in the index). The tools page takes `tools.html?root=<0-11>&scale=<major|minor|majorPent|minorPent|blues>&tuning=<standard|dropD|halfDown|dadgad|dadfbe|openG|bass>&names=<sharps|flats>#fretboard` to open the fretboard preset, `tools.html?chord=<name>#chords` opens the dictionary on that chord (every chord card in a chords view links there), and `#metronome`, `#chords`, `#tuner` jump to a tool. Keyboard: space plays and pauses, arrow keys step one bar. The playback source (video or tab audio) and the guitar sound are remembered. `?lang=zh` or `?lang=en` on any page picks the language (also remembered; the default follows the browser).

## Layout

```
index.html               song list
songs/<id>.html          one static page per song, written by make index from song.html: the URL to share, with its own title and Open Graph data
js/home.js               home page: song cards, the filter and the sort control
js/song-sort.js          the home page's sort orders and the artist and key grouping (pure functions)
js/local-songs.js        the visitor's own songs: reading a folder (picker, drop, file list), checking it, the IndexedDB store
song.html                song page (chords and tab views)
tools.html               metronome, fretboard note map, tuner
404.html                 not-found page (static hosts serve it for unknown paths)
manifest.webmanifest     name and icons for "add to home screen"
robots.txt, sitemap.xml  for crawlers (make index writes both once data/site.json has a url)
_headers                 security headers for Cloudflare Pages and Netlify
sw.js                    service worker: the app shell and every visited page and song, network first
icons/                   favicon (SVG and PNG), home-screen icons, the Open Graph card and its SVG source
css/styles.css           design tokens (dark and light), layout, tab and diagram styles
js/song-page.js          page controller: views, video sync, cursor, positions
js/tab-renderer.js       measure layout into systems and SVG rendering (pure functions)
js/fingering.js          positions and left-hand fingering (pure functions)
js/chord-library.js      built-in voicings (open chords, barre shapes) and the per-part library merge
js/site.js               data/site.json: site name, default language, home page texts, copyright line
js/offline.js            the service worker's shell list, request strategy and registration
js/chord-diagram.js      chord and position diagrams as SVG
js/chord-sheet.js        chords view
js/video-sync.js         YouTube player wrapper and bar clock
js/tab-audio.js          tab playback: tempo clock, note events, string synthesis, scheduler (pure parts run in Node)
js/dsp.js                biquads, FFT convolution, the synthesized room and the modal guitar body shared by the live graph and the offline render
js/i18n.js               English and Chinese strings, language toggle, translation of the song data's recurring words
js/tools.js              tools page controller
js/metronome.js          metronome scheduler and tap tempo
js/theory.js             note names, tunings, scales
js/fretboard.js          fretboard chart as SVG (pure function)
js/pitch.js              pitch detection for the tuner (pure function)
js/util.js               DOM helper, chord name formatting, storage, print theme
js/theme.js              applies the remembered theme, else the system's, before first paint (plain script in every page's head)
js/not-found.js          404.html controller
data/songs.json          song index for the home page
data/songs/<id>/         song.json, tracks/<track>.json, curation.json
private/songs/<id>/      the same, for songs this repository must never contain (`private` is ignored; a folder or a symlink to a private repository)
scripts/import-songsterr.py   the author's personal Songsterr importer, not a supported path (Python 3, standard library only)
scripts/chord_detect.py       chord detection for tabs without chord annotations
scripts/fingering-report.mjs  review tool for computed fingerings
scripts/songlib.py            what every importer shares: sections, tempo, chord timeline, sheets, writing
scripts/import-musicxml.py    MusicXML importer (Guitar Pro, MuseScore, TuxGuitar exports)
scripts/validate-song.py      checks a song folder against docs/song-format.md
scripts/build-index.py        rebuilds data/songs.json from the song folders
scripts/serve.py              development server (make serve): pages with or without their .html, 404.html for unknown paths, nothing cached
examples/twelve-bar-blues/    a song written by hand, the smallest complete example
data/site.json                site configuration
docs/song-format.md           the data format
scripts/propose-library.mjs   drafts chord-library voicings from a track's shapes
scripts/render-audio.mjs      renders the tab playback to a WAV file
tests/                   node --test suites (tests/helpers holds the fake AudioContext) and python unittest suites (tests/fixtures holds a MusicXML score)
Makefile, LICENSE        the commands above; MIT
```

Scripts run from the command line are kebab-case; the modules they import (`songlib.py`, `chord_detect.py`) are snake_case so Python can import them.

## Data

The full format is in [docs/song-format.md](docs/song-format.md). In short, `song.json` holds metadata, the tempo map (`tempo: [{ bar, pos, bpm, unit }]`, `bpm` per `unit` note as written, 2 for cut time; the top-level `bpm` is always in quarter notes), the video id and per-bar start times (`video.barTimes`, seconds), sections (`{ name, bar }`, 0-based), a chord timeline (`{ bar, pos, chord }`), the chord sheet (sections of lines: `{ segments: [{ chord, text }] }` for lyrics, or `{ type: "bars", bars: [{ bar, chords }] }` for a progression grid), the chord library, fingering overrides, and the track list (each part with its tuning, capo and optional `sound`, `level`, `fingering` and `chordLibrary`).

The chord timeline comes from the transcription's chord annotations when it has them. Otherwise `scripts/chord_detect.py` detects chords from the notes: duration-weighted pitch classes of the harmony tracks per bar (and per half bar), scored against chord templates, with the bass track (or the lowest note) deciding slash chords. When the song has a chord sheet, detection is restricted to the sheet's chord names so highlights line up; `chordVocabulary` in the curation file does the same for songs without one.

Each track file is a list of measures. A measure is `{ beats, marker?, sig? }`; a beat is:

```json
{ "d": [1, 8], "t": 8, "dots": 1, "tuplet": 3, "ts": true, "te": true,
  "rest": true, "ring": true, "chord": "Cm", "bs": true, "be": true, "stroke": "down",
  "notes": [{ "s": 5, "f": 8, "tie": true, "dead": true, "ghost": true,
              "hp": true, "slide": "up|down|above|below|legato|shift", "bend": 0.5 }] }
```

`d` is the duration as a fraction of a whole note, `t` the note value (1 to 64), `bs`/`be` beam start and stop, `ts`/`te` tuplet start and stop. Slides are `up`/`down` (out of the note), `above`/`below` (into it) or `legato`/`shift` (to the next note). String `s` is 0 for the highest string (high e, or G on bass); `f` is the fret.

### Adding a song

Two ways in, both ending in the same folder layout (`docs/song-format.md` has every field):

**From a MusicXML score.** Guitar Pro, MuseScore and TuxGuitar export it; MuseScore also opens `.gp` files, so any Guitar Pro tab can come in this way; `.mxl` works too.

```sh
make import FILE=<score.musicxml> SONG=<artist>-<title>
```

Every part with a tab staff or string numbers becomes a track; a part with lyrics feeds the generated chord sheet; chord symbols, rehearsal marks, tempo marks and time signatures are read. Repeats are not unfolded (export with repeats written out). `ARGS="--let-ring"` treats every note as let ring, for arpeggiated accompaniments whose file does not mark it.

Plain notation works too. A part without a tab staff is read as a guitar or bass when its name, instrument or MIDI program says so, when it is the score's only part, or when the curation file declares `strings` for it; its notes are then placed by hand position (open position and open strings first, a shift only when the hand must move). Several voices in a part are merged into one tab line, with a note held under the others marked let ring (`ARGS="--first-voice"` keeps voice 1 alone). Guitar parts are written an octave above their sound: MuseScore says so with `<transpose>` in the file, and a file that does not gets `transpose: -12` on the part in the curation file. The public-domain pieces in this repository came in this way from Mutopia Project editions.

Lyrics come from the part that carries them: one syllable per sung note (`begin`/`middle`/`end` syllabics join a word), a `<lyric>` with `<end-line/>` ends a line of the chord sheet (held notes after it stay on that line), a sung note without words holds the previous syllable, and a hyphenated word survives a held note inside it. String numbers alone do not shrink the instrument: a guitar-like part whose numbers stop at the 5th string is still a six-string guitar.

**By hand.** Write `song.json` and the track files (`examples/twelve-bar-blues/` is a complete one, two parts in fifteen kilobytes) and run `make index`.

### A private collection

Songs you may play but not publish (transcriptions of copyrighted songs, for instance) go under `private/songs/<slug>/`, the same layout as `data/songs/`. Git ignores `private`, so a deployment built from the repository never has them, while the local site lists them beside the public songs (their pages open through `song.html?id=<slug>&base=private`). To keep that collection under version control of its own, make `private` a symlink to a separate, private repository (the author's is `../nagori-songs`, holding `songs/` and the `songs.json` that `make index` writes). `make index` writes `private/songs.json` for them; `make validate`, `make report`, `make propose` and `make render` find a slug in either root; imports land there with `DEST=private/songs`. To serve them from the web, upload the folder directly (`wrangler pages deploy .`) to a second Pages project kept behind Cloudflare Access rather than connecting that project to git. Or skip the deployment: the public site's "Your songs" panel reads the same folders into the browser on any device.

Then, either way:

```sh
make validate SONG=<slug>        # checks the folder against docs/song-format.md (the test suite does this for every song)
make report SONG=<slug>          # the finger positions the site will show, per part and section
make propose SONG=<slug> TRACK=<id>   # drafts chord-library voicings from the shapes a part plays
```

A song in standard tuning needs no chord library of its own: the built-in one (open chords, E-form and A-form barre shapes for every root) gives it diagrams and library-quality fingerings. Curate voicings when the recording uses a particular shape, the tuning is not standard, or a chord is missing.

**curation.json**: put it next to the output before importing to add what the source does not carry, or to tune a song or a part:

- `album`, `year`, `key`, `duration`, `tuning` (label), `capo`, `defaultTrack`, `sortArtist` ("Bach, Johann Sebastian", for the home page's artist order), `added` (backdate the "Newest" order); for the MusicXML importer also `title` and `artist` (over the file's), `sourceName`, `sourceUrl` and `sourceLabel` (the credit line the song page's footer shows, for example the edition and its licence)
- `tempo`: a tempo map (`[{ bar, pos, bpm, unit }]`) when the source's is wrong; `bpm` overrides the quarter-note tempo
- `sections`: `{ name, bar }` when the source has no section markers
- `video`: `{ id, title, barTimes }` or `{ id, title, offset }` (bar times computed from the tempo map, `offset` being where bar 1 starts in the video)
- `chordVocabulary`: chord names detection may use when there are no chord labels or sheet; `harmonyTracks`: the parts detection listens to (default all); `chordTimelinePriority`: whose labels win
- `tracks`: per part (keyed by the part's id in the file, `P1`, its name, or its number, `"1"`), `{ id, name, role, capo, sound, level, fingering, chordLibrary, strings, tuning, transpose, vocal }`. `strings` and `tuning` (MIDI numbers, highest string first) make a plain notation part a guitar or bass, `transpose` shifts its written pitches (semitones, `-12` for a guitar part written an octave up), `vocal: true` keeps a part as the lyric line. The `sound` (`acoustic`, `electric`, `overdrive`, `nylon`, `muted`) is what the part plays with while the sound picker says "as set per part"; `level` (0 to 1) its starting volume; `fingering: { maxSpan }` the hand's reach; `chordLibrary` voicings only this part uses
- `letRing`: `true` or a list of part ids (MusicXML importer)
- `chordLibrary`: voicings low string to high (`"x35543"`, or `"8 10 10 8 8 8"` for two-digit frets) with fingers, written for the song's tuning; a chord may list several voicings, the first is the one the chords view draws
- `fingeringOverrides`: keyed by the position's note set (`"5:8,2:8,1:8"` as `string:fret` pairs, optionally prefixed `trackId|`), mapping each note to a finger

### The Songsterr importer

`scripts/import-songsterr.py` (`make import-songsterr ID=<song id> SONG=<slug> DEST=private/songs`) is how the author's private collection was made. It is the author's personal convenience and not a supported path: it reads Songsterr's undocumented endpoints, which can change or be blocked at any time and whose terms of use are yours to check, and what it pulls is a community transcription of a copyrighted song, for personal practice rather than redistribution. It takes the same `curation.json`, keyed by Songsterr part number under `tracks`, plus: `slug` (Songsterr's URL slug when it differs from artist-title), `includeTracks` (part numbers to import; default every guitar and bass), `timelineOnlyTracks` (parts fetched only for their chord labels), `lyricsTrack`, `videoTitle`, `chordSheetTranspose` and `preferSharps`, `chordAliases` (`"E6": "Em6"`), `mergeSlashPairs` (`[["Dm", "F"]]`), `chordSheetSections` (`{ name, fromLine }` breaks over the imported sheet). Its video sync points come from Songsterr when it has them.

### How fingerings are computed

`js/fingering.js` cuts each track into positions: runs of beats whose fretted notes fit under one hand (at most four frets), splitting when a chord label changes and the beat adds notes, or when a ringing string would need two different frets. Each position is fingered from an override if one exists, else from the chord library when a voicing for the position's chord holds its notes (up to two passing notes on the voicing's open or muted strings may join, as long as they are inside the hand span and take a finger the chord is not using on another fret; a position made only of passing notes is not a match), else by a small solver: a barre where three or more notes share the lowest fret (or two with other fingers working inside the span), then one finger per fret with a cost for deviations. Melodic runs without let-ring use positional fingering. The solver fingers from a hand position: it stays where the previous position left the hand when the new notes fit under it, uses first position (finger equals fret) when open strings ring and nothing goes above the 4th fret, and otherwise puts the index finger on the lowest note. Library voicings with an impossible fingering (one finger on two frets) are ignored, and a test checks every song's library. `make report` prints the result for review; anything odd gets an entry in `fingeringOverrides`.

### Translations

Every interface string lives in `js/i18n.js` as a key with an English and a Chinese text; `t(key, params)` fills `{placeholders}`. A test checks that both dictionaries have the same keys and placeholders. Words that recur in the song data (section markers such as Verse and Chorus, part roles, tuning and key names) are translated by small maps in the same file; anything unknown is shown as written. Static text in the HTML shells is marked with `data-i18n` attributes. Switching the language stores the choice and reloads the page, since the page state is in the URL.

### How the tab is played

`js/tab-audio.js` turns the tracks into note events on a clock built from the tempo map and each bar's time signature: a tied note extends the note it continues, a let-ring note sounds until its string is plucked again, a pluck cuts whatever the string was playing, strummed chords are staggered by a few milliseconds. Each event also carries the nuance of a hand, the same on every build: a beat lands a few milliseconds early or late, a note is struck a little lighter or not, and plucks of one string alternate between two renderings of the pitch, so no two notes are the same samples. Each rendering is a Karplus-Strong string computed once per song. The excitation is one period of the ideal pluck, the rectangular force pulse a released string puts on the bridge, with the roughness of the pick's release (noise) mixed over it; both are comb-filtered by the pick position (a pluck a fifth of the way along the string cannot excite every fifth harmonic) and the pulse rises above 300 Hz, as the top plate radiates the upper partials better than the fundamentals. It feeds a fractional delay line with a weighted two-point loop filter and, for nylon, an extra low-pass in the loop, losing 60 dB in a few seconds (longer for low notes and for the bass); the loop filters' phase delay is taken off the delay line, so every note is in tune to a cent. The string starts a few cents sharp and settles over its first tenth of a second (a hard pluck stretches it), a second string a few cents away and decaying faster is mixed in (the slow shimmer of a real string's two polarizations), and a few milliseconds of dull noise over the attack are the pick's contact. Hammer-ons, ghost notes and the arrival of a slide play a softer layer: darker, with less glide and less pick noise. Muted notes are a short dull burst. A lookahead scheduler places the next 400 ms of notes on the Web Audio clock, re-anchoring on seeks, speed changes and loop wraps, so the playhead reads the same clock as the audio. Bends and slides are playback-rate ramps.

The guitar sound is a preset over the same string model (`SOUNDS` in `js/tab-audio.js`): brightness, grit, pick noise and pitch glide of the pluck, its pick position, the loop's damping and low-pass, the detune of the second string, a multiplier on the decay time, and for overdrive a soft clipper (tanh) followed by a 3.2 kHz low-pass on the part's bus, so a chord distorts as a whole rather than note by note. Each part then sounds through the body of its instrument (`BODIES`): an acoustic box is a modal impulse response in a ConvolverNode, the air resonance and the first top-plate mode ringing on under every note (the thump of an acoustic guitar) and a dozen narrower modes above them overlapping into the hills of a real body's response, followed by a few biquads; an electric pickup's presence peak and a bass cabinet are biquads only. Every part sends a little of itself into one shared room, a synthesized impulse response (early reflections, then a velvet-noise tail) in a second ConvolverNode. `js/dsp.js` holds the biquads, the FFT convolution, the body and the room, and the offline render in `scripts/render-audio.mjs` runs the same coefficients and the same responses, so a WAV sounds like the browser (minus the compressor). The bass keeps its own timbre. The tools page plays through the acoustic chain.

## Deployment

Static hosting, nothing to build: upload the folder, or point GitHub Pages, Cloudflare Pages or Netlify at the repository. Every path is relative, so the site works from a sub-path too. Before the first deploy:

- Set `url` in `data/site.json` to the site's address (this copy: `https://guitar.luminoid.dev`) and run `make index`: it writes `sitemap.xml` and `robots.txt` for that address (robots.txt only counts at a domain's root; on a sub-path host submit the sitemap directly). `copyright` in the same file is the line every footer ends with.
- The song pages that `make index` writes carry canonical, hreflang, `og:url` and `og:image` links for the `url` in `site.json`, plus structured data. `index.html` and `tools.html` carry the same site-wide tags by hand (`og:image` points at `icons/og.png`, a 1200×630 card whose source is `icons/og.svg`); a fork changes those addresses along with the name.
- `_headers` holds the security headers for Cloudflare Pages and Netlify: a content security policy that allows the YouTube IFrame API and player and no inline scripts (the theme bootstrap is `js/theme.js` for that reason), and a permissions policy that keeps the microphone available to the tuner. Other hosts set the same headers their own way, or go without.
- Cloudflare Pages and GitHub Pages serve `song.html` at `/song` and `songs/<id>.html` at `/songs/<id>` (Cloudflare redirects the `.html` form there). Set `cleanUrls` to true in `data/site.json` for such a host and run `make index`: the pages' links, the canonical and hreflang addresses, the structured data and the sitemap then use the short form, and the `_headers` rule that keeps `song` out of search results covers both spellings. `tools.html` carries its canonical tags by hand, so drop the `.html` there too. Leave `cleanUrls` off for a host that serves only the file names; `make serve` handles both forms, like those hosts.
- Hosts cache scripts and styles in the browser as they see fit (Cloudflare's zone default keeps them for four hours, over the `_headers` rules), so after a deploy a returning visitor could run an old script against a new page. The service worker makes that a non-issue: on a live host it serves the app shell (the pages, scripts, styles and icons) from its own cache, filled past the browser's cache when it installs, and after a navigation it fetches the whole shell again, at most once every five minutes, and swaps the set in together. A deploy reaches a returning visitor on their next navigation after that check; the song index and song data are always fetched first. No host setting is needed; the `_headers` cache rules only serve browsers without service workers.
- Cloudflare Web Analytics, when enabled on the Pages project, injects a beacon script; the content security policy allows it and nothing else from outside the site and YouTube.
- The tuner's microphone needs HTTPS, which the hosts above provide.
- Those hosts serve `404.html` for unknown paths. Its links and assets are relative, right for a site at the domain root; a fork under a sub-path adds `<base href="/that-path/">` to it (an inline stylesheet keeps the page readable either way).
- `sw.js` is the service worker (browsers fetch it past their cache, so the `no-cache` rule in `_headers` is a courtesy). It keeps every page under its path without the `.html`, so a page reached either way is answered offline on any host, and on localhost it fetches everything from the network first so an edit shows on the next reload. After adding a file to the shell list in `js/offline.js`, bump `CACHE` there so old copies are dropped (the test suite checks that every module the pages import is on the list).
- The content security policy allows no inline styles except the small block in `404.html`, which it names by hash; after editing that block, run `make test` and copy the hash the failing test prints into `_headers`.

## Credits and licensing

The code is MIT licensed (see LICENSE). Song data is separate from the code. The songs in this repository are public-domain compositions, imported from these editions and credited in each song page's footer:

- *Adelita* (Francisco Tárrega): Mutopia Project edition typeset by Stewart Holmes, CC BY-SA 2.5.
- *Op. 50 No. 1* (Mauro Giuliani): Mutopia Project edition typeset by Stephen Rhen, CC BY 3.0.
- *Op. 60 No. 3* (Fernando Sor): Mutopia Project edition typeset by Fabrice De Volder, CC BY-SA 3.0.
- *Greensleeves* (Traditional): melody and bass line from the Mutopia Project hymntune setting typeset by Steve Dunlop, public domain.
- *Spanish Romance (Romanza)* (Anonymous): Mutopia Project edition typeset by Jeff Covey, CC BY-SA 2.5.
- *Bourrée in E minor, BWV 996* (Johann Sebastian Bach): Mutopia Project edition typeset by Rudy Matela, public domain.
- *Prelude in D minor, BWV 999* (Johann Sebastian Bach): Mutopia Project edition typeset by Jakob Bagterp, public domain.
- *Minuet in G, BWV Anh. 114* (Christian Petzold, attributed to J. S. Bach): Mutopia Project edition typeset by Yannick Kirschhoffer, public domain.
- *Lágrima* (Francisco Tárrega): Mutopia Project edition typeset by Jeffrey Olson, public domain (J. J. Olson's guitar-duo arrangement, merged back into one guitar part).
- *Recuerdos de la Alhambra* (Francisco Tárrega): Mutopia Project edition typeset by Stewart Holmes, CC BY-SA 3.0.
- *Capricho Árabe* (Francisco Tárrega): Mutopia Project edition typeset by Glen Larsen, CC BY-SA 4.0.
- *Op. 35 No. 22* (Fernando Sor): Mutopia Project edition typeset by Glen Larsen, CC BY-SA 3.0.
- *Op. 60 No. 3* and *Op. 60 No. 7* (Matteo Carcassi): Mutopia Project editions typeset by Jeff Covey, public domain.
- *Amazing Grace* (Traditional): arranged for this repository; words by John Newton (1779), tune New Britain (1835), public domain.
- *Scarborough Fair* (Traditional): arranged for this repository; traditional English ballad, public domain.
- *House of the Rising Sun* (Traditional): arranged for this repository; traditional American folk song, the melody of the 1930s recordings, public domain.
- *Auld Lang Syne* (Traditional): arranged for this repository; words by Robert Burns (1788), traditional Scots tune, public domain.
- *Silent Night* (Franz Xaver Gruber): arranged for this repository; music 1818, English words by John Freeman Young (1859), public domain.
- *Danny Boy* (Traditional): arranged for this repository; tune Londonderry Air (published 1855), words by Frederic Weatherly (1913), public domain.
- *When the Saints Go Marching In* (Traditional): arranged for this repository; traditional gospel hymn, public domain.
- *Ode to Joy* (Ludwig van Beethoven): arranged for this repository; the theme of the Ninth Symphony's finale (1824), public domain.
- *Happy Birthday to You* (Patty and Mildred Hill): arranged for this repository; the melody of Good Morning to All (1893), public domain.
- *Twelve-Bar Blues in E*: written for this repository, MIT like the code.

The arrangements made here (melody guitar, open-chord rhythm guitar and the lyric line) are MIT like the code; the words and tunes they set are public domain.

Song data derived from a CC BY-SA edition is shared under the same licence; the rest is MIT. Transcriptions of copyrighted songs belong in `private/`, which git ignores; the author's own collection lives there. A fork brings its own songs and is responsible for them.
