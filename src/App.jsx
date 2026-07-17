import { BrowserRouter, Routes, Route, Link } from "react-router-dom";
import ItemList from "./ItemList.jsx";
import Counter from "./Counter.jsx";
import UserProfile from "./UserProfile.jsx";
import About from "./About.jsx";

const ITEMS = [
  { id: 1, label: "First item" },
  { id: 2, label: "Second item" },
  { id: 3, label: "Third item" },
];

function Home() {
  return (
    <div>
      <h1>Fixture App</h1>
      <UserProfile />
      <ItemList items={ITEMS} />
      <Counter />
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <nav>
        <Link to="/">Home</Link>
        {" | "}
        <Link to="/about">About</Link>
      </nav>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/about" element={<About />} />
      </Routes>
    </BrowserRouter>
  );
}
