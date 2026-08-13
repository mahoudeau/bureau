#!/bin/sh
# project-of.sh: resolve which Bureau project a directory belongs to.
# Licensed Apache-2.0 (LICENSE-APACHE at the repo root).
#
# Resolution order (most explicit wins):
#   1. A .bureau file at the git root (or the directory itself): its content is the project id.
#   2. The map file (default ~/.bureau-projects): lines "path prefix = project id", longest prefix wins.
#   3. Otherwise prints "unresolved" and exits 1: the agent decides once and records it with `set`.
#
# Usage:
#   project-of.sh get [dir]          print the project id for dir (default: cwd)
#   project-of.sh set <dir> <id>     record a decision in the map file
set -e
MAP="${BUREAU_PROJECT_MAP:-$HOME/.bureau-projects}"
CMD="${1:-get}"

root_of() {
  d=$(cd "${1:-.}" && pwd)
  git -C "$d" rev-parse --show-toplevel 2>/dev/null || echo "$d"
}

case "$CMD" in
  get)
    DIR=$(root_of "${2:-.}")
    if [ -f "$DIR/.bureau" ]; then
      head -1 "$DIR/.bureau" | tr -d ' \n'
      exit 0
    fi
    if [ -f "$MAP" ]; then
      BEST=""; BEST_LEN=0
      while IFS='=' read -r prefix id; do
        prefix=$(echo "$prefix" | sed 's/[[:space:]]*$//;s/^[[:space:]]*//')
        id=$(echo "$id" | tr -d ' ')
        [ -z "$prefix" ] && continue
        case "$DIR/" in
          "$prefix"/*|"$prefix")
            LEN=${#prefix}
            if [ "$LEN" -gt "$BEST_LEN" ]; then BEST="$id"; BEST_LEN=$LEN; fi ;;
        esac
      done < "$MAP"
      if [ -n "$BEST" ]; then echo "$BEST"; exit 0; fi
    fi
    echo "unresolved"; exit 1 ;;
  set)
    [ -n "$2" ] && [ -n "$3" ] || { echo "usage: project-of.sh set <dir> <id>" >&2; exit 2; }
    DIR=$(root_of "$2")
    echo "$DIR = $3" >> "$MAP"
    echo "recorded: $DIR = $3" ;;
  *)
    echo "usage: project-of.sh get [dir] | set <dir> <id>" >&2; exit 2 ;;
esac
