PORT ?= 8123
SONG ?=
DEST ?= data/songs   # where imports land: data/songs (public, committed) or private/songs (ignored by git)

.PHONY: serve test report propose render import import-songsterr validate index example lint need-song

# Targets that work on one song take SONG=<slug> (a folder under data/songs or private/songs).
need-song:
	@test -n "$(SONG)" || { echo "usage: make $(MAKECMDGOALS) SONG=<slug>   (folders: $$(ls data/songs private/songs 2>/dev/null | grep -v ':' | tr '\n' ' '))"; exit 1; }

serve:
	python3 -m http.server $(PORT) --bind 127.0.0.1

test:
	node --test tests/*.test.mjs
	PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests -p 'test_*.py'

report: need-song
	node scripts/fingering-report.mjs $(SONG) $(TRACK)

# Propose chord-library voicings from the shapes a track plays: make propose SONG=<slug> TRACK=<id>
propose: need-song
	@test -n "$(TRACK)" || { echo "usage: make propose SONG=<slug> TRACK=<track id>"; exit 1; }
	node scripts/propose-library.mjs $(SONG) $(TRACK)

# Render the tab to a WAV file: make render SONG=<slug> FROM=<bar> TO=<bar> [OUT=file.wav] [MUTE=id,id] [SOUND=overdrive]
FROM ?= 1
TO ?=
OUT ?=
MUTE ?=
SOUND ?=
render: need-song
	node scripts/render-audio.mjs $(SONG) $(FROM) $(TO) $(if $(OUT),--out $(OUT),) $(if $(MUTE),--mute $(MUTE),) $(if $(SOUND),--sound $(SOUND),)

# Import a MusicXML score (Guitar Pro, MuseScore, TuxGuitar exports): make import FILE=score.musicxml SONG=<slug> [ARGS="--let-ring"] [DEST=private/songs]
FILE ?=
ARGS ?=
import: need-song
	@test -n "$(FILE)" || { echo "usage: make import FILE=<score.musicxml|.mxl> SONG=<slug> [ARGS=\"--let-ring\"]"; exit 1; }
	python3 scripts/import-musicxml.py "$(FILE)" --out $(DEST)/$(SONG) $(ARGS)

# The author's own convenience, not a supported path: pulls a Songsterr transcription through undocumented
# endpoints (may break or be blocked, check their terms; the result is for personal practice, not redistribution).
ID ?=
import-songsterr: need-song
	@test -n "$(ID)" || { echo "usage: make import-songsterr ID=<songsterr song id> SONG=<slug>"; exit 1; }
	python3 scripts/import-songsterr.py $(ID) --out $(DEST)/$(SONG)

# Check song folders against docs/song-format.md: make validate [SONG=<slug>]
validate:
	python3 scripts/validate-song.py $(SONG)

# Rebuild data/songs.json (the home page listing) and the song pages from the song folders; run after adding a song by hand or removing one.
# With a url in data/site.json it also writes sitemap.xml and robots.txt; private/songs gets private/songs.json.
index:
	python3 scripts/build-index.py

# Copy the hand-written example song into the collection, to see the format working
example:
	cp -R examples/twelve-bar-blues data/songs/ && python3 scripts/build-index.py

lint:
	@for f in js/*.js sw.js scripts/*.mjs tests/*.mjs; do node --check $$f || exit 1; done; echo "syntax ok"
