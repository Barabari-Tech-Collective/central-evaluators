import { useState } from "react";

// A real useState-driven counter — clicking the button genuinely mutates
// component state and the DOM, unlike a CSS hover effect.
export default function Counter() {
  const [count, setCount] = useState(0
  return (
    <button onClick={() => setCount((c) => c + 1)}>
      Clicked {count} times
    </button>
  );
}
