/**
 * apiMock.js
 *
 * Provides a reusable Playwright API mock layer.
 * Call `setupApiMocks(page)` before navigating to the app to intercept all
 * fetch/XHR requests and return controlled mock responses.
 *
 * This allows the evaluator to test API integration without relying on any
 * real external network calls or student-provided backends.
 */

/**
 * Default mock response payloads keyed loosely by URL pattern.
 * When a request URL contains the pattern key, the corresponding body is returned.
 * More specific patterns should come before more general ones.
 */
const MOCK_ROUTES = [
  {
    pattern: "**/users**",
    response: {
      id: 1,
      name: "MockedUser",
      email: "mock@example.com",
      username: "mockuser",
    },
  },
  {
    pattern: "**/posts**",
    response: [
      { id: 1, title: "MockPost One", body: "Mock body content" },
      { id: 2, title: "MockPost Two", body: "Another mock body" },
    ],
  },
  {
    pattern: "**/todos**",
    response: [
      { id: 1, title: "MockTodo", completed: false },
    ],
  },
  {
    pattern: "**/products**",
    response: [
      { id: 1, name: "MockItem", price: 9.99, category: "mock" },
    ],
  },
  {
    pattern: "**/auth**",
    response: { token: "mock-jwt-token", success: true },
  },
];

/**
 * A catch-all mock response used when no specific pattern matches.
 */
const FALLBACK_RESPONSE = {
  id: 1,
  name: "MockedUser",
  message: "api-mock-success",
  data: [{ id: 1, title: "MockItem" }],
  success: true,
};

/**
 * Intercepts all fetch/XHR requests on the given Playwright page and
 * returns appropriate mock responses. Static assets (JS, CSS, HTML,
 * fonts, images) are passed through normally so the app loads correctly.
 *
 * @param {import('playwright').Page} page - Playwright page instance
 * @returns {Promise<string[]>} interceptedUrls - List of API URLs that were mocked
 */
export async function setupApiMocks(page) {
  const interceptedUrls = [];

  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = request.url();
    const resourceType = request.resourceType();

    // Pass static assets through — only intercept API-like requests
    const isStaticAsset = ["document", "stylesheet", "script", "font", "image", "media"].includes(resourceType);
    if (isStaticAsset) {
      return route.continue();
    }

    // Only intercept fetch/xhr (API calls)
    if (resourceType !== "fetch" && resourceType !== "xhr") {
      return route.continue();
    }

    // Find the best matching mock route
    const matched = MOCK_ROUTES.find((mock) =>
      new RegExp(mock.pattern.replace(/\*\*/g, ".*")).test(url)
    );

    // If no specific mock matches, let the real network request through!
    // Students might be querying real external APIs (e.g. data.gov.in, OpenWeather, etc.)
    if (!matched) {
      return route.continue();
    }

    interceptedUrls.push(url);

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(matched.response),
    });
  });

  return interceptedUrls;
}

/**
 * Returns the list of mock field values (names/titles/messages) that should
 * appear in the DOM if the app correctly renders API data.
 * Used by playwrightTests.js to check if mock data appears in the page.
 *
 * @returns {string[]}
 */
export function getMockSignals() {
  return ["MockedUser", "MockPost", "MockTodo", "MockItem", "api-mock-success", "mockuser"];
}