/**
 * Two `<pre><code>` blocks with the same token spans. The "noisy" one has
 * no role on the spans, so each token is its own `generic` node in the
 * accessibility tree. The "decorative" one sets `role="presentation"` on
 * each span — per the ARIA spec the element is then dropped from the tree
 * and its text content rolls up into the parent `<pre>`.
 *
 * Open the Semantic Navigator addon panel on the story and compare the two
 * blocks. The fix is visible today in Chrome DevTools' built-in
 * Accessibility panel and in screen readers; in our own panel the
 * difference becomes visible after the 0.1.0-beta.5 extractor fix.
 */
export function CodeBlock() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <h2>Code blocks — decorative tokens</h2>
      <p style={{ color: "#555", maxWidth: 480 }}>
        The first block leaves the token spans unstyled — each one becomes a{" "}
        <code>generic</code> node in the accessibility tree. The second sets{" "}
        <code>role="presentation"</code> on every span so the browser folds them
        into the <code>&lt;pre&gt;</code> as a single accessible code block.
      </p>

      <div>
        <p style={labelStyle}>Noisy — token spans without a role</p>
        <pre tabIndex={0} style={blockStyle}>
          <code>
            <span style={tokenKw}>const</span> <span style={tokenVar}>sn</span>{" "}
            = <span style={tokenFn}>createInspector</span>({"{"} root, container{" "}
            {"}"});{"\n"}
            <span style={tokenVar}>sn</span>.<span style={tokenFn}>mount</span>
            ();
          </code>
        </pre>
      </div>

      <div>
        <p style={labelStyle}>
          Decorative tokens — <code>role="presentation"</code>
        </p>
        <pre tabIndex={0} style={blockStyle}>
          <code>
            <span role="presentation" style={tokenKw}>
              const
            </span>{" "}
            <span role="presentation" style={tokenVar}>
              sn
            </span>{" "}
            ={" "}
            <span role="presentation" style={tokenFn}>
              createInspector
            </span>
            ({"{"} root, container {"}"});{"\n"}
            <span role="presentation" style={tokenVar}>
              sn
            </span>
            .
            <span role="presentation" style={tokenFn}>
              mount
            </span>
            ();
          </code>
        </pre>
      </div>
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  fontWeight: 600,
  marginBottom: 4,
  color: "#444",
  fontSize: "0.95rem",
};

const blockStyle: React.CSSProperties = {
  background: "#fff",
  border: "1px solid #ddd",
  borderRadius: 6,
  padding: 12,
  overflowX: "auto",
  margin: 0,
  font: "13px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace",
  maxWidth: 560,
};

const tokenKw: React.CSSProperties = { color: "#d73a49" };
const tokenVar: React.CSSProperties = { color: "#005cc5" };
const tokenFn: React.CSSProperties = { color: "#6f42c1" };
