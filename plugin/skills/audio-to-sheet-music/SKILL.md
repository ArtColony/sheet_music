---
name: audio-to-sheet-music
description: Turn a recording or a MIDI file into sheet music. Transcribes WAV/MP3/FLAC audio to MIDI with open models from the Hugging Face Hub (Spotify's Basic Pitch, optionally Demucs source separation or a piano transcription model), quantizes the MIDI to ABC with a deterministic script, then engraves it to PDF/PNG with the sheet-music PostScript library and pscat. Use when asked to transcribe a song, recording, audio file, MP3, WAV or MIDI file into sheet music, a score, a lead sheet or ABC, or to "write down" what is played in a recording.
---

# Audio or MIDI → sheet music

```
song.mp3 ─ transcribe.py ─▶ song.mid ─ midi2abc.py ─▶ song.abc ─ pscat + lib/sheet.ps ─▶ song.pdf
          (models from the        (deterministic:       (the ps-sheet-music skill:
           Hugging Face Hub)       quantize, key,        check, render, look, fix)
                                   meter, staves)
song.mid ───────────────────────▶ (MIDI skips the models: no Python packages, no account)
```

The transcription is a draft. Models miss and invent notes, and beat
tracking guesses the tempo, so always compare the score with the
recording before calling it done.

## Find the scripts

The scripts are in this skill's `scripts/` directory. Call it `SCRIPTS`.

1. **Claude Code plugin:** `${CLAUDE_PLUGIN_ROOT}/skills/audio-to-sheet-music/scripts`.
2. **Codex plugin:** `ls -d ~/.codex/plugins/cache/*/sheet-music/*/skills/audio-to-sheet-music/scripts`
   (take the newest version).
3. **The sheet_music repository:** `plugin/skills/audio-to-sheet-music/scripts`.

| Script | Needs | Does |
|---|---|---|
| `midi2abc.py` | `python3` (3.8+, standard library only) | MIDI → ABC, deterministic |
| `transcribe.py` | the venv from `setup.sh` | audio → beat-aligned MIDI; `--check` checks the setup |
| `setup.sh` | `python3` or `uv` | makes that venv (nothing installed outside it) |

Engraving needs **pscat** and the sheet-music library, as in the
`ps-sheet-music` skill. Check `pscat --version` or the pscat MCP tools first;
if neither is there, ask the user to install the pscat plugin (the
`ps-sheet-music` skill says how).

## 1. MIDI in: skip to step 3

A `.mid`/`.midi` file needs no model, no venv and no Hugging Face account.
Go straight to `midi2abc.py`.

## 2. Audio in: set up once, then transcribe

### Setup (once per machine): walk the user through it and check each step

Ask before installing anything. Say where the venv will go and how big it is:

| Option | What it adds | Disk |
|---|---|---|
| (base) | Basic Pitch on ONNX Runtime, librosa, huggingface_hub | about 300 MB |
| `--with-separation` | Demucs and PyTorch | about 1 GB more |
| `--with-piano` | the piano model's code (PyTorch) | about 1 GB more (shared with the line above) |

Suggest `~/.cache/sheet-music/transcribe-venv`, or a `.venv-transcribe`
folder in the project (add that folder to `.gitignore`).

```sh
sh SCRIPTS/setup.sh VENV                      # add --with-separation / --with-piano when needed
VENV/bin/python SCRIPTS/transcribe.py --check
```

`--check` prints one line per step: `ok`, `MISS` (required, with the fix
on the next line) or `opt` (optional). It checks the Python version, the
venv, the packages, ffmpeg, the Hugging Face login, and that each pinned
model is on the Hub and not gated. Fix every `MISS`, then run `--check`
again until it ends with `setup: ok`.

**Hugging Face account and token.** The default models are public and not
gated, so **no account or token is needed**. Anonymous downloads only have
lower rate limits. If the user wants to log in (or later picks a gated
model):

1. They make an account at <https://huggingface.co/join>. Do not make one for them.
2. They make a **read** token at <https://huggingface.co/settings/tokens>.
3. They run **`VENV/bin/hf auth login`** themselves in their own terminal
   and paste the token at its hidden prompt. `hf` comes with
   `huggingface_hub` in the venv. In Claude Code they can type
   `! VENV/bin/hf auth login`, but a separate terminal is safer.
   **Never ask for the token in chat. Never write it to a file in the
   project, and never commit it.** `hf` keeps it in
   `~/.cache/huggingface/token`. Setting `HF_TOKEN` in their own shell
   profile also works.
4. Check with `VENV/bin/hf auth whoami` (or `--check`).
5. **Gated model:** the user opens the model page while logged in, reads
   the terms and clicks to accept them. Do not accept for them. `--check`
   reports a gated model with its URL.

**Hugging Face's own agent skill (optional).** Hugging Face publishes
[`huggingface/skills`](https://github.com/huggingface/skills); its `hf-cli`
skill teaches an agent the whole `hf` CLI (search models, look at repos,
manage the cache). It helps when picking other models, but this skill does
not need it.

- Claude Code: `/plugin marketplace add huggingface/skills`, then
  `/plugin install hf-cli@huggingface-skills`.
- Codex: `VENV/bin/hf skills add hf-cli --global`, which installs it into
  `~/.agents/skills`.

Models download on first use into the Hugging Face cache (`HF_HOME`,
by default `~/.cache/huggingface`). Delete them with `VENV/bin/hf cache`.

### Transcribe

Choose the mode from what the recording is:

| Recording | Command |
|---|---|
| one instrument or voice, a melody | `VENV/bin/python SCRIPTS/transcribe.py in.mp3 -o out.mid --melody` |
| one polyphonic instrument (guitar, organ, ensemble) | `... in.wav -o out.mid` (Basic Pitch on the whole mix) |
| solo piano | `... in.wav -o out.mid --model piano` |
| a song: singing over a band | `... in.mp3 -o out.mid --separate` (Demucs: vocals become the melody staff, bass the lower one; `--with-other` adds guitars/keys) |

More options:

- `--bpm 96`: the tempo, if known. It skips beat tracking, which can lock
  onto half or double the tempo; results are folded into 70–180 bpm.
- `--start 30 --duration 20`: a section, in seconds. Try a short section first.
- `--device mps|cuda`: run Demucs or the piano model on a GPU.
- `--keep-harmonics`: by default a quiet note an octave, twelfth, … above
  a louder one is dropped as an overtone; this keeps those notes.
- `--keep-stems DIR`: keep the separated WAVs to listen to.

The output MIDI's ticks follow the detected beats, and its tempo is the
median tempo, so bars stay aligned even when the performer speeds up.

## 3. MIDI → ABC

```sh
python3 SCRIPTS/midi2abc.py out.mid -o song.abc --title "Song title"
```

It quantizes onsets and ends to sixteenths (`--grid 8|16|32`). It guesses
the meter, pickup and key (a file's own time and key signatures win), puts
one or two staves on a grand staff, ties notes across bar lines, and writes
accidentals per bar.

**Read the header it wrote and fix the guesses with options, not by hand:**

| Option | Use when |
|---|---|
| `--meter 3/4`, `--meter 6/8` | the bars are the wrong length (the meter guess is the weakest step) |
| `--pickup 1/4` | the first downbeat is wrong (fraction of a whole note; `0` for none) |
| `--key Bb`, `--key F#m` | the key signature is wrong (it is chosen for the fewest accidentals) |
| `--bpm 100` | MIDI played freely against a default tempo: reads seconds at this tempo |
| `--staves 1` / `--staves 2`, `--split 55` | one staff instead of two, or where the hands split (MIDI pitch; 60 = middle C) |
| `--fill-gaps 0` | keep short rests between notes (default: a rest of one grid step before the next note is absorbed) |
| `--composer`, `--source` | the C: and Z: lines |
| `--notes` | print the notes as JSON instead (for debugging) |

The same MIDI file always gives the same ABC bytes.

## 4. Check, engrave, look, fix

Use the `ps-sheet-music` skill's loop on `song.abc`. Do not repeat its
setup here:

1. `(song.abc) sm-abc-check-file`: it must print `sm-abc: ok`.
   midi2abc's output checks clean; edits you make later might not.
2. Render a PNG and **look at it**: `(song.abc) sm-abc-engrave-file` with
   `--png`, or `node bin/sheet.mjs song.abc -o song.png` in the repository.
3. Compare with the recording, bar by bar. Typical fixes:
   - wrong octave or ghost notes from overtones: delete them;
   - a melody note that went to the bass staff: move it;
   - a chord that is really two notes in a row: split it;
   - tempo folded wrong (everything twice too fast or slow): re-run with `--bpm`.
   Then add what a transcription cannot know: chord symbols (`"G"`),
   lyrics (`w:`), dynamics, a title and composer.
4. Write the PDF.

## Models

All are pinned to a Hub commit and checked against a SHA-256 in
`transcribe.py` (`MODELS`), so a changed upload is refused, not used.

| Use | Hub repo (revision) | File, size | Licence | Why |
|---|---|---|---|---|
| default transcription | [`AEmotionStudio/basic-pitch-onnx-models`](https://huggingface.co/AEmotionStudio/basic-pitch-onnx-models) (`327fd8c`) | `nmp.onnx`, 0.23 MB | Apache-2.0 | Spotify's [Basic Pitch](https://huggingface.co/spotify/basic-pitch) (ICASSP 2022). It handles any instrument, polyphony and voice, and runs on CPU. Spotify's own Hub repo is the model card only (no weights); this mirror's file is byte-identical to the `nmp.onnx` in Spotify's `basic-pitch` 0.4.0 wheel on PyPI (checked by SHA-256) |
| `--separate` | [`adefossez/HTDemucs`](https://huggingface.co/adefossez/HTDemucs) (`cbc8a9b`) | `955717e8.safetensors`, 84 MB | MIT (Demucs) | Demucs v4 Hybrid Transformer, from its author's namespace; `demucs` 4.1 loads these weights from the Hub itself. Stems: vocals, bass, drums, other |
| `--model piano` | [`xavriley/midi-transcription-models`](https://huggingface.co/xavriley/midi-transcription-models) (`b7bec65`) | `note_F1=0.9677_pedal_F1=0.9186.pth`, 172 MB | weights CC-BY-4.0 (Zenodo 4034264), code Apache-2.0 | ByteDance's high-resolution piano transcription (Kong et al. 2020), state of the art for solo piano with pedal. The file is the same bytes as the Zenodo original; credit the authors when publishing results |

Considered and not used: YourMT3 (`mimbres/YourMT3`, Apache-2.0,
multi-instrument, 0.4–0.8 GB per checkpoint). It is better on full mixes
but needs its own research code, not a pip package.

## How good is it

These were measured on audio synthesized from this repository's own CC0
samples (additive tones, not real instruments, so they flatter the models):

- **Melody, one instrument, Basic Pitch (from an MP3):** every melody note
  had the right pitch and rhythm. Twinkle came back with 4 stray chord
  notes in 12 bars, where one note rang into the next. The tempo was found
  within 1 bpm (99 for 100), and the meter, key and bar lines were right.
- **Two hands, Basic Pitch (Ode to Joy, 16 bars):** the right hand was
  right in 13 of 16 bars; the misses were two stray overlap chords and one
  low note moved to the bass staff. The left hand had the right pitches,
  but 5 half notes came back as two quarters. The tempo was found within
  1 bpm, and the meter and key were right.
- **The piano model on synthetic tones:** octave-stacked chords, because
  it is trained on real pianos and synthetic tones are not one. Use it on
  real piano recordings.
- **Demucs on a single synthetic instrument:** the stems bleed, and the
  score is messy. It is meant for songs with a voice and a band.

On real recordings expect more stray notes, ornaments written out as fast
notes, and swing written straight. A singer's vibrato or slides can split
one note into several.

## Limits

- No tuplets (triplets come out as the nearest sixteenths), no swing, and
  no grace notes.
- One voice per staff, at most two staves. Notes that start together
  become a chord, and a held note is cut when the next one starts.
- One tempo and meter for the whole piece. Drums are dropped.
- Audio stays on the user's machine; only model downloads use the network.

## Licensing

Transcribe only music the user may use: their own, public domain, or
licensed for it. A transcription of a copyrighted song is a derivative
work, even when the user made the recording. Record the source in `S:` /
`Z:` (`--source`). Basic Pitch and Demucs outputs are the user's; the piano
model's CC-BY licence asks for attribution of the model.
