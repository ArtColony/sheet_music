#!/usr/bin/env python3
"""midi2abc: a Standard MIDI File in, ABC the sheet-music library engraves out.

    python3 midi2abc.py song.mid -o song.abc
    python3 midi2abc.py song.mid --meter 3/4 --key G --pickup 1/4 -o song.abc
    python3 midi2abc.py song.mid --notes            # the notes as JSON (for tests)

Deterministic and dependency-free (the Python standard library only): time
is exact (fractions.Fraction of a quarter note, from the file's ticks), the
pitch-class statistics for the key are integers, and every list is sorted
before it is used, so the same MIDI file gives the same ABC bytes everywhere.

What it does, in order:
  1. reads the notes (format 0 or 1, running status, note-on velocity 0 as
     note-off; channel 10 drums are dropped) and the tempo, time-signature
     and key-signature meta events;
  2. quantizes onsets and ends to a grid (--grid 16: sixteenth notes);
  3. takes the meter (--meter, else the file's time signature, else a guess
     from where the long notes fall) and the pickup (--pickup, else a guess);
  4. takes the key (--key, else the file's key signature, else the
     Krumhansl-Kessler profile that fits the duration-weighted pitch classes
     best) and spells every pitch in it;
  5. splits the notes into staves: two MIDI tracks become two staves (higher
     on top); one track (or more than two) is split at --split (middle C) when
     it spans both clefs, the highest note of each onset kept on top;
  6. makes each staff one voice: notes that start together become a chord,
     a note is cut where the next one starts, gaps become rests, notes are
     tied across bar lines, and accidentals are written when the bar needs
     them (they last to the end of the bar, per octave, as in lib/sm_perform.ps).

The timing of a MIDI file from a recording is only as good as its tempo:
transcribe.py writes MIDI whose ticks follow the detected beats. For a MIDI
file played freely against a default tempo, pass --bpm (the tempo it was
actually played at) so seconds are read as beats at that tempo.
"""
import argparse
import json
import os
import sys
from fractions import Fraction as F

# ---------------------------------------------------------------- reading MIDI


class MidiError(Exception):
    pass


def _vlq(data, i):
    n = 0
    while True:
        if i >= len(data):
            raise MidiError('truncated variable-length number')
        b = data[i]
        i += 1
        n = (n << 7) | (b & 0x7F)
        if not b & 0x80:
            return n, i


def read_midi(data):
    """The notes and metas of a Standard MIDI File (bytes).

    Returns {ppq, notes: [{start, end, pitch, vel, track, chan}] (ticks),
    tempos: [(tick, us_per_quarter)], timesigs: [(tick, num, den)],
    keysigs: [(tick, sharps, minor)], names: {track: name}}.
    """
    if data[:4] != b'MThd':
        raise MidiError('not a Standard MIDI File (no MThd)')
    hlen = int.from_bytes(data[4:8], 'big')
    fmt = int.from_bytes(data[8:10], 'big')
    ntracks = int.from_bytes(data[10:12], 'big')
    division = int.from_bytes(data[12:14], 'big')
    if division & 0x8000:
        raise MidiError('SMPTE time division is not supported')
    if fmt not in (0, 1):
        raise MidiError('MIDI format %d is not supported (only 0 and 1)' % fmt)
    out = {'ppq': division, 'notes': [], 'tempos': [], 'timesigs': [], 'keysigs': [], 'names': {}}
    pos = 8 + hlen
    for track in range(ntracks):
        if data[pos:pos + 4] != b'MTrk':
            raise MidiError('track %d: no MTrk' % track)
        tlen = int.from_bytes(data[pos + 4:pos + 8], 'big')
        tr = data[pos + 8:pos + 8 + tlen]
        pos += 8 + tlen
        i, t, status = 0, 0, 0
        on = {}  # (chan, pitch) -> [(start, vel)], first in first out
        while i < len(tr):
            dt, i = _vlq(tr, i)
            t += dt
            b = tr[i]
            if b & 0x80:
                status = b
                i += 1
            elif not status:
                raise MidiError('track %d: running status with no status' % track)
            if status == 0xFF:
                kind = tr[i]
                ln, i = _vlq(tr, i + 1)
                body = tr[i:i + ln]
                i += ln
                if kind == 0x51 and ln == 3:
                    out['tempos'].append((t, int.from_bytes(body, 'big')))
                elif kind == 0x58 and ln >= 2:
                    out['timesigs'].append((t, body[0], 1 << body[1]))
                elif kind == 0x59 and ln == 2:
                    sf = body[0] - 256 if body[0] > 127 else body[0]
                    out['keysigs'].append((t, sf, body[1]))
                elif kind == 0x03 and track not in out['names']:
                    out['names'][track] = body.decode('utf-8', 'replace').strip()
                elif kind == 0x2F:
                    break
                status = 0  # meta and sysex cancel running status
                continue
            if status in (0xF0, 0xF7):
                ln, i = _vlq(tr, i)
                i += ln
                status = 0
                continue
            hi, chan = status & 0xF0, status & 0x0F
            nbytes = 1 if hi in (0xC0, 0xD0) else 2
            a = tr[i]
            v = tr[i + 1] if nbytes == 2 else 0
            i += nbytes
            if hi == 0x90 and v > 0:
                on.setdefault((chan, a), []).append((t, v))
            elif hi == 0x80 or (hi == 0x90 and v == 0):
                q = on.get((chan, a))
                if q:
                    s, vel = q.pop(0)
                    if t > s:
                        out['notes'].append({'start': s, 'end': t, 'pitch': a, 'vel': vel, 'track': track, 'chan': chan})
        for (chan, a), q in sorted(on.items()):  # never released: end with the track
            for s, vel in q:
                if t > s:
                    out['notes'].append({'start': s, 'end': t, 'pitch': a, 'vel': vel, 'track': track, 'chan': chan})
    out['notes'].sort(key=lambda n: (n['start'], n['pitch'], n['end'], n['track'], n['chan']))
    for k in ('tempos', 'timesigs', 'keysigs'):
        out[k].sort()
    return out


def seconds_to_beats(midi, bpm):
    """Re-read note times as seconds (through the file's tempo map), then as
    quarter notes at bpm. For MIDI played freely against a default tempo."""
    ppq = midi['ppq']
    tempos = midi['tempos'] or [(0, 500000)]
    if tempos[0][0] != 0:
        tempos = [(0, 500000)] + tempos

    def us(tick):
        total, last_t, last_us = 0, 0, tempos[0][1]
        for t0, u in tempos:
            if t0 >= tick:
                break
            total += (t0 - last_t) * last_us
            last_t, last_us = t0, u
        return total + (tick - last_t) * last_us  # microseconds * ppq

    per_beat = F(60000000, 1) / F(bpm)  # microseconds per quarter
    return lambda tick: F(us(tick), ppq) / per_beat

# ---------------------------------------------------------------- keys


NAMES = 'C D E F G A B'.split()
STEP_PC = [0, 2, 4, 5, 7, 9, 11]
SHARP_ORDER = 'FCGDAEB'
MAJOR_NAMES = {-7: 'Cb', -6: 'Gb', -5: 'Db', -4: 'Ab', -3: 'Eb', -2: 'Bb', -1: 'F', 0: 'C',
               1: 'G', 2: 'D', 3: 'A', 4: 'E', 5: 'B', 6: 'F#', 7: 'C#'}
MINOR_NAMES = {-7: 'Abm', -6: 'Ebm', -5: 'Bbm', -4: 'Fm', -3: 'Cm', -2: 'Gm', -1: 'Dm', 0: 'Am',
               1: 'Em', 2: 'Bm', 3: 'F#m', 4: 'C#m', 5: 'G#m', 6: 'D#m', 7: 'A#m'}
# Krumhansl-Kessler key profiles, times 100 (integers keep the sums exact)
KK_MAJOR = [635, 223, 348, 233, 446, 409, 252, 519, 239, 365, 229, 288]
KK_MINOR = [633, 268, 352, 538, 260, 353, 254, 475, 398, 269, 334, 317]
# the major key (fifths) with the fewest accidentals for each tonic pitch class
PC_FIFTHS = {0: 0, 7: 1, 2: 2, 9: 3, 4: 4, 11: 5, 6: 6, 1: -5, 8: -4, 3: -3, 10: -2, 5: -1}


def parse_key(text):
    """'G', 'Bb', 'F#m', 'Am', 'Ebmin' -> (fifths, minor)."""
    t = text.strip()
    minor = False
    for suf in ('minor', 'min', 'm'):
        if t.lower().endswith(suf) and len(t) > len(suf):
            t, minor = t[:-len(suf)], True
            break
    if t.lower().endswith('maj'):
        t = t[:-3]
    t = t[0].upper() + t[1:]
    table = MINOR_NAMES if minor else MAJOR_NAMES
    want = t + ('m' if minor else '')
    for f in sorted(table):
        if table[f] == want:
            return f, minor
    raise SystemExit('midi2abc: unknown key %r' % text)


def key_alters(fifths):
    """step index (0 = C) -> alteration in the key signature."""
    alt = [0] * 7
    if fifths > 0:
        for ch in SHARP_ORDER[:fifths]:
            alt[NAMES.index(ch)] = 1
    elif fifths < 0:
        for ch in SHARP_ORDER[::-1][:-fifths]:
            alt[NAMES.index(ch)] = -1
    return alt


def detect_key(notes):
    """(fifths, minor) for the notes.

    First the key signature: the ones that leave the least duration outside
    the scale (within 3% of the best), so the score needs the fewest
    accidentals. Then, among those, major or minor and the tonic from the
    Krumhansl-Kessler profiles (the dot product of the centred
    duration-weighted pitch-class histogram with each centred profile, in
    integers). Ties go to fewer accidentals, then to major."""
    hist = [F(0)] * 12
    for n in notes:
        hist[n['pitch'] % 12] += n['end'] - n['start']
    if not any(hist):
        return 0, False
    den = 1
    for x in hist:
        den = den * x.denominator // _gcd(den, x.denominator)
    h = [int(x * den) for x in hist]
    total = sum(h)
    outside = {}
    for fifths in range(-6, 7):
        kalt = key_alters(fifths)
        scale = {(STEP_PC[i] + kalt[i]) % 12 for i in range(7)}
        outside[fifths] = sum(h[pc] for pc in range(12) if pc not in scale)
    least = min(outside.values())
    allowed = {f for f in outside if (outside[f] - least) * 100 <= 3 * total}
    best = None
    for minor, prof in ((False, KK_MAJOR), (True, KK_MINOR)):
        mp = sum(prof)
        for tonic in range(12):
            major_pc = (tonic + 3) % 12 if minor else tonic
            fifths = PC_FIFTHS[major_pc]
            if fifths not in allowed:
                continue
            score = sum((12 * h[(tonic + i) % 12] - total) * (12 * prof[i] - mp) for i in range(12))
            cand = (-score, abs(fifths), minor, fifths)
            if best is None or cand < best:
                best = cand
    return best[3], best[2]


def _gcd(a, b):
    while b:
        a, b = b, a % b
    return a


def speller(fifths):
    """midi pitch -> (step index, alteration, octave) in the key."""
    kalt = key_alters(fifths)
    tonic_step = NAMES.index(MAJOR_NAMES[fifths][0])
    tonic_pc = (STEP_PC[tonic_step] + kalt[tonic_step]) % 12
    table = {}
    for s in range(7):  # the scale
        table[(STEP_PC[s] + kalt[s]) % 12] = (s, kalt[s])
    # the chromatic notes: #1 b3 #4 #5 b7 of the major key
    for off, degree, d in ((1, 0, 1), (3, 2, -1), (6, 3, 1), (8, 4, 1), (10, 6, -1)):
        s = (tonic_step + degree) % 7
        table.setdefault((tonic_pc + off) % 12, (s, kalt[s] + d))

    def spell(p):
        s, a = table[p % 12]
        octave = (p - STEP_PC[s] - a) // 12 - 1
        return s, a, octave
    return spell


def abc_pitch(s, octave):
    if octave >= 5:
        return NAMES[s].lower() + "'" * (octave - 5)
    return NAMES[s] + ',' * (4 - octave)

# ---------------------------------------------------------------- meter


def parse_frac(text):
    try:
        if '/' in text:
            a, b = text.split('/')
            return F(int(a), int(b))
        return F(int(text))
    except ValueError:
        raise SystemExit('midi2abc: not a fraction: %r' % text)


def downbeat_strength(notes, bar, phase):
    """The duration (capped at a bar) of the notes that start on a downbeat,
    per downbeat, for bars of `bar` quarters starting at `phase`."""
    end = max(n['end'] for n in notes)
    k = (end - phase) // bar + 1
    w = sum((min(n['end'] - n['start'], bar) for n in notes if (n['start'] - phase) % bar == 0), F(0))
    return w / k


def best_phase(notes, bar):
    """(strength, pickup in quarters): the strongest downbeat phase, in eighths.
    No pickup unless a pickup is clearly stronger (twice as strong)."""
    best = (downbeat_strength(notes, bar, F(0)), F(0))
    p = F(1, 2)
    while p < bar:
        s = downbeat_strength(notes, bar, p)
        if s > best[0] * 2 if best[1] == 0 else s > best[0]:
            best = (s, p)
        p += F(1, 2)
    return best


def guess_meter(notes):
    """(num, den, pickup in quarters) from where the notes fall.

    The meter with the strongest downbeats (downbeat_strength, at its
    strongest phase) wins, and its pickup is best_phase's; 4/4 is
    favoured in near-ties (5%), and 2/4 must beat it clearly. 6/8 is told
    from 3/4 by onsets on the half-bar."""
    results = []
    for num, den, bonus in ((4, 4, F(105, 100)), (3, 4, F(1)), (2, 4, F(80, 100))):
        bar = F(num * 4, den)
        strongest = max(downbeat_strength(notes, bar, F(p, 2)) for p in range(int(bar * 2)))
        results.append((-strongest * bonus, num, den, best_phase(notes, bar)[1]))
    results.sort()
    _, num, den, pickup = results[0]
    if (num, den) == (3, 4):
        on = lambda pos: sum(1 for n in notes if (n['start'] - pickup) % 3 == pos)
        if on(F(3, 2)) > on(F(1)) + on(F(2)):
            num, den = 6, 8
    return num, den, pickup

# ---------------------------------------------------------------- staves


def quantize(notes, grid):
    """Onsets and ends to the nearest grid point (quarters), at least one step long."""
    out = []
    for n in notes:
        s = _round(n['start'] / grid) * grid
        e = _round(n['end'] / grid) * grid
        if e <= s:
            e = s + grid
        out.append(dict(n, start=s, end=e))
    out.sort(key=lambda n: (n['start'], n['pitch'], n['end']))
    return out


def _round(x):
    return (x + F(1, 2)).__floor__()


def split_staves(notes, staves, split):
    """[[notes of the top staff], [notes of the bottom staff]] (or one staff)."""
    tracks = sorted({n['track'] for n in notes})
    if staves == 'auto':
        if len(tracks) == 2:
            groups = [[n for n in notes if n['track'] == t] for t in tracks]
            groups.sort(key=lambda g: -sum(n['pitch'] for n in g) / len(g))
            return groups
        lo = sum(1 for n in notes if n['pitch'] < split)
        staves = 2 if lo and len(notes) - lo and min(lo, len(notes) - lo) * 10 >= len(notes) else 1
    staves = int(staves)
    if staves == 1:
        return [list(notes)]
    top, bottom = [], []
    by_onset = {}
    for n in notes:
        by_onset.setdefault(n['start'], []).append(n)
    for t in sorted(by_onset):
        group = sorted(by_onset[t], key=lambda n: -n['pitch'])
        for i, n in enumerate(group):
            (top if (n['pitch'] >= split or (i == 0 and n['pitch'] >= split - 5)) else bottom).append(n)
    return [top, bottom]


def voice(notes):
    """One voice: [(start, end, [pitches])], chords for shared onsets, cut at the next onset."""
    by_onset = {}
    for n in notes:
        by_onset.setdefault(n['start'], []).append(n)
    starts = sorted(by_onset)
    out = []
    for i, t in enumerate(starts):
        group = by_onset[t]
        end = max(n['end'] for n in group)
        if i + 1 < len(starts):
            end = min(end, starts[i + 1])
        out.append((t, end, sorted({n['pitch'] for n in group})))
    return out

# ---------------------------------------------------------------- writing ABC


def length(q, unit):
    """A length in quarters as an ABC length multiplier of L (unit, in quarters)."""
    r = q / unit
    if r == 1:
        return ''
    if r.denominator == 1:
        return str(r.numerator)
    if r.numerator == 1:
        return {2: '/', 4: '//'}.get(r.denominator, '/%d' % r.denominator)
    return '%d/%d' % (r.numerator, r.denominator)


def bars_of(events, bar, pickup, total):
    """events (start, end, pitches) -> bars of pieces (start, dur, pitches|None, tie, tied_in)."""
    edges = []
    if pickup:
        edges.append(F(0))
    t = pickup
    while t < total:
        edges.append(t)
        t += bar
    edges.append(total)
    bars = []
    for b in range(len(edges) - 1):
        lo, hi = edges[b], edges[b + 1]
        pieces = []
        cur = lo
        for s, e, ps in events:
            if e <= lo or s >= hi:
                continue
            a, z = max(s, lo), min(e, hi)
            if a > cur:
                pieces.append((cur, a - cur, None, False, False))
            pieces.append((a, z - a, ps, e > hi, s < lo))
            cur = z
        if cur < hi:
            pieces.append((cur, hi - cur, None, False, False))
        bars.append(pieces)
    return bars


def bar_text(pieces, spell, unit, beat, bar_start, whole_bar, full_bar):
    """One bar of one voice as ABC, accidentals per bar and octave."""
    if all(p[2] is None for p in pieces) and full_bar:
        return 'z' + length(whole_bar, unit)
    acc = {}  # (step, octave) -> alteration written in this bar
    out = []
    prev_short = False
    for start, dur, ps, tie, tied_in in pieces:
        if ps is None:
            tok = 'z' + length(dur, unit)
        else:
            heads = []
            for p in ps:
                s, a, o = spell(p)
                cur = acc.get((s, o), spell.kalt[s])
                mark = ''
                # a note tied in from the last bar keeps its pitch without a sign
                if a != cur and not tied_in:
                    mark = {-2: '__', -1: '_', 0: '=', 1: '^', 2: '^^'}[a]
                    acc[(s, o)] = a
                heads.append(mark + abc_pitch(s, o))
            tok = heads[0] if len(heads) == 1 else '[' + ''.join(heads) + ']'
            tok += length(dur, unit) + ('-' if tie else '')
        short = dur < beat and ps is not None
        on_beat = (start - bar_start) % beat == 0
        if out and not (short and prev_short and not on_beat):
            out.append(' ')
        out.append(tok)
        prev_short = short
    return ''.join(out)


def to_abc(midi, args):
    grid = F(4, args.grid)
    ppq = midi['ppq']
    if args.bpm:
        conv = seconds_to_beats(midi, int(args.bpm))
        notes = [dict(n, start=conv(n['start']), end=conv(n['end'])) for n in midi['notes']]
        bpm = int(args.bpm)
    else:
        notes = [dict(n, start=F(n['start'], ppq), end=F(n['end'], ppq)) for n in midi['notes']]
        us = midi['tempos'][0][1] if midi['tempos'] else 500000
        bpm = _round(F(60000000, us))
    notes = [n for n in notes if n['chan'] != 9 or args.keep_drums]
    if not notes:
        raise SystemExit('midi2abc: no notes in the file')
    notes = quantize(notes, grid)
    t0 = min(n['start'] for n in notes)  # leading silence is not music
    if args.trim:
        notes = [dict(n, start=n['start'] - t0, end=n['end'] - t0) for n in notes]

    if args.meter:
        num, den = (int(x) for x in args.meter.split('/'))
        pickup = None
    elif midi['timesigs']:
        num, den = midi['timesigs'][0][1], midi['timesigs'][0][2]
        pickup = None
    else:
        num, den, pickup = guess_meter(notes)
    bar = F(num * 4, den)
    if args.pickup is not None:
        pickup = parse_frac(args.pickup) * 4
    elif pickup is None:
        pickup = best_phase(notes, bar)[1]
    pickup %= bar

    if args.key:
        fifths, minor = parse_key(args.key)
    elif midi['keysigs']:
        fifths, minor = midi['keysigs'][0][1], bool(midi['keysigs'][0][2])
    else:
        fifths, minor = detect_key(notes)
    spell = speller(fifths)
    spell.kalt = key_alters(fifths)

    staves = [s for s in split_staves(notes, args.staves, args.split) if s] or [notes]
    total = max(n['end'] for n in notes)
    # end on a bar line
    t = pickup if pickup else bar
    while t < total:
        t += bar
    total = t
    unit = F(1, 2)  # L:1/8
    compound = den == 8 and num % 3 == 0 and num > 3
    beat = F(3, 2) if compound else F(4, den)
    voices = [bars_of(voice(s), bar, pickup, total) for s in staves]

    title = args.title or midi['names'].get(0) or midi['names'].get(1) or os.path.splitext(os.path.basename(args.midi))[0]
    # one staff: the clef with fewer ledger lines (treble E4-F5, bass G2-A3)
    ledger = lambda lo, hi: sum(max(lo - n['pitch'], 0, n['pitch'] - hi) for n in staves[0])
    clefs = ['treble', 'bass'] if len(staves) == 2 else (['bass'] if ledger(43, 57) < ledger(64, 77) else ['treble'])
    key_name = (MINOR_NAMES if minor else MAJOR_NAMES)[fifths]
    lines = ['X:1', 'T:' + title.replace('\n', ' ')]
    if args.composer:
        lines.append('C:' + args.composer)
    lines += ['Z:' + (args.source or 'Transcribed with midi2abc (sheet-music plugin); check against the recording'),
              'M:%d/%d' % (num, den), 'L:1/8', 'Q:1/4=%d' % bpm]
    if len(staves) == 2:
        lines += ['%%score {RH LH}', 'V:RH clef=treble', 'V:LH clef=bass', 'K:' + key_name]
    else:
        lines.append('K:' + key_name + (' clef=bass' if clefs[0] == 'bass' else ''))
    nbars = len(voices[0])
    edges = []
    t = F(0)
    for b in range(nbars):
        edges.append(t)
        t += (pickup if (pickup and b == 0) else bar)
    per = args.bars_per_line
    for first in range(0, nbars, per):
        for v, bars in enumerate(voices):
            if len(staves) == 2:
                lines.append('V:' + ('RH' if v == 0 else 'LH'))
            parts = []
            for b in range(first, min(first + per, nbars)):
                full = not (pickup and b == 0)
                parts.append(bar_text(bars[b], spell, unit, beat, edges[b], bar, full))
            last = first + per >= nbars
            lines.append(' | '.join(parts) + (' |]' if last else ' |'))
    return '\n'.join(lines) + '\n'


def notes_json(midi):
    """The notes as [onset, duration, pitch] in quarters (exact fractions as strings)."""
    ppq = midi['ppq']
    rows = sorted((F(n['start'], ppq), F(n['end'] - n['start'], ppq), n['pitch']) for n in midi['notes'] if n['chan'] != 9)
    return json.dumps([[str(a), str(d), p] for a, d, p in rows])


def main(argv=None):
    ap = argparse.ArgumentParser(description='MIDI to ABC for the sheet-music library (deterministic).')
    ap.add_argument('midi')
    ap.add_argument('-o', '--output', help='the .abc to write (default: stdout)')
    ap.add_argument('--meter', help='e.g. 3/4, 6/8 (default: the file\'s, else guessed)')
    ap.add_argument('--key', help='e.g. G, Bb, F#m (default: the file\'s, else detected)')
    ap.add_argument('--pickup', help='the pickup as a fraction of a whole note, e.g. 1/4 (default: guessed)')
    ap.add_argument('--bpm', help='read the file as seconds and quarter notes at this tempo (MIDI played freely)')
    ap.add_argument('--grid', type=int, default=16, choices=[4, 8, 16, 32], help='quantize to this note value (16: sixteenths)')
    ap.add_argument('--staves', default='auto', choices=['auto', '1', '2'])
    ap.add_argument('--split', type=int, default=60, help='lowest pitch of the top staff when splitting (60: middle C)')
    ap.add_argument('--bars-per-line', type=int, default=4)
    ap.add_argument('--title')
    ap.add_argument('--composer')
    ap.add_argument('--source', help='the Z: line (where the music came from)')
    ap.add_argument('--no-trim', dest='trim', action='store_false', help='keep leading silence')
    ap.add_argument('--keep-drums', action='store_true')
    ap.add_argument('--notes', action='store_true', help='print the notes as JSON and exit')
    args = ap.parse_args(argv)
    with open(args.midi, 'rb') as fh:
        data = fh.read()
    try:
        midi = read_midi(data)
    except (MidiError, IndexError) as e:
        raise SystemExit('midi2abc: %s: %s' % (args.midi, e))
    if args.notes:
        sys.stdout.write(notes_json(midi) + '\n')
        return
    abc = to_abc(midi, args)
    if args.output:
        with open(args.output, 'w', encoding='utf-8', newline='\n') as fh:
            fh.write(abc)
    else:
        sys.stdout.write(abc)


if __name__ == '__main__':
    main()
