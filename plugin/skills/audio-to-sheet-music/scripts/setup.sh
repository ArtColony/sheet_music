#!/bin/sh
# Make a virtual environment for transcribe.py (the audio side of the
# audio-to-sheet-music skill). Packages go into VENV only. Outside it: pip's
# or uv's download cache, and, when no Python 3.10-3.12 is on the machine
# and uv is, the Python 3.11 that uv downloads into its own directory
# (~/.local/share/uv/python). Models later go to the Hugging Face cache.
#
#   sh setup.sh VENV                      Basic Pitch (ONNX): ~300 MB of packages
#   sh setup.sh VENV --with-separation    + Demucs and PyTorch (~1 GB more)
#   sh setup.sh VENV --with-piano         + the piano model's code and PyTorch
#
# Then: VENV/bin/python transcribe.py --check
set -eu
here=$(cd "$(dirname "$0")" && pwd)
venv=${1:?usage: setup.sh VENV [--with-separation] [--with-piano]}
shift
sep=0 piano=0
for a in "$@"; do
  case $a in
    --with-separation) sep=1 ;;
    --with-piano) piano=1 ;;
    *) echo "setup.sh: unknown option $a" >&2; exit 2 ;;
  esac
done

# a Python 3.10-3.12 already on the machine, preferring the tested 3.11
py=
for v in python3.11 python3.12 python3.10 python3; do
  if command -v $v >/dev/null 2>&1 && $v -c 'import sys; sys.exit(not (3, 10) <= sys.version_info[:2] <= (3, 12))'; then py=$v; break; fi
done
if command -v uv >/dev/null 2>&1; then
  if [ ! -x "$venv/bin/python" ]; then
    if [ -n "$py" ]; then uv venv --python "$(command -v $py)" "$venv"
    else echo "setup.sh: no Python 3.10-3.12 here; uv will download Python 3.11 into its own directory" >&2; uv venv --python 3.11 "$venv"; fi
  fi
  pip() { uv pip install --python "$venv/bin/python" "$@"; }
else
  [ -n "$py" ] || { echo "setup.sh: needs Python 3.10-3.12 (or uv)" >&2; exit 1; }
  [ -x "$venv/bin/python" ] || "$py" -m venv "$venv"
  "$venv/bin/python" -m pip install --quiet --upgrade pip
  pip() { "$venv/bin/python" -m pip install --quiet "$@"; }
fi

pip -r "$here/requirements.txt"
pip --no-deps basic-pitch==0.4.0
[ $sep = 1 ] && pip torch==2.15.0 demucs==4.1.0
[ $piano = 1 ] && pip torch==2.15.0 torchlibrosa==0.1.0 matplotlib piano_transcription_inference==0.0.6
echo "setup.sh: done; check it with: $venv/bin/python $here/transcribe.py --check"
