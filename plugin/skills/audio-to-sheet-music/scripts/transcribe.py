#!/usr/bin/env python3
"""transcribe: an audio file (WAV, MP3, FLAC, OGG, ...) in, a MIDI file whose
ticks follow the music's beats out, ready for midi2abc.py.

    python transcribe.py --check                          # is everything set up?
    python transcribe.py song.mp3 -o song.mid             # Basic Pitch on the whole mix
    python transcribe.py song.mp3 -o song.mid --separate  # Demucs first: vocals -> melody, bass -> bass
    python transcribe.py piano.wav -o piano.mid --model piano
    python transcribe.py song.mid -o out.mid              # MIDI in: copied, nothing to transcribe

The models come from the Hugging Face Hub at pinned revisions and are
checked against pinned SHA-256 sums (see MODELS); huggingface_hub caches
them (HF_HOME, by default ~/.cache/huggingface). None of them is gated, so
no token is needed; a logged-in `hf` CLI only raises the rate limits.

The neural models are not bit-for-bit deterministic across machines (float
arithmetic on different CPUs/GPUs), and beat tracking is a heuristic: check
the score against the recording. Everything after this script (midi2abc.py,
the engraver) is deterministic.
"""
import argparse
import hashlib
import importlib
import os
import shutil
import subprocess
import sys

# repo, revision (a commit, so the bytes cannot change under us), file, sha256, size
MODELS = {
    # Spotify's Basic Pitch (ICASSP 2022), Apache-2.0. spotify/basic-pitch on
    # the Hub is the model card only (no weights); this mirror's nmp.onnx is
    # byte-identical to the one in Spotify's basic-pitch 0.4.0 wheel on PyPI.
    'basic-pitch': ('AEmotionStudio/basic-pitch-onnx-models', '327fd8ccd2f0bb84cbe56b4a0e9d318398ddf763',
                    'nmp.onnx', '2c3c1d144bfa61ad236e92e169c13535c880469a12a047d4e73451f2c059a0ec', 230444),
    # Kong et al., "High-resolution Piano Transcription with Pedals" (ByteDance),
    # code Apache-2.0, weights CC-BY-4.0 (Zenodo record 4034264); the same
    # bytes as on Zenodo, mirrored by Xavier Riley (one of the transcription
    # researchers whose models share the repo).
    'piano': ('xavriley/midi-transcription-models', 'b7bec65a2b860aca72856b0feef58b5df407b777',
              'note_F1=0.9677_pedal_F1=0.9186.pth', 'c3fa9730725bf4a762f1c14bc80cd5986eacda01b026f5a4a2525cd607876141', 171966578),
    # Demucs v4 (Hybrid Transformer), MIT, from its author's own namespace;
    # demucs >= 4.1 loads these itself. Sources: drums, bass, other, vocals.
    'htdemucs': ('adefossez/HTDemucs', 'cbc8a9b1a87023b7fd74e7b3412e6321c0eab003',
                 '955717e8.safetensors', 'd9fa14133cfcc034a6758923bb3a8ca9f8dfd0b582134643bbf83f72c17576dd', 84025440),
}
PPQ = 480


def log(msg):
    sys.stderr.write('transcribe: %s\n' % msg)

# ---------------------------------------------------------------- models


def fetch(name):
    """The local path of a pinned model file (downloaded once, then cached)."""
    from huggingface_hub import hf_hub_download
    repo, rev, fname, sha, _ = MODELS[name]
    path = hf_hub_download(repo, fname, revision=rev)
    if sha:
        h = hashlib.sha256()
        with open(path, 'rb') as fh:
            for block in iter(lambda: fh.read(1 << 20), b''):
                h.update(block)
        if h.hexdigest() != sha:
            raise SystemExit('transcribe: %s/%s does not match its pinned SHA-256; not using it' % (repo, fname))
    return path


def load_demucs():
    """Demucs htdemucs at the pinned revision (the yaml names the models in the bag)."""
    import yaml
    from huggingface_hub import hf_hub_download
    from demucs.apply import BagOfModels
    from demucs.hf import load_safetensors_model
    repo, rev, _, _, _ = MODELS['htdemucs']
    with open(hf_hub_download(repo, 'htdemucs.yaml', revision=rev)) as fh:
        bag = yaml.safe_load(fh)
    if bag['models'] != ['955717e8']:
        raise SystemExit('transcribe: unexpected htdemucs bag %r' % bag['models'])
    models = [load_safetensors_model(fetch('htdemucs'))]
    model = BagOfModels(models, bag.get('weights'), bag.get('segment'))
    model.eval()
    return model

# ---------------------------------------------------------------- audio -> notes


def load_audio(path, sr):
    import librosa
    y, _ = librosa.load(path, sr=sr, mono=True)
    return y


def basic_pitch_notes(wav_path, onset=0.5, frame=0.3, min_ms=80):
    """[(start s, end s, pitch, velocity)] from Basic Pitch (ONNX)."""
    import logging
    logging.getLogger().setLevel(logging.ERROR)  # basic-pitch warns about the backends it does not use
    from basic_pitch.inference import Model, predict
    model = Model(fetch('basic-pitch'))
    _, _, events = predict(wav_path, model, onset_threshold=onset, frame_threshold=frame,
                           minimum_note_length=min_ms, melodia_trick=True)
    return sorted((float(s), float(e), int(p), max(1, min(127, int(round(a * 127))))) for s, e, p, a, *_ in events)


def piano_notes(wav_path, device):
    """[(start s, end s, pitch, velocity)] from the high-resolution piano model."""
    import torch
    from piano_transcription_inference import PianoTranscription, sample_rate
    audio = load_audio(wav_path, sample_rate)
    pt = PianoTranscription(checkpoint_path=fetch('piano'), device=torch.device(device))
    out = pt.transcribe(audio, None)
    return sorted((float(e['onset_time']), float(e['offset_time']), int(e['midi_note']), int(e['velocity']))
                  for e in out['est_note_events'])


def separate(path, workdir, device):
    """{'vocals': wav, 'bass': wav, 'other': wav, 'drums': wav} with Demucs."""
    import numpy as np
    import soundfile as sf
    import torch
    import librosa
    from demucs.apply import apply_model
    model = load_demucs()
    y, _ = librosa.load(path, sr=model.samplerate, mono=False)
    if y.ndim == 1:
        y = np.stack([y, y])
    wav = torch.from_numpy(y.astype('float32'))
    ref = wav.mean(0)
    mean, std = ref.mean(), ref.std() + 1e-8
    with torch.no_grad():
        out = apply_model(model, ((wav - mean) / std)[None], device=device, shifts=0, split=True, overlap=0.25, progress=False)
    out = out * std + mean
    stems = {}
    for name, src in zip(model.sources, out[0]):
        p = os.path.join(workdir, name + '.wav')
        sf.write(p, src.mean(0).cpu().numpy(), model.samplerate)
        stems[name] = p
    return stems


HARMONICS = (12, 19, 24, 28, 31, 34, 36)  # semitones from a fundamental to its 2nd-8th partials


def drop_harmonics(notes, ratio=0.7):
    """Drop notes that are an overtone of a louder note sounding at their onset
    (a transcription model hears strong partials as notes of their own).
    A real octave doubling played as loud as the bass note stays."""
    out = []
    for n in notes:
        ghost = any(m[2] < n[2] and (n[2] - m[2]) in HARMONICS and m[0] <= n[0] + 0.05 and m[1] >= n[0]
                    and n[3] < ratio * m[3] for m in notes)
        if not ghost:
            out.append(n)
    return out


def skyline(notes, highest=True):
    """One line: at any time only the highest (or lowest) sounding note.
    Notes starting within 30 ms count as together; a note is cut where the
    next one of the line starts; a note inside a longer, more extreme one is dropped."""
    out = []
    for n in sorted(notes, key=lambda n: (n[0], -n[2] if highest else n[2])):
        if out and n[0] - out[-1][0] < 0.03:
            continue
        if out and n[0] < out[-1][1]:
            prev = out[-1]
            if (n[2] < prev[2] if highest else n[2] > prev[2]) and n[1] <= prev[1]:
                continue
            out[-1] = (prev[0], n[0], prev[2], prev[3])
        out.append(n)
    return out

# ---------------------------------------------------------------- beats


def beat_map(path, bpm=None):
    """(bpm, seconds -> beats): beats from librosa's tracker, or a constant tempo."""
    import numpy as np
    import librosa
    if bpm:
        return float(bpm), lambda t: t * float(bpm) / 60.0
    y, sr = librosa.load(path, sr=22050, mono=True)
    tempo, beats = librosa.beat.beat_track(y=y, sr=sr, units='time')
    beats = np.asarray(beats, dtype=float)
    if len(beats) < 4:
        t = float(np.atleast_1d(tempo)[0]) or 120.0
        return t, lambda s: s * t / 60.0
    period = float(np.median(np.diff(beats)))
    # trackers often lock onto half or double the beat: fold into 70-180 bpm
    k = 1.0
    while 60.0 / period * k < 70:
        k *= 2
    while 60.0 / period * k > 180:
        k /= 2

    def to_beats(t):
        if t <= beats[0]:
            b = (t - beats[0]) / period
        elif t >= beats[-1]:
            b = len(beats) - 1 + (t - beats[-1]) / period
        else:
            b = float(np.interp(t, beats, np.arange(len(beats))))
        return b * k
    return 60.0 / period * k, to_beats


def write_midi(path, tracks, bpm, to_beats, title):
    """tracks: [(name, [(start s, end s, pitch, vel)])] -> MIDI with beat-aligned ticks."""
    import mido
    starts = [to_beats(n[0]) for _, ns in tracks for n in ns]
    shift = -min(0.0, min(starts)) if starts else 0.0
    shift = float(int(shift) + (shift > int(shift)))  # whole beats, so the bar phase survives
    mid = mido.MidiFile(type=1, ticks_per_beat=PPQ)
    meta = mido.MidiTrack()
    meta.append(mido.MetaMessage('set_tempo', tempo=int(round(60000000 / bpm)), time=0))
    meta.append(mido.MetaMessage('track_name', name=title, time=0))
    mid.tracks.append(meta)
    for ch, (name, notes) in enumerate(tracks):
        evs = []
        for s, e, p, v in notes:
            a = int(round((to_beats(s) + shift) * PPQ))
            b = max(a + 1, int(round((to_beats(e) + shift) * PPQ)))
            evs.append((a, 1, p, v))
            evs.append((b, 0, p, 0))
        evs.sort()
        tr = mido.MidiTrack()
        tr.append(mido.MetaMessage('track_name', name=name, time=0))
        now = 0
        for t, on, p, v in evs:
            tr.append(mido.Message('note_on' if on else 'note_off', note=p, velocity=v, channel=ch, time=t - now))
            now = t
        mid.tracks.append(tr)
    mid.save(path)

# ---------------------------------------------------------------- setup check


def check():
    """Print each setup step as ok / missing, with the fix. Exit 1 if a required one is missing."""
    bad = False

    def row(ok, what, fix='', optional=False):
        mark = 'ok  ' if ok else ('opt ' if optional else 'MISS')
        sys.stdout.write('%s %s%s\n' % (mark, what, '' if ok else '\n       -> ' + fix))
        return ok

    import logging
    logging.getLogger().setLevel(logging.ERROR)  # basic-pitch warns about backends it does not use

    row(sys.version_info >= (3, 10), 'Python %d.%d (3.10+; 3.11 tested)' % sys.version_info[:2], 'use Python 3.10-3.12 for the venv')
    in_venv = sys.prefix != getattr(sys, 'base_prefix', sys.prefix)
    row(in_venv, 'running inside a virtual environment (%s)' % sys.prefix, 'run setup.sh and use <venv>/bin/python')
    for mod, what, req in (('huggingface_hub', 'huggingface_hub (downloads the models)', True),
                           ('basic_pitch', 'basic-pitch + onnxruntime (default transcription)', True),
                           ('onnxruntime', 'onnxruntime', True), ('librosa', 'librosa (audio, beats)', True),
                           ('mido', 'mido (MIDI out)', True),
                           ('demucs', 'demucs (optional: --separate)', False),
                           ('piano_transcription_inference', 'piano_transcription_inference (optional: --model piano)', False)):
        try:
            importlib.import_module(mod)
            row(True, what)
        except Exception:
            row(False, what, 'setup.sh%s' % ('' if req else ' --with-separation' if mod == 'demucs' else ' --with-piano'), not req)
            bad = bad or req
    row(bool(shutil.which('ffmpeg')), 'ffmpeg (optional: decodes MP3/M4A when libsndfile cannot)', 'install ffmpeg (brew install ffmpeg / apt install ffmpeg)', True)
    hf = os.path.join(os.path.dirname(sys.executable), 'hf')  # the venv's, from huggingface_hub
    if not os.path.exists(hf):
        hf = shutil.which('hf') or hf
    who = ''
    if os.path.exists(hf):
        r = subprocess.run([hf, 'auth', 'whoami'], capture_output=True, text=True)
        who = r.stdout.strip().splitlines()[0] if r.returncode == 0 and r.stdout.strip() else ''
    row(bool(who), 'Hugging Face login (optional for these models: %s)' % (who or 'anonymous'),
        'optional: the user runs `%s auth login` in their own terminal and pastes the token there (never in chat)' % hf, True)
    try:
        from huggingface_hub import HfApi
        api = HfApi()
        for name, (repo, rev, fname, _, size) in sorted(MODELS.items()):
            info = api.model_info(repo, revision=rev)
            gated = getattr(info, 'gated', False)
            row(not gated, 'model %s: %s@%s (%s, %.1f MB)' % (name, repo, rev[:7], fname, size / 1e6),
                'gated: open https://huggingface.co/%s, accept the terms while logged in, then `hf auth login`' % repo)
    except Exception as e:  # offline, or no huggingface_hub
        row(False, 'Hugging Face Hub reachable', 'check the network (%s)' % type(e).__name__)
        bad = True
    sys.stdout.write('setup: %s\n' % ('incomplete' if bad else 'ok'))
    return 1 if bad else 0

# ---------------------------------------------------------------- main


def main(argv=None):
    ap = argparse.ArgumentParser(description='Audio to beat-aligned MIDI with models from the Hugging Face Hub.')
    ap.add_argument('input', nargs='?')
    ap.add_argument('-o', '--output', help='the .mid to write')
    ap.add_argument('--check', action='store_true', help='check the setup and exit')
    ap.add_argument('--model', choices=['basic-pitch', 'piano'], default='basic-pitch')
    ap.add_argument('--separate', action='store_true', help='Demucs first: vocals as the melody, bass as the bass line')
    ap.add_argument('--with-other', action='store_true', help='with --separate: add the "other" stem (guitars, keys) to the lower staff')
    ap.add_argument('--melody', action='store_true', help='keep only the top line (a melody/lead sheet)')
    ap.add_argument('--keep-harmonics', action='store_true', help='keep quiet notes an octave/twelfth/... above a louder one')
    ap.add_argument('--bpm', type=float, help='the tempo, if you know it (skips beat tracking)')
    ap.add_argument('--start', type=float, default=0.0, help='seconds to skip at the start')
    ap.add_argument('--duration', type=float, help='seconds to transcribe')
    ap.add_argument('--device', default='cpu', help='torch device for Demucs/piano (cpu, cuda, mps)')
    ap.add_argument('--keep-stems', help='with --separate: keep the separated stems in this directory')
    ap.add_argument('--title')
    args = ap.parse_args(argv)
    if args.check:
        return check()
    if not args.input or not args.output:
        ap.error('give an input file and -o out.mid (or --check)')
    title = args.title or os.path.splitext(os.path.basename(args.input))[0]
    if args.input.lower().endswith(('.mid', '.midi')):
        shutil.copyfile(args.input, args.output)
        log('MIDI in: nothing to transcribe; run midi2abc.py on %s' % args.output)
        return 0

    import tempfile
    import soundfile as sf
    work = args.keep_stems or tempfile.mkdtemp(prefix='transcribe-')
    os.makedirs(work, exist_ok=True)
    # one decoded, trimmed mono WAV for every model
    y = load_audio(args.input, 44100)
    a = int(args.start * 44100)
    b = len(y) if args.duration is None else a + int(args.duration * 44100)
    mix = os.path.join(work, 'mix.wav')
    sf.write(mix, y[a:b], 44100)
    log('audio: %.1f s' % ((min(b, len(y)) - a) / 44100))

    bpm, to_beats = beat_map(mix, args.bpm)
    log('tempo: %.1f bpm%s' % (bpm, ' (given)' if args.bpm else ' (beat tracking)'))
    model = (lambda p: piano_notes(p, args.device)) if args.model == 'piano' else basic_pitch_notes
    transcribe_one = model if args.keep_harmonics else (lambda p: drop_harmonics(model(p)))
    if args.separate:
        stems = separate(mix, work, args.device)
        # stems bleed: keep each line in its instrument's range (voice from C3, bass up to E4)
        melody = skyline([n for n in transcribe_one(stems['vocals']) if n[2] >= 48], highest=True)
        low = skyline([n for n in transcribe_one(stems['bass']) if n[2] <= 64], highest=False)
        if args.with_other:
            low = sorted(low + transcribe_one(stems['other']))
        tracks = [('melody', melody), ('accompaniment', low)]
        log('separated (htdemucs): %d melody notes, %d accompaniment notes' % (len(melody), len(low)))
    else:
        notes = transcribe_one(mix)
        if args.melody:
            notes = skyline(notes, highest=True)
        tracks = [('notes', notes)]
        log('%s: %d notes' % (args.model, len(notes)))
    write_midi(args.output, [t for t in tracks if t[1]], bpm, to_beats, title)
    if not args.keep_stems:
        shutil.rmtree(work, ignore_errors=True)
    log('wrote %s; next: python3 midi2abc.py %s -o %s.abc' % (args.output, args.output, os.path.splitext(args.output)[0]))
    return 0


if __name__ == '__main__':
    sys.exit(main())
