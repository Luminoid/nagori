"""The MusicXML importer and the shared song assembly, on a hand-written score (tests/fixtures/riff.musicxml)."""

import importlib.util
import json
import re
import shutil
import sys
import tempfile
import unittest
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
from songlib import assemble_song, bar_times_from_tempo, lyric_syllables, write_song  # noqa: E402

spec = importlib.util.spec_from_file_location("import_musicxml", ROOT / "scripts" / "import-musicxml.py")
musicxml = importlib.util.module_from_spec(spec)
spec.loader.exec_module(musicxml)
validator_spec = importlib.util.spec_from_file_location("validate_song", ROOT / "scripts" / "validate-song.py")
validator = importlib.util.module_from_spec(validator_spec)
validator_spec.loader.exec_module(validator)

FIXTURE = ROOT / "tests" / "fixtures" / "riff.musicxml"


class ImportMusicXMLTest(unittest.TestCase):
    def setUp(self):
        self.root = musicxml.read_score(FIXTURE)
        self.tracks, self.vocal, self.title, self.artist, self.warnings = musicxml.import_score(self.root, {}, filename=str(FIXTURE))

    def test_first_voice_option_skips_the_other_voices(self):
        tracks, _, _, _, warnings = musicxml.import_score(self.root, {}, filename=str(FIXTURE), first_voice=True)
        beats = tracks[0]["measures"][1]["beats"]
        self.assertEqual(beats[0]["notes"], [{"s": 1, "f": 0, "tie": True}])
        self.assertFalse(beats[0].get("ring"))
        self.assertIn("extra voices were skipped", " ".join(warnings))

    def test_plain_notation_becomes_a_guitar_placed_by_hand_position(self):
        def note(step, octave, duration=1, chord=False):
            return f"<note>{'<chord/>' if chord else ''}<pitch><step>{step}</step><octave>{octave}</octave></pitch><duration>{duration}</duration><type>quarter</type></note>"
        run = [("G", 3), ("A", 3), ("B", 3), ("C", 4), ("D", 4), ("E", 4), ("F", 4), ("G", 4)]  # sounding pitches: open position
        bar1 = "".join(note(s, o) for s, o in run[:4])
        bar2 = "".join(note(s, o) for s, o in run[4:])
        bar3 = note("C", 3, 4) + note("E", 3, 4, chord=True) + note("G", 3, 4, chord=True) + note("C", 4, 4, chord=True) + note("E", 4, 4, chord=True)
        bar4 = "".join(note(s, o) for s, o in (("A", 4), ("B", 4), ("C", 5), ("D", 5)))
        bar5 = note("C", 4, 4) + note("E", 4, 4, chord=True) + note("G", 4, 4, chord=True) + note("C", 5, 4, chord=True) + note("E", 5, 4, chord=True)  # written an octave up
        xml = f"""<score-partwise><part-list><score-part id="P1"><part-name>Guitar</part-name><midi-instrument id="P1-I1"><midi-program>25</midi-program></midi-instrument></score-part></part-list>
        <part id="P1"><measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>{bar1}</measure>
        <measure number="2">{bar2}</measure><measure number="3">{bar3}</measure><measure number="4">{bar4}</measure><measure number="5"><attributes><transpose><chromatic>0</chromatic><octave-change>-1</octave-change></transpose></attributes>{bar5}</measure></part></score-partwise>"""
        root = musicxml.ET.fromstring(xml)
        tracks, _, _, _, warnings = musicxml.import_score(root, {}, filename="plain.musicxml")
        self.assertEqual(len(tracks), 1)
        self.assertEqual((tracks[0]["strings"], tracks[0]["tuning"], tracks[0]["kind"]), (6, [64, 59, 55, 50, 45, 40], "guitar"))
        self.assertTrue(any("read as a six-string guitar" in w for w in warnings))
        notes = [n for m in tracks[0]["measures"][:2] for b in m["beats"] for n in b["notes"]]
        self.assertEqual([(n["s"], n["f"]) for n in notes], [(2, 0), (2, 2), (1, 0), (1, 1), (1, 3), (0, 0), (0, 1), (0, 3)], "a run in the open position, open strings included")
        chord_notes = tracks[0]["measures"][2]["beats"][0]["notes"]
        self.assertEqual(sorted((n["s"], n["f"]) for n in chord_notes), [(0, 0), (1, 1), (2, 0), (3, 2), (4, 3)], "the open C shape, one string per note")
        high = [n for b in tracks[0]["measures"][3]["beats"] for n in b["notes"]]
        self.assertTrue(all(n["s"] <= 1 for n in high) and max(n["f"] for n in high) - min(n["f"] for n in high) <= 6, "a high phrase stays around one position on the top strings")
        self.assertFalse(any("_midi" in n for m in tracks[0]["measures"] for b in m["beats"] for n in b["notes"]))
        self.assertEqual(sorted((n["s"], n["f"]) for n in tracks[0]["measures"][4]["beats"][0]["notes"]), [(0, 0), (1, 1), (2, 0), (3, 2), (4, 3)], "a written-pitch part with <transpose> octave-change -1 sounds an octave lower")

    def test_curation_can_name_a_part_by_number_and_transpose_it(self):
        note = lambda step, octave: f"<note><pitch><step>{step}</step><octave>{octave}</octave></pitch><duration>1</duration><type>quarter</type></note>"
        xml = f"""<score-partwise><part-list><score-part id="Pabc"><part-name></part-name></score-part></part-list><part id="Pabc"><measure number="1"><attributes><divisions>1</divisions><time><beats>2</beats><beat-type>4</beat-type></time></attributes>{note('E', 5)}{note('B', 4)}</measure></part></score-partwise>"""
        tracks, _, _, _, warnings = musicxml.import_score(musicxml.ET.fromstring(xml), {"tracks": {"1": {"id": "guitar", "name": "Guitar", "transpose": -12}}}, filename="x.musicxml")
        self.assertEqual(tracks[0]["id"], "guitar", "the only part, keyed by its number, becomes a guitar")
        self.assertEqual([(n["s"], n["f"]) for b in tracks[0]["measures"][0]["beats"] for n in b["notes"]], [(0, 0), (1, 0)], "E5 and B4 written an octave high land on the open strings")

    def test_parts_tunings_and_metadata(self):
        self.assertEqual((self.title, self.artist), ("Test Riff", "Fixture Band"))
        self.assertEqual([t["id"] for t in self.tracks], ["electric-guitar", "bass"])
        guitar, bass = self.tracks
        self.assertEqual(guitar["tuning"], [64, 59, 55, 50, 45, 40])
        self.assertEqual((guitar["strings"], guitar["capo"], guitar["kind"]), (6, 2, "guitar"))
        self.assertEqual((bass["strings"], bass["tuning"], bass["kind"]), (4, [43, 38, 33, 28], "bass"))
        self.assertEqual(guitar["tempo"], [{"bar": 0, "pos": 0.0, "bpm": 120, "unit": 4}])
        self.assertIn("voices were merged", " ".join(self.warnings))

    def test_beats_notes_and_marks(self):
        guitar = self.tracks[0]
        bar1, bar2 = guitar["measures"]
        self.assertEqual(bar1["sig"], [4, 4])
        self.assertEqual(bar1["marker"], "Intro")
        self.assertEqual(bar2["marker"], "Verse")
        beats = bar1["beats"]
        self.assertEqual(beats[0]["chord"], "Em")
        self.assertEqual(beats[0]["notes"], [{"s": 5, "f": 0}, {"s": 4, "f": 2}])
        self.assertEqual(beats[0]["d"], [1, 4])
        self.assertEqual((beats[1]["t"], beats[1].get("bs")), (8, True))
        self.assertTrue(beats[1]["notes"][0]["hp"])
        self.assertEqual(beats[2].get("be"), True)
        self.assertEqual((beats[3]["d"], beats[3]["dots"]), ([3, 8], 1))
        self.assertTrue(beats[4]["rest"])
        beats = bar2["beats"]
        self.assertEqual(beats[0]["chord"], "Bb/D")
        self.assertTrue(beats[0]["notes"][0]["tie"])
        self.assertTrue(beats[1]["notes"][0]["dead"])
        self.assertEqual(beats[2]["notes"][0]["bend"], 1.0)
        self.assertEqual(beats[3]["notes"][0]["slide"], "legato")
        self.assertTrue(beats[4]["ring"])
        self.assertEqual(len(beats), 5, "the second voice adds no beats of its own")
        self.assertEqual(beats[0]["notes"], [{"s": 1, "f": 0, "tie": True}, {"s": 3, "f": 2}], "the whole note of the second voice joins the first beat")
        self.assertTrue(beats[0].get("ring"), "and is held under the notes that follow")
        self.assertFalse(beats[1].get("ring"))
        bass = self.tracks[1]
        self.assertEqual(bass["measures"][1]["beats"][0]["notes"], [{"s": 2, "f": 0}], "a note without a string number is placed by hand position (open A here)")

    def test_vocal_part_feeds_the_generated_sheet(self):
        self.assertEqual(self.vocal["lyrics"], "Knives-out catch the")
        self.assertEqual(lyric_syllables(self.vocal["lyrics"]), [[("Knives", True), ("out", False), ("catch", False), ("the", False)]])
        song = assemble_song(slug="fixture-band-test-riff", title=self.title, artist=self.artist, tracks=self.tracks, curation={}, source={"name": "MusicXML", "url": None}, vocal=self.vocal)
        self.assertEqual(song["sections"], [{"name": "Intro", "bar": 0}, {"name": "Verse", "bar": 1}])
        self.assertEqual(song["chordTimeline"], [{"bar": 0, "pos": 0.0, "chord": "Em"}, {"bar": 1, "pos": 0.0, "chord": "Bb/D"}])
        self.assertEqual((song["bpm"], song["capo"], song["bars"]), (120, 2, 2))
        self.assertTrue(song["chordSheet"]["generated"])
        first_line = song["chordSheet"]["sections"][0]["lines"][0]
        self.assertEqual(first_line["segments"][0], {"chord": "Em", "text": "Knivesout "})  # syllables of a word are joined
        self.assertEqual(song["tracks"][0]["file"], "tracks/electric-guitar.json")

    def test_a_held_note_inside_a_word_keeps_the_word_together(self):
        self.assertEqual(lyric_syllables("call- _ ing _ so"), [[("call", True), ("", True), ("ing", False), ("", False), ("so", False)]])
        self.assertEqual(lyric_syllables("Or-_ leans"), [[("Or", True), ("", True), ("leans", False)]])

    def test_a_guitar_with_partial_string_numbers_keeps_six_strings(self):
        score_part = ET.fromstring('<score-part id="P1"><part-name>Rhythm</part-name><midi-instrument id="P1-I1"><midi-program>26</midi-program></midi-instrument></score-part>')
        part = ET.fromstring('<part id="P1"><measure number="1"><note><pitch><step>D</step><octave>3</octave></pitch><duration>4</duration><type>quarter</type><notations><technical><string>4</string><fret>0</fret></technical></notations></note></measure></part>')
        strings, tuning, capo, kind, *_ = musicxml.part_setup(part, score_part)
        self.assertEqual((strings, kind, tuning), (6, "guitar", [64, 59, 55, 50, 45, 40]))
        bass_part = ET.fromstring('<score-part id="P2"><part-name>Bass</part-name></score-part>')
        strings, tuning, capo, kind, *_ = musicxml.part_setup(part, bass_part)
        self.assertEqual((strings, kind), (4, "bass"))

    def test_lyric_line_breaks_come_from_end_line(self):
        text = FIXTURE.read_text().replace("<text>out</text></lyric>", "<text>out</text><end-line/></lyric>")
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "riff.musicxml"
            path.write_text(text)
            _, vocal, *_ = musicxml.import_score(musicxml.read_score(path), {}, filename=str(path))
        self.assertEqual(vocal["lyrics"], "Knives-out \ncatch the")
        self.assertEqual([len(line) for line in lyric_syllables(vocal["lyrics"])], [2, 2])

    def test_curation_per_part_settings_and_video(self):
        curation = {
            "tracks": {"P1": {"id": "lead", "name": "Jonny", "role": "Lead guitar", "sound": "overdrive", "level": 0.8, "fingering": {"maxSpan": 4}}},
            "video": {"id": "abc123", "offset": 1.5},
            "key": "E minor",
        }
        tracks, vocal, title, artist, _ = musicxml.import_score(self.root, curation, filename=str(FIXTURE))
        song = assemble_song(slug="x", title=title, artist=artist, tracks=tracks, curation=curation, source={"name": "MusicXML", "url": None}, vocal=vocal)
        lead = song["tracks"][0]
        self.assertEqual((lead["id"], lead["name"], lead["role"], lead["sound"], lead["level"], lead["fingering"]), ("lead", "Jonny", "Lead guitar", "overdrive", 0.8, {"maxSpan": 4}))
        self.assertEqual(song["video"], {"provider": "youtube", "id": "abc123", "title": None, "barTimes": [1.5, 3.5]})
        self.assertEqual(song["key"], "E minor")

    def test_written_song_validates_and_mxl_reads(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "data" / "songs"
            out = root / "fixture-band-test-riff"
            out.mkdir(parents=True)
            song = assemble_song(slug=out.name, title=self.title, artist=self.artist, tracks=self.tracks, curation={}, source={"name": "MusicXML", "url": None}, vocal=self.vocal)
            write_song(out, song, self.tracks, {})
            self.assertEqual(validator.validate_song(out), [])
            self.assertEqual(validator.validate_all(root), [])
            index = json.loads((root.parent / "songs.json").read_text())
            self.assertEqual([row["id"] for row in index], ["fixture-band-test-riff"])
            mxl = Path(tmp) / "riff.mxl"
            with zipfile.ZipFile(mxl, "w") as archive:
                archive.writestr("META-INF/container.xml", '<container><rootfiles><rootfile full-path="riff.musicxml"/></rootfiles></container>')
                archive.writestr("riff.musicxml", FIXTURE.read_text())
            self.assertEqual(musicxml.read_score(mxl).tag, "score-partwise")


class SongLibTest(unittest.TestCase):
    def test_bar_times_follow_signatures_and_tempo_changes(self):
        measures = [{"beats": [], "sig": [4, 4]}, {"beats": [], "sig": [3, 4]}, {"beats": []}, {"beats": []}]
        tempo = [{"bar": 0, "pos": 0, "bpm": 120, "unit": 4}, {"bar": 3, "pos": 0, "bpm": 60, "unit": 4}]
        times, end = bar_times_from_tempo(measures, tempo, offset=1.0)
        self.assertEqual(times, [1.0, 3.0, 4.5, 6.0])
        self.assertEqual(end, 9.0)
        times, end = bar_times_from_tempo([{"beats": [], "sig": [2, 2]}], [{"bar": 0, "pos": 0, "bpm": 92, "unit": 2}])
        self.assertAlmostEqual(end, 60 / 92 * 2, places=3)


class ValidatorTest(unittest.TestCase):
    def test_every_song_in_the_repo_is_valid(self):
        self.assertEqual(validator.validate_all(ROOT / "data" / "songs"), [])

    def test_problems_are_named(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp) / "bad-song"
            (folder / "tracks").mkdir(parents=True)
            song = {
                "id": "other", "title": "", "artist": "X", "bars": 1, "timeSignature": [4, 4], "sections": [{"name": "A", "bar": 3}],
                "chordTimeline": [], "chordLibrary": {"Em": {"frets": "022000", "fingers": "012020"}},
                "fingeringOverrides": {"nope": {}}, "defaultTrack": "ghost", "video": {"id": "v", "barTimes": [0, 1]},
                "tracks": [{"id": "Lead!", "name": "L", "kind": "guitar", "strings": 6, "tuning": [64, 59, 55, 50, 45, 40], "sound": "banjo", "level": 2, "file": "tracks/lead.json"}],
            }
            (folder / "song.json").write_text(json.dumps(song))
            track = {"id": "lead", "strings": 6, "tuning": [64, 59, 55, 50, 45, 40], "measures": [{"beats": [{"d": [1, 4], "t": 5, "notes": [{"s": 6, "f": 2}]}, {"d": [1, 1], "t": 1, "notes": [{"s": 0, "f": 0}]}]}]}
            (folder / "tracks" / "lead.json").write_text(json.dumps(track))
            problems = "\n".join(validator.validate_song(folder))
            for expected in ("should match the folder name", "title is required", "out of range", "finger on the open string", "fingeringOverrides key", "defaultTrack", "barTimes must have one start time per bar", "lower-case letters", "sound must be one of", "level must be between", "differs from song.json", "t must be one of", "string 6 outside", "longer than a 4/4 bar"):
                self.assertIn(expected, problems)


if __name__ == "__main__":
    unittest.main()


class IndexAndExamplesTest(unittest.TestCase):
    def test_build_index_keeps_order_appends_new_and_drops_removed(self):
        from songlib import build_index

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "data" / "songs"
            for slug, title in (("b-song", "B"), ("a-song", "A")):
                (root / slug / "tracks").mkdir(parents=True)
                (root / slug / "song.json").write_text(json.dumps({"id": slug, "title": title, "artist": "X", "bars": 1, "tracks": [], "video": None}))
            (root.parent / "songs.json").write_text(json.dumps([{"id": "b-song"}, {"id": "gone"}]))
            rows = build_index(root)
            self.assertEqual([r["id"] for r in rows], ["b-song", "a-song"], "listed order first, then new folders by name, removed rows dropped")
            self.assertTrue(all(re.fullmatch(r"\d{4}-\d\d-\d\d", r["added"]) for r in rows), "every row records the day it joined")
            first_added = rows[0]["added"]
            (root / "a-song" / "curation.json").write_text(json.dumps({"duration": "1:23", "sortArtist": "Song, A", "added": "2020-01-02"}))
            rows = build_index(root)
            self.assertEqual([r["id"] for r in rows], ["b-song", "a-song"])
            self.assertEqual((rows[1]["duration"], rows[1]["artistSort"], rows[1]["added"]), ("1:23", "Song, A", "2020-01-02"))
            self.assertEqual(rows[0]["added"], first_added, "a rebuild keeps the recorded day")
            self.assertNotIn("artistSort", rows[0])
            self.assertEqual(json.loads((root.parent / "songs.json").read_text())[0]["title"], "B")

    def test_build_index_writes_sitemap_and_robots_when_the_site_has_a_url(self):
        from songlib import build_index, robots_txt

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "data" / "songs"
            (root / "my-song" / "tracks").mkdir(parents=True)
            (root / "my-song" / "song.json").write_text(json.dumps({"id": "my-song", "title": "T", "artist": "X", "bars": 1, "tracks": [], "video": None}))
            build_index(root)
            self.assertFalse((Path(tmp) / "sitemap.xml").exists(), "no site.json, no sitemap")
            (root.parent / "site.json").write_text(json.dumps({"name": "F", "url": "https://example.com/tabs/"}))
            build_index(root)
            sitemap = (Path(tmp) / "sitemap.xml").read_text()
            for loc in ("https://example.com/tabs/", "https://example.com/tabs/tools.html", "https://example.com/tabs/song.html?id=my-song"):
                self.assertIn(f"<loc>{loc}</loc>", sitemap)
            self.assertEqual((Path(tmp) / "robots.txt").read_text(), "User-agent: *\nAllow: /\nDisallow: /private/\nSitemap: https://example.com/tabs/sitemap.xml\n")
            self.assertEqual(robots_txt(""), "User-agent: *\nAllow: /\nDisallow: /private/\n")

    def test_build_index_writes_a_page_per_song_from_the_template(self):
        from songlib import build_index, song_page_html

        with tempfile.TemporaryDirectory() as tmp:
            top = Path(tmp)
            root = top / "data" / "songs"
            shutil.copytree(ROOT / "examples" / "twelve-bar-blues", root / "twelve-bar-blues")
            shutil.copy(ROOT / "song.html", top / "song.html")
            (root.parent / "site.json").write_text(json.dumps({"name": "Tabs", "url": ""}))
            build_index(root)
            page = (top / "songs" / "twelve-bar-blues.html").read_text()
            self.assertIn('<base href="../">', page)
            self.assertIn('data-song="twelve-bar-blues"', page)
            self.assertIn("<title>Twelve-Bar Blues in E · Traditional · Tabs</title>", page)
            self.assertIn('"@type": "MusicComposition"', page)
            self.assertNotIn("canonical", page)
            self.assertNotIn('href="#app"', page, "the skip link must not resolve against <base>")
            (root.parent / "site.json").write_text(json.dumps({"name": "Tabs", "url": "https://tabs.example.com/"}))
            build_index(root)
            page = (top / "songs" / "twelve-bar-blues.html").read_text()
            self.assertIn('<link rel="canonical" href="https://tabs.example.com/songs/twelve-bar-blues.html">', page)
            self.assertIn('hreflang="zh-Hans"', page)
            self.assertIn("<loc>https://tabs.example.com/songs/twelve-bar-blues.html</loc>", (top / "sitemap.xml").read_text())
            self.assertIn('<link rel="modulepreload" href="../js/tab-audio.js">', page, "preload links resolve against the page's folder, not <base>")
            self.assertIn('href="songs/twelve-bar-blues.html#app"', page)
            (root.parent / "site.json").write_text(json.dumps({"name": "Tabs", "url": "https://tabs.example.com/", "cleanUrls": True}))
            build_index(root)
            page = (top / "songs" / "twelve-bar-blues.html").read_text()
            self.assertIn('<link rel="canonical" href="https://tabs.example.com/songs/twelve-bar-blues">', page)
            self.assertIn('hreflang="en" href="https://tabs.example.com/songs/twelve-bar-blues?lang=en"', page)
            self.assertIn('"url": "https://tabs.example.com/songs/twelve-bar-blues"', page)
            self.assertIn('href="songs/twelve-bar-blues#app"', page)
            sitemap = (top / "sitemap.xml").read_text()
            self.assertIn("<loc>https://tabs.example.com/tools</loc>", sitemap)
            self.assertIn("<loc>https://tabs.example.com/songs/twelve-bar-blues</loc>", sitemap)
            self.assertNotIn(".html", sitemap, "a host that serves pages without .html gets a sitemap in that form")
            shutil.rmtree(root / "twelve-bar-blues")
            build_index(root)
            self.assertFalse((top / "songs" / "twelve-bar-blues.html").exists(), "a dropped song loses its page")
            song = json.loads((ROOT / "examples" / "twelve-bar-blues" / "song.json").read_text())
            self.assertIn("&amp;", song_page_html((ROOT / "song.html").read_text(), dict(song, title="Rock & Roll"), {"name": "T"}))

    def test_song_pages_in_the_repo_match_the_template(self):
        from songlib import song_page_html

        template = (ROOT / "song.html").read_text()
        site = json.loads((ROOT / "data" / "site.json").read_text())
        rows = json.loads((ROOT / "data" / "songs.json").read_text())
        for row in rows:
            song = json.loads((ROOT / "data" / "songs" / row["id"] / "song.json").read_text())
            page = ROOT / "songs" / f"{row['id']}.html"
            self.assertTrue(page.exists(), f"{page} missing: run make index")
            self.assertEqual(page.read_text(), song_page_html(template, song, site), f"{page.name} is stale: run make index")

    def test_examples_are_valid_songs(self):
        examples = ROOT / "examples"
        folders = [p for p in examples.iterdir() if p.is_dir()]
        self.assertTrue(folders)
        for folder in folders:
            self.assertEqual(validator.validate_song(folder), [], folder.name)
            song = json.loads((folder / "song.json").read_text())
            self.assertTrue(song.get("chordTimeline"), "the example shows chord labels")


class TimelineAliasTests(unittest.TestCase):
    def test_timeline_aliases_rename_labels_in_either_spelling(self):
        from songlib import alias_timeline

        timeline = [{"bar": 0, "pos": 0, "chord": "Am/C"}, {"bar": 1, "pos": 0, "chord": "D/F♯"}, {"bar": 2, "pos": 0.5, "chord": "E"}]
        out = alias_timeline(timeline, {"Am/C": "Am", "D/F#": "Dadd9/F#"})
        self.assertEqual([e["chord"] for e in out], ["Am", "Dadd9/F#", "E"])
        self.assertEqual(out[2], timeline[2])
        self.assertIs(alias_timeline(timeline, {}), timeline)

