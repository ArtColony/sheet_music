#!/bin/sh
# Make a virtual environment for transcribe.py (the audio side of the
# audio-to-sheet-music skill). Nothing is installed outside VENV.
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

if command -v uv >/dev/null 2>&1; then
  # uv fetches a Python 3.11 if the machine has none (the tested version)
  [ -x "$venv/bin/python" ] || uv venv --python 3.11 "$venv"
  pip() { uv pip install --python "$venv/bin/python" "$@"; }
else
  py=python3
  for v in python3.11 python3.12 python3.10; do command -v $v >/dev/null 2>&1 && { py=$v; break; }; done
  [ -x "$venv/bin/python" ] || "$py" -m venv "$venv"
  "$venv/bin/python" -m pip install --quiet --upgrade pip
  pip() { "$venv/bin/python" -m pip install --quiet "$@"; }
fi

pip -r "$here/requirements.txt"
pip --no-deps basic-pitch==0.4.0
[ $sep = 1 ] && pip torch==2.15.0 demucs==4.1.0
[ $piano = 1 ] && pip torch==2.15.0 torchlibrosa==0.1.0 matplotlib piano_transcription_inference==0.0.6
echo "setup.sh: done; check it with: $venv/bin/python $here/transcribe.py --check"
