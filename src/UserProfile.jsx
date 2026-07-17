import { useEffect, useState } from "react";

// A real fetch() call to an endpoint the evaluator's apiMock.js intercepts
// (any URL containing "/users"). Rendering `user.name` means the mocked
// "MockedUser" string only appears in the DOM if the fetch genuinely
// happened and its response was actually rendered — closing the R-11 gaming
// vector where a student could hardcode the literal string with no fetch.
export default function UserProfile() {
  const [user, setUser] = useState(null);

  useEffect(() => {
    fetch("/api/users/1")
      .then((res) => res.json())
      .then(setUser)
      .catch(() => setUser({ name: "Unknown" }));
  }, []);

  if (!user) return <p>Loading user…</p>;
  return <p className="user-name">{user.name}</p>;
}
