# The cover art

The opening screen draws its own scene now, in `src/app/play/Hallway.tsx`:
a hallway at night, the front door shut, light under it, and somebody
standing in the light. Nothing needs to be added for the game to look
finished.

This file is about replacing that drawing with a painting, which is still
worth doing if there is time, because a drawing is a drawing.

## How to swap it in

Save the image as **`public/cover.jpg`** or **`public/cover.png`** and reload.
That is the whole procedure. The page probes for both on load, switches to
whichever it finds, and drops the drawn scene. If neither is there, nothing
breaks and nobody can tell.

The full path on this machine:

    C:\Users\User\Desktop\work\coverstory\public\

Two things to know about that folder. It is empty apart from a `.gitkeep`,
because git will not track an empty directory and a missing folder after a
clone is a confusing way to start. And **everything in it is served on the
live site**, at the root: `public/notes.txt` is readable by anyone at
`/notes.txt`. That is why this file lives in `docs/` and not next to the
image it describes.

## Size

Landscape, at least 1600 by 900. It is cropped from the centre on wide
screens and pushed in to the right-hand side on phones, so keep the door
right of centre and keep the left third quiet: that is where the words go,
and it is the first part of the picture a phone throws away.

## The prompt

A twelve year old's view of their own front door at night, from inside the
house. One point perspective, standing in the hallway. The door is shut.
The only light in the house is the strip coming under it, warm and narrow,
thrown forward across bare floorboards. Two shadows interrupt that strip:
somebody is standing outside, close, not moving. Coats too big for a child
hang on hooks to the left, and there is a telephone table nobody has gone
to. Everything else is dark enough that you are reading shapes.

Painted, not photographic. Heavy warm and cold contrast, deep shadow,
visible brushwork, the colour discipline of a Rockstar key art plate: one
light source, everything else surrendered to it. No text anywhere in the
image. No faces. Nothing cute.

## What it must not do

**No text.** The title and the type are set in the page over the top, and a
painted title fights them and cannot be translated or resized.

**No faces, and nobody on the inside.** The player is the camera. Put a
child in the frame and the player is watching somebody else be scared.

**Nothing cute.** The joke is in the writing. The picture is the straight man.
