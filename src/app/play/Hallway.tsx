"use client";

import { useEffect, useState } from "react";

/**
 * The hallway, drawn.
 *
 * Not a photograph and not pretending to be one. It is a vector scene, so it
 * is sharp at any size, it weighs nothing, and it themes off the same tokens
 * as the rest of the game.
 *
 * One point perspective: you are standing in your own hallway looking at the
 * front door. Coats you are too small for on the left, the phone table nobody
 * has answered, floorboards running away from you, and the only light in the
 * house coming from the wrong side of a closed door. Somebody is standing in
 * it.
 *
 * Framed twice. A phone is not a short cinema screen, it is a different
 * picture: slicing the wide composition to fit one crops the door clean off
 * the side, which is the only thing in the scene that matters. So a portrait
 * viewport gets its own window onto the same drawing, pushed in to the door
 * and the light, and loses the coats and the table rather than the subject.
 *
 * Replaced the moment a real picture is dropped at public/cover.jpg.
 */
export default function Hallway() {
  // Starts wide and corrects after mount. A phone sees the wide framing for
  // one paint, which is cheaper than shipping the scene twice or guessing at
  // the width on the server and getting a hydration mismatch for it.
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const q = window.matchMedia("(max-width: 819px)");
    const read = () => setNarrow(q.matches);
    read();
    q.addEventListener("change", read);
    return () => q.removeEventListener("change", read);
  }, []);

  return (
    <svg
      className="hallway"
      viewBox={narrow ? "726 40 650 860" : "0 0 1600 900"}
      preserveAspectRatio={narrow ? "xMidYMax slice" : "xMidYMid slice"}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id="wall" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#07080b" />
          <stop offset="62%" stopColor="#0d1016" />
          <stop offset="100%" stopColor="#151a23" />
        </linearGradient>

        <linearGradient id="floor" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#1a1e27" />
          <stop offset="100%" stopColor="#090b0f" />
        </linearGradient>

        <linearGradient id="doorslab" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#161a22" />
          <stop offset="70%" stopColor="#11141b" />
          <stop offset="100%" stopColor="#0d1016" />
        </linearGradient>

        <linearGradient id="doorframe" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#242a35" />
          <stop offset="50%" stopColor="#1a1f28" />
          <stop offset="100%" stopColor="#12161d" />
        </linearGradient>

        {/* The light coming under the door, thrown forward onto the boards.
            A fan rather than a pool: it leaves a gap the width of the door
            and spreads as it comes towards you, the way a line of light
            actually does. Clipped to the floor, because the first version
            was an ellipse and an ellipse climbs the door. */}
        <clipPath id="floorOnly">
          <rect y="652" width="1600" height="248" />
        </clipPath>
        <linearGradient id="fan" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#f0b44c" stopOpacity="0.36" />
          <stop offset="42%" stopColor="#f0b44c" stopOpacity="0.11" />
          <stop offset="100%" stopColor="#f0b44c" stopOpacity="0" />
        </linearGradient>

        <radialGradient id="halo" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0%" stopColor="#ffd98a" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#f0b44c" stopOpacity="0" />
        </radialGradient>

        <linearGradient id="seam" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#b67c22" />
          <stop offset="14%" stopColor="#ffd98a" />
          <stop offset="86%" stopColor="#ffd98a" />
          <stop offset="100%" stopColor="#b67c22" />
        </linearGradient>

        {/* Corners pulled down, so the eye goes to the door. */}
        <radialGradient id="vignette" cx="0.52" cy="0.46" r="0.78">
          <stop offset="40%" stopColor="#000000" stopOpacity="0" />
          <stop offset="100%" stopColor="#000000" stopOpacity="0.78" />
        </radialGradient>

        <filter id="soft" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="14" />
        </filter>
        <filter id="softer" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="3" />
        </filter>
      </defs>

      {/* ---- the room ------------------------------------------------- */}
      <rect width="1600" height="900" fill="url(#wall)" />
      <rect y="648" width="1600" height="252" fill="url(#floor)" />

      {/* Floorboards running away from you. */}
      <g stroke="#20252f" strokeWidth="1.5" opacity="0.55">
        <path d="M0 900 L560 650" />
        <path d="M250 900 L700 650" />
        <path d="M560 900 L840 650" />
        <path d="M900 900 L980 650" />
        <path d="M1260 900 L1120 650" />
        <path d="M1560 900 L1260 650" />
      </g>
      <g stroke="#1b202a" strokeWidth="1" opacity="0.5">
        <path d="M0 700 H1600" />
        <path d="M0 762 H1600" />
        <path d="M0 836 H1600" />
      </g>

      {/* Skirting, and the dado rail that every hallway like this has. */}
      <rect y="630" width="1600" height="20" fill="#191d26" />
      <rect y="628" width="1600" height="2" fill="#2a313d" />
      <rect y="432" width="1600" height="3" fill="#161a22" />

      {/* ---- the coats, which are all too big for you ------------------ */}
      <g transform="translate(176 300)">
        <rect x="-8" y="0" width="236" height="7" rx="3" fill="#20252f" />
        <g fill="#0f1218">
          <path d="M26 7 c-20 10 -30 44 -28 92 l2 128 h56 l2 -128 c2 -48 -8 -82 -32 -92 z" />
          <path d="M104 7 c-24 12 -34 50 -31 104 l3 116 h60 l3 -116 c3 -54 -8 -92 -35 -104 z" />
          <path d="M184 7 c-17 9 -25 38 -23 80 l2 112 h46 l2 -112 c2 -42 -7 -71 -27 -80 z" />
        </g>
        <g fill="#161b23">
          <path d="M26 7 c-20 10 -30 44 -28 92 l1 54 h26 l1 -146 z" />
          <path d="M104 7 c-24 12 -34 50 -31 104 l1 48 h30 l0 -152 z" />
        </g>
      </g>

      {/* ---- the phone table nobody has answered ----------------------- */}
      <g transform="translate(150 500)">
        <rect x="0" y="0" width="168" height="9" rx="2" fill="#1d222c" />
        <rect x="10" y="9" width="7" height="122" fill="#151a22" />
        <rect x="151" y="9" width="7" height="122" fill="#151a22" />
        <rect x="10" y="64" width="148" height="5" fill="#151a22" />
        {/* the handset */}
        <rect x="52" y="-16" width="62" height="17" rx="7" fill="#11151c" />
        <rect x="58" y="-21" width="50" height="8" rx="4" fill="#191e27" />
      </g>

      {/* ---- the door -------------------------------------------------- */}
      <g transform="translate(905 148)">
        {/* frame */}
        <rect x="-26" y="-26" width="392" height="538" rx="4" fill="url(#doorframe)" />
        <rect x="-26" y="-26" width="392" height="538" rx="4" fill="none" stroke="#2b323f" strokeWidth="2" />
        {/* slab */}
        <rect x="0" y="0" width="340" height="512" fill="url(#doorslab)" />
        <rect x="0" y="0" width="340" height="512" fill="none" stroke="#232a34" strokeWidth="1.5" />
        {/* panels */}
        <g fill="#0b0e13" stroke="#2d3542" strokeWidth="2">
          <rect x="46" y="44" width="110" height="150" rx="3" />
          <rect x="184" y="44" width="110" height="150" rx="3" />
          <rect x="46" y="300" width="110" height="168" rx="3" />
          <rect x="184" y="300" width="110" height="168" rx="3" />
        </g>
        {/* the moulding catches what little light there is, on its top edge */}
        <g stroke="#3b4454" strokeWidth="1.5" opacity="0.7">
          <path d="M48 46 H154" />
          <path d="M186 46 H292" />
          <path d="M48 302 H154" />
          <path d="M186 302 H292" />
        </g>
        {/* letterbox */}
        <rect x="112" y="232" width="116" height="15" rx="4" fill="#070a0e" stroke="#2a313d" strokeWidth="1.5" />
        {/* handle and lock */}
        <circle cx="306" cy="268" r="13" fill="#4a5162" />
        <circle cx="303" cy="265" r="5" fill="#79819a" />
        <rect x="298" y="296" width="16" height="22" rx="3" fill="#3a404e" />
      </g>

      {/* ---- and the only light in the house --------------------------- */}
      <g clipPath="url(#floorOnly)">
        {/* thrown forward onto the boards */}
        <path d="M881 652 H1269 L1600 900 H520 Z" fill="url(#fan)" filter="url(#soft)" />
        <ellipse cx="1075" cy="654" rx="290" ry="52" fill="url(#halo)" filter="url(#soft)" />
        {/* and two shadows reaching towards you out of it */}
        <g className="waiting" fill="#05070a" opacity="0.62" filter="url(#softer)">
          <path d="M1008 654 H1064 L1042 812 H964 Z" />
          <path d="M1086 654 H1142 L1172 812 H1094 Z" />
        </g>
      </g>

      {/* the seam itself */}
      <rect x="881" y="651" width="388" height="6" rx="2" fill="url(#seam)" />

      {/* somebody is standing in it */}
      <g className="waiting" fill="#05070a" filter="url(#softer)">
        <ellipse cx="1036" cy="655" rx="31" ry="8" />
        <ellipse cx="1112" cy="655" rx="31" ry="8" />
      </g>

      {/* a sliver down the hinge side, because the door is not quite true */}
      <rect x="1268" y="170" width="3" height="480" fill="#f0b44c" opacity="0.2" />

      <rect width="1600" height="900" fill="url(#vignette)" />
    </svg>
  );
}
