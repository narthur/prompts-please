#!/bin/bash
# Derive game sprites from the generated art.
# Reads assets/originals/ (never writes there); writes assets/derived/.
# Generated art is ~4 screen px per art pixel, so 25% box-filter recovers the grid.
# Render derived images with CSS `image-rendering: pixelated` to scale back up.
set -euo pipefail
cd "$(dirname "$0")"
O=assets/originals
D=assets/derived
rm -rf "$D"; mkdir -p "$D"/{scenes,props,characters/lineup,characters/busts,characters/portraits}
small() { magick "$1" "${@:3}" -filter box -resize 25% "$2"; }

# --- picks (variant 0 = unnumbered file) ---
small "$O/Operators_point_of_view_inside_a_small_customs_booth_a_thick(3).jpg" "$D/scenes/booth.png"
small "$O/Wide_side-view_background_of_a_dim_government_waiting_hall_t(1).jpg" "$D/scenes/hall.png"
small "$O/A_second_customs_window_seen_from_the_side_at_a_distance_its(2).jpg" "$D/scenes/other-window.png"
small "$O/A_cork_noticeboard_with_a_brass_frame_five_blank_pinned_memo(2).jpg" "$D/props/directive-board.png"
small "$O/An_open_cloth-bound_ledger_book_top-down_ruled_columns_blank(3).jpg" "$D/props/ledger.png"
small "$O/Title_logo_emblem_for_a_game_a_stamped_seal_shape_with_a_rob(1).jpg" "$D/props/logo.png"

# Forms: three papers on a dark background -> one file each (left/middle/right thirds, then trim the background).
F="$O/Top-down_flat_lay_of_three_blank_bureaucratic_paper_forms_si(3).jpg"
fx=(0 423 810 1248); i=0
for name in form-permission form-work form-complaint; do
  magick "$F" -crop $((fx[i+1]-fx[i]))x832+${fx[i]}+0 +repage -fuzz 12% -trim +repage -filter box -resize 25% "$D/props/$name.png"; i=$((i+1))
done

# Stamps: top row = handles, bottom row = ink marks.
S="$O/Three_rubber_stamps_with_wooden_handles_top-down_each_paired(1).jpg"
sx=(0 455 790 1248); i=0
for name in admit refuse return; do
  w=$((sx[i+1]-sx[i]))
  magick "$S" -crop ${w}x505+${sx[i]}+0 +repage -fuzz 10% -trim +repage -filter box -resize 25% "$D/props/stamp-$name.png"
  magick "$S" -crop ${w}x327+${sx[i]}+505 +repage -fuzz 10% -trim +repage -filter box -resize 25% "$D/props/ink-$name.png"
  i=$((i+1))
done

# --- characters ---
# Line-up: white background and a gray floor strip. Flood-fill both to transparent from seeds
# between the robots; dark outlines stop the fill, so floor shadows under the feet survive.
L="$O/pixel_art_robot_characters_for_a_game_like_papers_please copy.jpg"
draw=(-draw "color 4,4 floodfill" -draw "color 4,800 floodfill" -draw "color 1244,4 floodfill")
for x in 8 222 425 628 840 1045 1240; do draw+=(-draw "color $x,600 floodfill" -draw "color $x,648 floodfill"); done
magick "$L" -alpha set -fuzz 14% -fill none "${draw[@]}" "$TMPDIR/lineup-cut.png"
cols=(0 225 437 632 840 1056 1248)
for n in 0 1 2 3 4 5; do
  w=$((cols[n+1]-cols[n]))
  magick "$TMPDIR/lineup-cut.png" -crop ${w}x832+${cols[n]}+0 +repage -trim +repage -filter box -resize 25% "$D/characters/lineup/robot-$((n+1)).png"
done

# Busts: 4x2 grid on white.
B="$O/pixel_art_robot_characters_for_a_game_like_papers_please.jpg"
magick "$B" -alpha set -fuzz 8% -fill none -draw "color 2,2 floodfill" -draw "color 2,416 floodfill" -draw "color 2,829 floodfill" "$TMPDIR/busts-cut.png"
n=1; for r in 0 1; do for c in 0 1 2 3; do
  magick "$TMPDIR/busts-cut.png" -crop 312x416+$((c*312))+$((r*416)) +repage -trim +repage -filter box -resize 25% "$D/characters/busts/bust-$n.png"; n=$((n+1))
done; done

# Framed portraits: 4x3 grid on parchment; keep the gray card, trim the parchment.
P="$O/pixel_art_robot_characters_for_a_game_like_papers_please(1).jpg"
n=1; for r in 0 1 2; do for c in 0 1 2 3; do
  magick "$P" -crop 268x245+$((85+c*268))+$((42+r*245)) +repage -fuzz 10% -trim +repage -filter box -resize 25% "$D/characters/portraits/portrait-$n.png"; n=$((n+1))
done; done

echo "derived: $(find "$D" -name '*.png' | wc -l | tr -d ' ') files"
