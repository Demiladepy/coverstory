import Link from "next/link";

export default function Home() {
  return (
    <main className="wrap">
      <h1>Cover Story</h1>
      <p className="sub">
        You are twelve, you are home alone, and someone is at the door. Hold a key, speak, and
        your words come out of the house in a grown-up&rsquo;s voice — Dad, Mom or Uncle, stammers
        and all. Keep your story straight or get caught on tape.
      </p>

      <div className="panel">
        <h2>Build</h2>
        <p className="dim" style={{ margin: "0 0 14px", lineHeight: 1.6 }}>
          The game loop isn&rsquo;t wired up yet. The spike below is the piece it is built on: real
          tokens, a real transcript socket, a real re-voiced line, and the three measurements
          that decide how the rest is designed.
        </p>
        <Link href="/spike">
          <button className="primary">Open the day-one spike</button>
        </Link>
      </div>
    </main>
  );
}
