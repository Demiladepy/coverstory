import { redirect } from "next/navigation";

/**
 * There is no landing page.
 *
 * There used to be one, explaining the game and linking to it. But the game's
 * own opening screen already names it, pitches it in three lines and lets you
 * pick who is at the door — so the landing page was a worse version of the
 * first screen, in a different visual language, with a click in between.
 */
export default function Home() {
  redirect("/play");
}
