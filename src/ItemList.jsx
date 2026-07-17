// A real props-driven component: renders a list from an array passed in as
// a prop, producing genuine repeated sibling <li> elements (not just a
// hardcoded CSS class name) — this is what the strengthened "props" check
// in playwrightTests.js (R-11) is meant to detect.
export default function ItemList({ items }) {
  return (
    <ul className="item-list">
      {items.map((item) => (
        <li key={item.id} className="item">{item.label}</li>
      ))}
    </ul>
  );
}
