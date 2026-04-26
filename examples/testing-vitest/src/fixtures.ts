/**
 * Helper to create a DOM element from an HTML string.
 * Returns the first child element, appended to document.body so
 * queries work correctly in jsdom.
 */
export function fixture(html: string): Element {
  const container = document.createElement("div");
  container.innerHTML = html;
  document.body.appendChild(container);
  return container;
}

/** Clean up all fixtures after each test. */
export function cleanup() {
  document.body.innerHTML = "";
}
