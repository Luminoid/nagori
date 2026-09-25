// UI translations: English and Simplified Chinese. t(key, params) looks up the
// current language and falls back to English; sectionName, roleName,
// tuningName and keyName translate the recurring words in the song data.

import { storage } from './util.js';

const STORAGE_KEY = 'nagori:lang';

const en = {
  'nav.songs': 'Songs',
  'nav.tools': 'Tools',
  'nav.chords': 'Chords',
  'nav.tab': 'Tab',
  'nav.view': 'View',
  'nav.source': 'Source code on GitHub',
  'theme.toggle': 'Toggle light or dark theme',
  'lang.toggle': 'Switch language',

  'home.title': 'Chords, tabs, and every finger position, in time with the video.',
  'home.intro': 'Pick a song, play the video or the tab itself, and follow bar by bar. Each part comes with the chord shapes and finger positions it uses.',
  'home.songs': 'Songs',
  'home.loading': 'Loading songs…',
  'home.loadError': 'Could not load the song list: {message}',
  'home.empty': 'No songs yet.',
  'home.tracks': '{n} tracks',
  'home.private': 'private',
  'home.tracks.one': '1 track',
  'home.tools': 'Tools: metronome, the note at every fret, tuner',
  'home.toolMetronome': 'Tap a tempo, pick beats and subdivisions.',
  'home.toolFretboard': 'The note at every fret, scales highlighted.',
  'home.toolTuner': 'Reference strings, or the microphone.',
  'home.toolChords': 'Every common shape, with fingering.',
  'home.filter': 'Filter by title, artist or album',
  'home.sort': 'Sort',
  'home.noKey': 'No key',
  'sort.artist': 'Artist',
  'sort.title': 'Title',
  'sort.newest': 'Newest',
  'sort.key': 'Key',
  'sort.tempo': 'Tempo',
  'sort.length': 'Length',
  'home.noMatch': 'No songs match.',
  'home.count': '{n} songs',
  'home.count.one': '1 song',
  'home.matchCount': '{n} of {total} songs',
  'home.matchCount.one': '1 of {total} songs',
  'home.footer': '{name} is a personal practice tool. Transcriptions are credited on each song page.',
  'home.yours': 'yours',
  'local.title': 'Your songs',
  'local.intro': 'Add song folders from your own disk, in the collection\'s format (a song.json with its tracks; the README explains it and the importers write it). They stay in this browser; nothing is uploaded.',
  'local.add': 'Add songs from a folder',
  'local.drop': 'or drop song folders here',
  'local.reading': 'Reading…',
  'local.added': '{n} songs added.',
  'local.added.one': '1 song added.',
  'local.updated': '{n} songs updated.',
  'local.updated.one': '1 song updated.',
  'local.unchanged': '{n} songs unchanged.',
  'local.unchanged.one': '1 song unchanged.',
  'local.replaced': '{title} replaced the copy added earlier from the folder {folder}.',
  'local.duplicate': 'another folder in this import already has the id {id}; skipped',
  'local.leftovers': '{n} songs from the last import of this folder are no longer in it: {titles}.',
  'local.leftovers.one': '1 song from the last import of this folder is no longer in it: {titles}.',
  'local.removeLeftovers': 'Remove them',
  'local.leftoversRemoved': 'Removed {n} songs.',
  'local.leftoversRemoved.one': 'Removed 1 song.',
  'local.none': 'No song.json found in what you chose.',
  'local.problem': '{folder}: {message}',
  'local.failed': 'Could not read the folder: {message}',
  'local.removed': 'Removed {title}.',
  'local.remove': 'Remove',
  'local.missing': 'This song is not in this browser any more.',
  'local.check.json': '{file} is not valid JSON',
  'local.check.id': 'id must be lower-case letters, digits and dashes',
  'local.check.field': '{field} is missing',
  'local.check.track': 'part {id}: {file} not found beside song.json',
  'local.check.kind': 'part {id}: kind must be guitar or bass',
  'local.check.measures': 'part {id}: measures must be a list',
  'local.check.bars': 'part {id} has {n} measures but the song says {bars} bars',
  'local.check.tuning': 'part {id}: strings and tuning do not agree',

  'song.loading': 'Loading song…',
  'song.loadError': 'Could not load song "{id}": {message}',
  'meta.key': 'Key',
  'meta.tempo': 'Tempo',
  'meta.time': 'Time',
  'meta.tuning': 'Tuning',
  'meta.keyLink': 'See this key on the fretboard',
  'meta.bpm': 'BPM',
  'list.separator': ', ',
  'skip.link': 'Skip to content',
  'meta.tuningLink': 'See this tuning on the fretboard',
  'meta.capo': 'Capo',
  'meta.bars': 'Bars',
  'capo.fret': 'fret {n}',
  'capo.perPart': 'per part',
  'capo.none': 'none',
  'tempo.unit.1': 'whole notes',
  'tempo.unit.2': 'half notes',
  'tempo.unit.8': 'eighth notes',

  'video.loading': 'Loading video…',
  'video.none': 'No video for this song',
  'video.unavailable': 'Video unavailable: {message}',
  'transport.play': 'Play',
  'transport.pause': 'Pause',
  'transport.speed': 'Playback speed',
  'transport.loopNone': 'No loop',
  'transport.loop': 'Loop {name}',
  'transport.loopLabel': 'Loop a section',
  'transport.follow': 'Follow',
  'source.label': 'Play from',
  'source.video': 'Video',
  'source.tab': 'Tab audio',
  'source.click': 'Click',
  'source.clickTitle': 'Metronome click',
  'source.parts': 'Parts to play',
  'sound.label': 'Sound',
  'sound.auto': 'As set per part',
  'sound.title': 'Guitar sound for tab playback',
  'sound.acoustic': 'Acoustic',
  'sound.electric': 'Electric clean',
  'sound.overdrive': 'Overdrive',
  'sound.nylon': 'Nylon strings',
  'sound.muted': 'Palm mute',
  'mixer.hint': '{name} · {role}. Click to mute or unmute.',
  'now.idle': 'Press play to follow along',
  'now.countIn': 'Intro count-in',
  'now.paused': 'Paused',
  'now.next': 'Next',
  'now.nextWhere': ' · bar {n}',
  'now.where': '{section} · bar {n}',
  'now.bar': 'Bar',
  'sections.label': 'Sections',
  'section.title': '{name}: bars {from}–{to}',
  'sync.offset': 'Sync offset',
  'sync.earlier': 'Earlier',
  'sync.later': 'Later',
  'sync.seconds': '{n}s',
  'sync.reset': 'Reset',

  'positions.title': 'Positions',
  'positions.section': 'Positions · {name}',
  'positions.heading': 'Finger positions by part',
  'positions.lead': '{name} · {role}. Numbers are left-hand fingers (1 index, 2 middle, 3 ring, 4 pinky); dimmed dots are chord tones held but not picked. Click a shape to play from its first bar.',
  'positions.bars': 'bars {from}–{to}',
  'card.bars': 'bars {list}',
  'card.playFrom': 'Play from bar {n}',
  'card.shape': '{name} shape',
  'card.run': 'Run at fret {n}',
  'card.shapeAt': 'Shape at fret {n}',
  'toolbar.track': 'Track',
  'toolbar.capo': 'capo {n}',
  'toolbar.fingers': 'Finger numbers',
  'toolbar.lyrics': 'Lyrics',
  'toolbar.positions': 'Positions',
  'track.loading': 'Loading track…',
  'track.loadError': 'Could not load this part: {message}',
  'player.error': 'Playback is unavailable: {message}',

  'footer.transcription': 'Transcription based on the ',
  'footer.tab': '{name} tab',
  'footer.by': ' by {author}',
  'footer.revision': ' (revision {id})',
  'footer.byRevision': ' by {author} (revision {id})',
  'footer.period': '. ',
  'footer.video': 'Video: ',
  'footer.local': 'Added from a folder on this device. ',
  'footer.fingerings': 'Fingerings are suggestions computed from the chord shapes; adjust to your hands.',

  'sheet.none': 'No chord sheet for this song yet.',
  'sheet.chords': 'Chords',
  'sheet.shapes': 'Chord shapes',
  'sheet.lead': '{n} chords · {tuning}{capo}',
  'sheet.lead.one': '1 chord · {tuning}{capo}',
  'sheet.capo': ' · capo {n}',
  'sheet.noCapo': ' · no capo',
  'sheet.dictionary': 'Every shape of this chord',
  'sheet.noDiagram': 'no diagram',
  'sheet.title': 'Chord sheet',
  'sheet.part': 'Part {n}',
  'sheet.playFrom': 'Play from here',
  'sheet.bar': 'bar {n}',
  'sheet.bars': 'bars {from}–{to}',

  'tools.title': 'Tools',
  'tools.intro': 'A metronome, a chord dictionary, the note at every fret, and a tuner. Everything runs in the browser, online or off.',
  'metro.title': 'Metronome',
  'metro.lead': 'Space starts and stops. Tap the button in time to set the tempo.',
  'metro.start': 'Start',
  'metro.stop': 'Stop',
  'metro.tap': 'Tap tempo',
  'metro.slower': 'Slower',
  'metro.faster': 'Faster',
  'metro.tempo': 'Tempo',
  'metro.beats': 'Beats per bar',
  'metro.subdivision': 'Subdivision',
  'metro.sub.1': 'Quarter notes',
  'metro.sub.2': 'Eighths',
  'metro.sub.3': 'Triplets',
  'metro.sub.4': 'Sixteenths',
  'metro.accent': 'Accent beat 1',
  'fret.title': 'Fretboard',
  'fret.lead': 'The note at every fret of the tuning. Click a note to hear it; pick a root and a scale to see where its notes fall.',
  'fret.tuning': 'Tuning',
  'fret.root': 'Root',
  'fret.rootNone': 'None',
  'fret.scale': 'Scale',
  'fret.scale.none': 'All notes',
  'fret.scale.major': 'Major',
  'fret.scale.minor': 'Natural minor',
  'fret.scale.majorPent': 'Major pentatonic',
  'fret.scale.minorPent': 'Minor pentatonic',
  'fret.scale.blues': 'Blues',
  'fret.names': 'Names',
  'fret.sharps': 'Sharps',
  'fret.flats': 'Flats',
  'tuning.standard': 'Standard (E A D G B E)',
  'tuning.dropD': 'Drop D (D A D G B E)',
  'tuning.halfDown': 'Half step down (E♭ A♭ D♭ G♭ B♭ E♭)',
  'tuning.dadgad': 'DADGAD (D A D G A D)',
  'tuning.dadfbe': 'D A D F♯ B E',
  'tuning.openG': 'Open G (D G D G B D)',
  'tuning.bass': 'Bass (E A D G)',
  'tuner.title': 'Tuner',
  'tuner.lead': 'Play a reference string, or tune with the microphone.',
  'tuner.reference': 'Reference strings',
  'tuner.string': 'String {n}',
  'tuner.mic': 'Use microphone',
  'tuner.stop': 'Stop listening',
  'tuner.listening': 'Listening… play one string at a time',
  'tuner.idle': 'The microphone is off',
  'tuner.low': 'Too low, tune up',
  'tuner.high': 'Too high, tune down',
  'tuner.inTune': 'In tune',
  'tuner.cents': '{n} cents',
  'tuner.micError': 'Microphone unavailable: {message}',
  'tuner.nearest': 'string {n}',
  'dict.title': 'Chords',
  'dict.lead': 'Pick a root and a quality to see its shapes, open position first. Click a shape to hear it.',
  'dict.quality': 'Quality',
  'dict.q.major': 'Major',
  'dict.q.minor': 'Minor',
  'dict.q.dom7': 'Dominant 7th',
  'dict.q.min7': 'Minor 7th',
  'dict.q.maj7': 'Major 7th',
  'dict.q.sus2': 'Sus2',
  'dict.q.sus4': 'Sus4',
  'dict.q.add9': 'Add9',
  'dict.q.six': 'Sixth',
  'dict.q.min6': 'Minor sixth',
  'dict.q.dim': 'Diminished',
  'dict.q.dim7': 'Diminished seventh',
  'dict.q.aug': 'Augmented',
  'dict.q.power': 'Power chord',
  'dict.none': 'No built-in shape for this chord yet.',
  'dict.play': 'Play {name}',

  'notFound.title': 'Page not found',
  'notFound.intro': 'There is nothing at this address. The songs and tools are one step away.',
  'notFound.home': 'Back to the songs',
};

const zh = {
  'nav.songs': '歌曲',
  'nav.tools': '工具',
  'nav.chords': '和弦',
  'nav.tab': '六线谱',
  'nav.view': '视图',
  'nav.source': 'GitHub 上的源码',
  'theme.toggle': '切换深浅主题',
  'lang.toggle': '切换语言',

  'home.title': '和弦、六线谱和每一个指位，与视频同步。',
  'home.intro': '选一首歌，播放视频或直接播放谱面，逐小节跟随。每个声部都附有它用到的和弦指型和指位。',
  'home.songs': '歌曲',
  'home.loading': '正在加载歌曲…',
  'home.loadError': '无法加载歌曲列表：{message}',
  'home.empty': '还没有歌曲。',
  'home.tracks': '{n} 条音轨',
  'home.private': '私人',
  'home.tracks.one': '1 条音轨',
  'home.tools': '工具：节拍器、每个品位的音名、调音器',
  'home.toolMetronome': '点击定速，选择拍数和细分。',
  'home.toolFretboard': '每一品的音名，可高亮音阶。',
  'home.toolTuner': '参考弦音，或使用麦克风。',
  'home.toolChords': '常用和弦指型与指法。',
  'home.filter': '按歌名、艺人或专辑筛选',
  'home.sort': '排序',
  'home.noKey': '未标调',
  'sort.artist': '艺人',
  'sort.title': '歌名',
  'sort.newest': '最新',
  'sort.key': '调',
  'sort.tempo': '速度',
  'sort.length': '时长',
  'home.noMatch': '没有匹配的歌曲。',
  'home.count': '{n} 首歌',
  'home.count.one': '1 首歌',
  'home.matchCount': '{total} 首中的 {n} 首',
  'home.matchCount.one': '{total} 首中的 1 首',
  'home.footer': '{name} 是个人练习工具。每首歌的页面都注明了谱面来源。',
  'home.yours': '我的',
  'local.title': '你的歌曲',
  'local.intro': '从你的电脑添加歌曲文件夹，格式与本站曲库相同（song.json 及其分轨文件；README 有说明，导入脚本会生成它）。它们只保存在这个浏览器里，不会上传。',
  'local.add': '从文件夹添加歌曲',
  'local.drop': '或把歌曲文件夹拖到这里',
  'local.reading': '正在读取…',
  'local.added': '已添加 {n} 首歌。',
  'local.added.one': '已添加 1 首歌。',
  'local.updated': '已更新 {n} 首歌。',
  'local.updated.one': '已更新 1 首歌。',
  'local.unchanged': '{n} 首歌没有变化。',
  'local.unchanged.one': '1 首歌没有变化。',
  'local.replaced': '《{title}》替换了之前从文件夹 {folder} 添加的同名歌曲。',
  'local.duplicate': '本次添加的另一个文件夹已使用 id {id}，已跳过',
  'local.leftovers': '上次从这个文件夹添加的 {n} 首歌已不在其中：{titles}。',
  'local.leftovers.one': '上次从这个文件夹添加的 1 首歌已不在其中：{titles}。',
  'local.removeLeftovers': '移除它们',
  'local.leftoversRemoved': '已移除 {n} 首歌。',
  'local.leftoversRemoved.one': '已移除 1 首歌。',
  'local.none': '所选内容中没有 song.json。',
  'local.problem': '{folder}：{message}',
  'local.failed': '无法读取文件夹：{message}',
  'local.removed': '已移除《{title}》。',
  'local.remove': '移除',
  'local.missing': '这首歌已不在这个浏览器中。',
  'local.check.json': '{file} 不是有效的 JSON',
  'local.check.id': 'id 只能用小写字母、数字和连字符',
  'local.check.field': '缺少 {field}',
  'local.check.track': '声部 {id}：song.json 旁没有 {file}',
  'local.check.kind': '声部 {id}：kind 必须是 guitar 或 bass',
  'local.check.measures': '声部 {id}：measures 必须是列表',
  'local.check.bars': '声部 {id} 有 {n} 小节，而歌曲写着 {bars} 小节',
  'local.check.tuning': '声部 {id}：strings 与 tuning 不一致',

  'song.loading': '正在加载歌曲…',
  'song.loadError': '无法加载歌曲“{id}”：{message}',
  'meta.key': '调式',
  'meta.tempo': '速度',
  'meta.time': '拍号',
  'meta.tuning': '调弦',
  'meta.keyLink': '在指板上查看这个调',
  'meta.bpm': 'BPM',
  'list.separator': '、',
  'skip.link': '跳到正文',
  'meta.tuningLink': '在指板上查看这个调弦',
  'meta.capo': '变调夹',
  'meta.bars': '小节数',
  'capo.fret': '第 {n} 品',
  'capo.perPart': '各声部不同',
  'capo.none': '无',
  'tempo.unit.1': '全音符',
  'tempo.unit.2': '二分音符',
  'tempo.unit.8': '八分音符',

  'video.loading': '视频加载中…',
  'video.none': '本曲没有视频',
  'video.unavailable': '视频不可用：{message}',
  'transport.play': '播放',
  'transport.pause': '暂停',
  'transport.speed': '播放速度',
  'transport.loopNone': '不循环',
  'transport.loop': '循环 {name}',
  'transport.loopLabel': '循环某个段落',
  'transport.follow': '跟随',
  'source.label': '播放来源',
  'source.video': '视频',
  'source.tab': '谱面播放',
  'source.click': '节拍声',
  'source.clickTitle': '节拍器',
  'source.parts': '播放的声部',
  'sound.label': '音色',
  'sound.auto': '按声部设定',
  'sound.title': '谱面播放的吉他音色',
  'sound.acoustic': '原声吉他',
  'sound.electric': '电吉他清音',
  'sound.overdrive': '过载',
  'sound.nylon': '尼龙弦',
  'sound.muted': '手掌闷音',
  'mixer.hint': '{name} · {role}。点击静音或取消静音。',
  'now.idle': '按播放开始跟随',
  'now.countIn': '前奏预备',
  'now.paused': '已暂停',
  'now.next': '下一个',
  'now.nextWhere': ' · 第 {n} 小节',
  'now.where': '{section} · 第 {n} 小节',
  'now.bar': '小节',
  'sections.label': '段落',
  'section.title': '{name}：第 {from}–{to} 小节',
  'sync.offset': '同步偏移',
  'sync.earlier': '提前',
  'sync.later': '延后',
  'sync.seconds': '{n} 秒',
  'sync.reset': '重置',

  'positions.title': '指位',
  'positions.section': '指位 · {name}',
  'positions.heading': '各段落指位',
  'positions.lead': '{name} · {role}。数字为左手手指（1 食指、2 中指、3 无名指、4 小指）；灰色圆点是按住但没有弹的和弦音。点击指型可从它的第一小节开始播放。',
  'positions.bars': '第 {from}–{to} 小节',
  'card.bars': '小节 {list}',
  'card.playFrom': '从第 {n} 小节播放',
  'card.shape': '{name} 指型',
  'card.run': '第 {n} 品走句',
  'card.shapeAt': '第 {n} 品指型',
  'toolbar.track': '音轨',
  'toolbar.capo': '变调夹 {n} 品',
  'toolbar.fingers': '指法编号',
  'toolbar.lyrics': '歌词',
  'toolbar.positions': '指位',
  'track.loading': '正在加载音轨…',
  'track.loadError': '无法加载这个声部：{message}',
  'player.error': '无法播放：{message}',

  'footer.transcription': '谱面基于 ',
  'footer.tab': '{name} 上的谱',
  'footer.by': '（作者 {author}）',
  'footer.revision': '（修订 {id}）',
  'footer.byRevision': '（作者 {author}，修订 {id}）',
  'footer.period': '。',
  'footer.video': '视频：',
  'footer.local': '来自本机的一个文件夹。',
  'footer.fingerings': '指法由和弦指型自动推算，仅供参考，请按自己的手型调整。',

  'sheet.none': '本曲还没有和弦谱。',
  'sheet.chords': '和弦',
  'sheet.shapes': '和弦指型',
  'sheet.lead': '{n} 个和弦 · {tuning}{capo}',
  'sheet.lead.one': '1 个和弦 · {tuning}{capo}',
  'sheet.capo': ' · 变调夹 {n} 品',
  'sheet.noCapo': ' · 无变调夹',
  'sheet.dictionary': '这个和弦的全部指型',
  'sheet.noDiagram': '无图',
  'sheet.title': '和弦谱',
  'sheet.part': '第 {n} 部分',
  'sheet.playFrom': '从这里播放',
  'sheet.bar': '第 {n} 小节',
  'sheet.bars': '第 {from}–{to} 小节',

  'tools.title': '工具',
  'tools.intro': '节拍器、和弦字典、每个品位的音名，以及调音器。全部在浏览器中运行，离线也可以。',
  'metro.title': '节拍器',
  'metro.lead': '空格键开始或停止。跟着节奏点击“点击测速”可设定速度。',
  'metro.start': '开始',
  'metro.stop': '停止',
  'metro.tap': '点击测速',
  'metro.slower': '减慢',
  'metro.faster': '加快',
  'metro.tempo': '速度',
  'metro.beats': '每小节拍数',
  'metro.subdivision': '细分',
  'metro.sub.1': '四分音符',
  'metro.sub.2': '八分音符',
  'metro.sub.3': '三连音',
  'metro.sub.4': '十六分音符',
  'metro.accent': '第 1 拍重音',
  'fret.title': '指板',
  'fret.lead': '该调弦下每个品位的音名。点击音符可试听；选择根音和音阶可查看音阶内的音。',
  'fret.tuning': '调弦',
  'fret.root': '根音',
  'fret.rootNone': '无',
  'fret.scale': '音阶',
  'fret.scale.none': '全部音',
  'fret.scale.major': '大调',
  'fret.scale.minor': '自然小调',
  'fret.scale.majorPent': '大调五声',
  'fret.scale.minorPent': '小调五声',
  'fret.scale.blues': '布鲁斯',
  'fret.names': '音名',
  'fret.sharps': '升号',
  'fret.flats': '降号',
  'tuning.standard': '标准调弦 (E A D G B E)',
  'tuning.dropD': '降 D (D A D G B E)',
  'tuning.halfDown': '降半音 (E♭ A♭ D♭ G♭ B♭ E♭)',
  'tuning.dadgad': 'DADGAD (D A D G A D)',
  'tuning.dadfbe': 'D A D F♯ B E',
  'tuning.openG': '开放 G (D G D G B D)',
  'tuning.bass': '贝斯 (E A D G)',
  'tuner.title': '调音器',
  'tuner.lead': '播放参考弦音，或用麦克风调音。',
  'tuner.reference': '参考弦音',
  'tuner.string': '第 {n} 弦',
  'tuner.mic': '使用麦克风',
  'tuner.stop': '停止监听',
  'tuner.listening': '正在监听…请一次只弹一根弦',
  'tuner.idle': '麦克风未开启',
  'tuner.low': '偏低，请调高',
  'tuner.high': '偏高，请调低',
  'tuner.inTune': '准了',
  'tuner.cents': '{n} 音分',
  'tuner.micError': '无法使用麦克风：{message}',
  'tuner.nearest': '第 {n} 弦',
  'dict.title': '和弦',
  'dict.lead': '选择根音和类型查看指型，开放把位在前。点击指型可以听到和弦。',
  'dict.quality': '类型',
  'dict.q.major': '大三和弦',
  'dict.q.minor': '小三和弦',
  'dict.q.dom7': '属七和弦',
  'dict.q.min7': '小七和弦',
  'dict.q.maj7': '大七和弦',
  'dict.q.sus2': '挂二和弦',
  'dict.q.sus4': '挂四和弦',
  'dict.q.add9': '加九和弦',
  'dict.q.six': '大六和弦',
  'dict.q.min6': '小六和弦',
  'dict.q.dim': '减三和弦',
  'dict.q.dim7': '减七和弦',
  'dict.q.aug': '增三和弦',
  'dict.q.power': '强力和弦',
  'dict.none': '暂无这个和弦的内置指型。',
  'dict.play': '播放 {name}',
  'notFound.title': '页面不存在',
  'notFound.intro': '这个地址没有内容。歌曲和工具就在一步之外。',
  'notFound.home': '返回歌曲列表',
};

export const dictionaries = { en, zh };

function detect() {
  if (typeof window === 'undefined') return 'en';
  const param = new URLSearchParams(window.location.search).get('lang');
  if (param === 'zh' || param === 'en') {
    storage.set(STORAGE_KEY, param);
    return param;
  }
  const stored = storage.get(STORAGE_KEY, null);
  if (stored === 'zh' || stored === 'en') return stored;
  const preferred = (navigator.language || '').toLowerCase();
  return preferred.startsWith('zh') ? 'zh' : 'en';
}

export let lang = detect();

/** Change the language for this module only (tests); the toggle uses switchLanguage. */
export function setLanguage(code) {
  lang = dictionaries[code] ? code : 'en';
}

export function t(key, params = {}) {
  const dict = dictionaries[lang];
  const singular = params.n === 1 ? dict[`${key}.one`] ?? en[`${key}.one`] : undefined;
  const text = singular ?? dict[key] ?? en[key] ?? key;
  return text.replace(/\{(\w+)\}/g, (match, name) => (params[name] === undefined ? match : String(params[name])));
}

/** Translate the static parts of a page: data-i18n (text), data-i18n-title, data-i18n-aria. */
export function applyLang(root = document) {
  document.documentElement.lang = lang === 'zh' ? 'zh-Hans' : 'en';
  for (const el of root.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of root.querySelectorAll('[data-i18n-title]')) el.title = t(el.dataset.i18nTitle);
  for (const el of root.querySelectorAll('[data-i18n-aria]')) el.setAttribute('aria-label', t(el.dataset.i18nAria));
}

/** Text in parentheses the way the language writes them: " (1997)" or "（1997）". */
export function parens(text) {
  return lang === 'zh' ? `（${text}）` : ` (${text})`;
}

/** Store the other language and reload; the page state lives in the URL. */
function switchLanguage() {
  const next = lang === 'zh' ? 'en' : 'zh';
  storage.set(STORAGE_KEY, next);
  const url = new URL(window.location.href);
  url.searchParams.set('lang', next); // in the URL too, so the switch works where storage is blocked
  window.location.replace(url.toString());
}

export function setupLanguageToggle() {
  const button = document.getElementById('lang-toggle');
  if (!button) return;
  button.textContent = lang === 'zh' ? 'EN' : '中文';
  button.lang = lang === 'zh' ? 'en' : 'zh-Hans';
  button.setAttribute('aria-label', t('lang.toggle'));
  button.title = t('lang.toggle');
  button.addEventListener('click', switchLanguage);
}

// --- Words that recur in the song data ------------------------------------------

const SECTION_WORDS = {
  intro: '前奏',
  verse: '主歌',
  chorus: '副歌',
  'pre-chorus': '预副歌',
  'pre-verse': '主歌前段',
  bridge: '桥段',
  outro: '尾奏',
  ending: '结尾',
  solo: '独奏',
  interlude: '间奏',
  refrain: '叠句',
  'loud section': '强奏段',
  breakdown: '分解段',
  instrumental: '器乐段',
  coda: '尾声',
  riff: '连复段',
  hook: '记忆点',
};

const ROLE_WORDS = {
  guitar: '吉他',
  'lead guitar': '主音吉他',
  'rhythm guitar': '节奏吉他',
  'backing guitar': '伴奏吉他',
  'delay guitar': '延迟吉他',
  'acoustic guitar': '原声吉他',
  'electric guitar': '电吉他',
  bass: '贝斯',
  'electric bass': '电贝斯',
  overdub: '叠录',
  overdubs: '叠录',
  clean: '清音',
  distortion: '失真',
  'steel-string': '钢弦',
  'looper effect': '循环效果',
  harmonics: '泛音',
  acoustic: '原声',
  rhythm: '节奏',
  lead: '主音',
  'main riff': '主连复段',
  'loud section': '强奏段',
  bridge: '桥段',
};

function translateWords(text, words) {
  const match = text.trim().match(/^(.*?)(\s*\d+)?$/);
  const base = match[1].trim().toLowerCase();
  const translated = words[base];
  return translated ? `${translated}${match[2] ? ` ${match[2].trim()}` : ''}` : text;
}

/** "Verse 1" -> "主歌 1" in Chinese; untouched in English or when unknown. */
export function sectionName(name) {
  if (lang !== 'zh' || !name) return name;
  return translateWords(name, SECTION_WORDS);
}

/** "Lead guitar · Fender Telecaster" -> "主音吉他 · Fender Telecaster". Gear names stay. */
export function roleName(role) {
  if (lang !== 'zh' || !role) return role;
  return role
    .split(' · ')
    .map((segment) => translateWords(segment, ROLE_WORDS))
    .join(' · ');
}

/** "Standard (E A D G B E)" -> "标准调弦 (E A D G B E)". */
export function tuningName(label) {
  if (lang !== 'zh' || !label) return label;
  return label
    .replace(/^Standard\b/, '标准调弦')
    .replace(/^Drop D\b/, '降 D 调弦')
    .replace(/^Half step down\b/, '降半音')
    .replace(/^Open ([A-G][♯♭#b]?)\b/, '开放 $1 调弦');
}

/** "C minor" -> "C 小调"; "A♭ minor (G minor shapes, capo 1)" -> "A♭ 小调（G 小调指型，变调夹 1 品）". */
export function keyName(key) {
  if (lang !== 'zh' || !key) return key;
  return key
    .replace(/\bminor\b/g, '小调')
    .replace(/\bmajor\b/g, '大调')
    .replace(/\bshapes\b/g, '指型')
    .replace(/\bcapo (\d+)/g, '变调夹 $1 品')
    .replace(/ 指型/g, '指型')
    .replace(/ \(/g, '（')
    .replace(/\)/g, '）')
    .replace(/, /g, '，');
}
