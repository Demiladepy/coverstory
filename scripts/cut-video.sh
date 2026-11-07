#!/usr/bin/env bash
#
# Cut the submission video from the four screen recordings.
#
# Every segment is normalised to the same thing before anything is joined:
# 1920x1080, 30fps, stereo AAC at 48k. Concatenating mismatched streams is
# the one thing that reliably produces a file that plays for four seconds
# and then stops, so nothing here is joined until it is identical.
#
# The recordings are 1920x1008 of a Chrome window, so the top 130 rows are
# tab strip and address bar and get cropped off. What is left is 1920x878,
# which is wider than 16:9, so it is centred on a 1920x1080 field filled
# with the game's own background rather than black. It reads as deliberate
# letterboxing instead of a window someone forgot to crop.
#
# Order is chosen for somebody who will not watch to the end. The voice
# swap is the first thing on screen, before the title, before any
# explanation, because it is the only thing that has to land.
#
#   bash scripts/cut-video.sh
#
set -euo pipefail

IN="C:/Users/User/Downloads"
OUT="C:/Users/User/Downloads/cover-story-demo.mp4"
WORK="C:/Users/User/AppData/Local/Temp/coverstory-cut"
FONT="C\\:/Windows/Fonts/arialbd.ttf"
FONTR="C\\:/Windows/Fonts/arial.ttf"
BG="0x07080b"
LAMP="0xf0b44c"

C1="$IN/Cover Story - Google Chrome 2026-11-07 22-05-14.mp4"
C2="$IN/Cover Story - Google Chrome 2026-11-07 22-08-09.mp4"
C3="$IN/Cover Story - Google Chrome 2026-11-07 22-11-31.mp4"
C4="$IN/cover story 1.mp4"

rm -rf "$WORK"; mkdir -p "$WORK"
n=0
list="$WORK/list.txt"
: > "$list"

say() { printf '  %s\n' "$*"; }
# Git Bash has no bc, and every duration here has a decimal in it.
sub() { awk -v a="$1" -v b="$2" 'BEGIN { printf "%.3f", a - b }'; }

# A piece of gameplay: crop the browser off, letterbox, normalise.
# game <file> <start> <duration> <label>
game() {
  n=$((n + 1))
  local out
  out="$(printf '%s/%02d.mp4' "$WORK" "$n")"
  say "$4"
  ffmpeg -v error -ss "$2" -t "$3" -i "$1" \
    -vf "crop=1920:878:0:130,pad=1920:1080:0:101:color=$BG,fps=30,format=yuv420p" \
    -af "aformat=sample_rates=48000:channel_layouts=stereo,afade=t=in:st=0:d=0.12,afade=t=out:st=$(sub "$3" 0.12):d=0.12" \
    -c:v libx264 -crf 20 -preset veryfast -c:a aac -b:a 192k -ar 48000 -ac 2 \
    -video_track_timescale 30000 -y "$out"
  echo "file '$out'" >> "$list"
}

# The cover plate, which was recorded without the browser and has no sound.
# plate <file> <start> <duration> <label>
plate() {
  n=$((n + 1))
  local out
  out="$(printf '%s/%02d.mp4' "$WORK" "$n")"
  say "$4"
  ffmpeg -v error -ss "$2" -t "$3" -i "$1" \
    -f lavfi -t "$3" -i anullsrc=channel_layout=stereo:sample_rate=48000 \
    -vf "crop=iw-26:ih:0:0,scale=1920:-2,pad=1920:1080:0:(1080-ih)/2:color=$BG,fps=30,format=yuv420p" \
    -map 0:v -map 1:a \
    -c:v libx264 -crf 20 -preset veryfast -c:a aac -b:a 192k -ar 48000 -ac 2 \
    -video_track_timescale 30000 -y "$out"
  echo "file '$out'" >> "$list"
}

# A text card. Up to three lines, plus an amber kicker above them.
# card <duration> <kicker> <line1> <line2> <line3>
card() {
  n=$((n + 1))
  local out dur kicker l1 l2 l3 filter
  out="$(printf '%s/%02d.mp4' "$WORK" "$n")"
  dur="$1"; kicker="$2"; l1="$3"; l2="${4:-}"; l3="${5:-}"
  say "card: $l1"

  filter="format=yuv420p"
  # A hint of the hallway lamp at the bottom, so the cards belong to the
  # same room as the footage rather than looking like slides dropped in.
  filter="$filter,drawbox=x=0:y=1070:w=1920:h=10:color=$LAMP@0.5:t=fill"
  if [ -n "$kicker" ]; then
    filter="$filter,drawtext=fontfile='$FONTR':text='$kicker':x=(w-tw)/2:y=372:fontsize=30:fontcolor=$LAMP:alpha=0.9"
  fi
  filter="$filter,drawtext=fontfile='$FONT':text='$l1':x=(w-tw)/2:y=444:fontsize=78:fontcolor=white"
  [ -n "$l2" ] && filter="$filter,drawtext=fontfile='$FONT':text='$l2':x=(w-tw)/2:y=546:fontsize=78:fontcolor=white"
  [ -n "$l3" ] && filter="$filter,drawtext=fontfile='$FONTR':text='$l3':x=(w-tw)/2:y=676:fontsize=38:fontcolor=0xb9c0cf"
  # Up out of black and back down, so a cut never lands on full brightness.
  filter="$filter,fade=t=in:st=0:d=0.3,fade=t=out:st=$(sub "$dur" 0.3):d=0.3"

  ffmpeg -v error -f lavfi -t "$dur" -i "color=c=$BG:s=1920x1080:r=30" \
    -f lavfi -t "$dur" -i anullsrc=channel_layout=stereo:sample_rate=48000 \
    -vf "$filter" \
    -c:v libx264 -crf 20 -preset veryfast -c:a aac -b:a 192k -ar 48000 -ac 2 \
    -video_track_timescale 30000 -y "$out"
  echo "file '$out'" >> "$list"
}

echo "Building segments"

# --- the hook. No title, no narration, no context. ----------------------
# The driver asks for an adult, a child answers, a man's voice comes out.
# Anyone who watches only the first fifteen seconds has seen the product.
game "$C1" 24.5 14.1 "cold open: the voice swap"

card 4.0 "COVER STORY" "You are twelve." "You are home alone." ""

# --- now, and only now, what the thing is ------------------------------
plate "$C4" 0.2 3.6 "the hallway"
game  "$C1" 15.0 7.0 "prep: three lines, written before the knock"

card 2.5 "" "They need an adult." "So be one." ""

# --- the shout ----------------------------------------------------------
game "$C1" 38.6 17.4 "the driver pushes back, and the answer gets louder"
card 2.5 "MEASURED AGAINST YOUR OWN VOICE" "Shout, and he shouts." "" ""

# --- and the door closes ------------------------------------------------
game "$C1" 56.0 16.4 "he gives up"
card 2.5 "" "Every answer is on" "the record." "What you tell one of them, the next one can check."

# --- the neighbour, who is not buying it --------------------------------
game "$C2" 8.0 20.0 "the neighbour, suspicion climbing"
card 2.5 "" "Four doors. One night." "One story to keep straight." ""

# --- christmas eve, the one that knows the family -----------------------
game "$C3" 56.0 26.0 "the aunt asks who is actually speaking"

# --- why you would play it ----------------------------------------------
card 4.0 "" "No buttons to press." "Just talk." "Hold a key, say anything you want, in your own words."
card 4.0 "" "It is never the same" "conversation twice." "Every visitor line is written on the spot."
card 4.0 "" "You will get caught." "That is the good part." "Lie badly enough and they stop believing you."

card 5.0 "BUILT ON ASSEMBLYAI" "Cover Story" "" "coverstory-eta.vercel.app/play"

echo "Joining"
ffmpeg -v error -f concat -safe 0 -i "$list" -c copy -y "$WORK/joined.mp4"

# The recordings come off the screen recorder at about -20.5 LUFS and
# YouTube plays back around -14, so without this a judge has to reach for
# the volume before they hear anybody speak. Fixed gain rather than
# loudnorm: loudnorm is dynamic and would ride the quiet pauses up into
# hiss. The limiter is only there to catch the peaks that gain pushes over.
echo "Lifting the audio"
ffmpeg -v error -i "$WORK/joined.mp4" -c:v copy   -af "volume=6.5dB,alimiter=limit=0.95:attack=5:release=50"   -c:a aac -b:a 192k -ar 48000 -ac 2 -y "$OUT"

dur=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$OUT")
size=$(ffprobe -v error -show_entries format=size -of csv=p=0 "$OUT")
awk -v o="$OUT" -v d="$dur" -v s="$size" "BEGIN {
  printf \"\nDone: %s\n  %d:%02d (%.1fs), %d MB\n\", o, int(d/60), int(d)%60, d, s/1048576
}"
