# Supported notation

The engraver reads two formats into one score model ([The Score](postscript-api.md#the-score)),
both parsed in PostScript (`lib/sm_abc_parse.ps`, `lib/sm_musicxml.ps`). This
page lists what is drawn. Anything else is skipped, usually with a warning
(the CLI prints them; the editor shows them under the source).

## ABC (2.1 subset)

| Feature | Syntax | Notes |
|---|---|---|
| Tunes | `X:` | several per file; `--tune N` / the editor's Tune menu picks one |
| Titles, credits | `T:` `C:` `O:` `R:` `S:` `Z:` `N:` | the second `T:` is a subtitle; `S:`/`Z:` go in the footer |
| Meter | `M:4/4` `M:C` `M:C\|` `M:6/8` `M:none` `M:2+3/8` | changes mid-tune with `M:` lines or `[M:3/4]` |
| Unit length | `L:1/8` | default from the meter, as the standard says |
| Tempo | `Q:1/4=96` `Q:"Allegro" 1/4=120` | drawn above the first system |
| Key | `K:G` `K:Em` `K:Ador` `K:Bb mix` `K:none` | all seven modes; `[K:...]` changes mid-tune, with naturals when going to C |
| Clefs | `K:C clef=bass`, `V:1 clef=treble-8`, `[K:clef=alto]` | treble, treble-8, bass, alto, tenor |
| Notes | `C D E F G A B c d ... C, c'` | octave marks stack |
| Accidentals | `^C` `_B` `=E` `^^F` `__B` | drawn as written (ABC carries them through the bar) |
| Lengths | `A2` `A/` `A//` `A3/2` `A>B` `A<B` `A>>B` | lengths a single note cannot show become tied notes |
| Rests | `z` `x` (invisible) `Z` `Z4` | `Z4` is a multi-measure rest with its count |
| Chords | `[CEG]2` `[CEG]2-` | seconds offset, accidentals stacked in columns |
| Ties, slurs | `A2-A2` `(ABc)` | across bar lines and line breaks |
| Tuplets | `(3abc` `(5:4:5...` | number on the beam, or a bracket |
| Beams | notes written together | spaces break beams; 16ths and 32nds get secondary beams and hooks |
| Grace notes | `{g}A` `{/g}A` `{gag}A` | acciaccatura slash with `/` |
| Chord symbols | `"Am7"A` `"Bb/D"` | sharps and flats drawn as glyphs |
| Annotations | `"^text"` `"_text"` `"<text"` `">text"` | |
| Decorations | `.` `~` `H` `L` `M` `P` `S` `O` `T` `u` `v` and `!staccato!` `!tenuto!` `!accent!` `!>!` `!marcato!` `!fermata!` `!invertedfermata!` `!trill!` `!roll!` `!mordent!` `!uppermordent!` `!lowermordent!` `!upbow!` `!downbow!` `!segno!` `!coda!` `!breath!` `!D.C.!` `!D.S.!` `!fine!` | |
| Dynamics | `!pp!` … `!fff!` `!mp!` `!mf!` `!sfz!` `!fp!` | |
| Hairpins | `!crescendo(!` … `!crescendo)!`, `!<(!` `!<)!`, `!diminuendo(!` `!>(!` | a decoration belongs to the note after it |
| Bar lines | `\|` `\|\|` `\|]` `[\|` `\|:` `:\|` `::` `:\|:` | |
| Endings | `[1` `\|1` `:\|2` `[1,2` | closed before a repeat, open at the end |
| Parts | `P:A` in the body | a bold label over the bar |
| Lyrics | `w:` | `-` syllables, `_` melisma, `*` skip, `\|` next bar, `~` keeps words together; several `w:` lines are verses |
| Words after | `W:` | printed under the music |
| Voices | `V:1 clef=bass name="LH"` and `%%score {1 2}` | each voice on its own staff; braces from `%%score {}` or a treble+bass pair |
| Line breaks | each music line | a system per line (lines too long are split evenly); `\` at the end joins lines; `--breaks auto` fills lines instead |
| Text | `\'e` `\"o` `\ss` … | Latin accented letters, composed from accent glyphs |
| Annotations | `%%annotation page=1 type=text x=120 y=540 color=red text="breathe"` | a reader's marks at page positions (points from the lower left): `type=text`, `circle` or `highlight` (with `w=` `h=`); colours `red blue green orange purple yellow black` or `#rrggbb`. The editor's *Annotate* tool writes these lines; in MusicXML they live in `<!-- %%annotation ... -->` comments. Highlights are drawn under the music. Positions are fixed on the page: changing paper, staff size or line breaks reflows the music but not the marks |

| Transposition | `%%transpose -2` | semitones, in the tune or the file header (before the first `X:`); the CLI's `--transpose` and the editor's menu add to it. The new key is the one with the fewest accidentals; notes, key changes and chord symbols are respelled in it |

**Not yet:** two voices on one staff (`&`, `%%score (1 2)`), macros (`m:`, `U:`),
`%%` formatting directives other than `%%score`, `%%transpose` and `%%annotation`, lyrics that
wrap mid-line, cross-staff beams, courtesy key/time signatures at line ends.

## MusicXML subset

Uncompressed `score-partwise` files (`.musicxml`, `.xml`); unzip `.mxl` first.

- Work and movement titles, composer, lyricist, arranger, rights.
- Several parts, and parts with several staves (piano): one staff per part
  staff. **One voice per staff**: the first voice met on each staff is drawn,
  others are skipped with a warning.
- Attributes: divisions, key (fifths), time (incl. `symbol="common|cut"`,
  `beats="2+3"`), clefs incl. `clef-octave-change`; changes mid-piece.
- Notes, rests (`measure="yes"` centred), chords, dots, grace notes (slash),
  accidentals (from `<accidental>`, or computed from `<alter>` against the key
  and the bar), ties, slurs, tuplets (`time-modification`), beams (or
  automatic beaming by beat when the file has no `<beam>`).
- Notations: fermata, staccato, accent, tenuto, strong-accent, trill-mark,
  mordents, turn, up/down bow, dynamics.
- Directions: words, dynamics, wedges, metronome (with words in the same
  direction as the tempo text), segno, coda.
- Harmony (chord symbols, with kinds and bass), lyrics (several verses,
  syllabic and extend), barlines, repeats, endings, `print new-system`.

**Not yet:** timewise scores, compressed `.mxl`, multiple voices per staff,
percussion and tablature (drawn as treble), page/system layout from `<defaults>`.
