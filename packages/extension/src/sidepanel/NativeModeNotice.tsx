/**
 * The one-time note about Chrome's debugging bar, and the name the bar quotes.
 */

/** The name Chrome's debugging bar quotes. */
export function extensionName(): string {
  try {
    return chrome.runtime.getManifest().name;
  } catch {
    return "Semantic Navigator";
  }
}

/**
 * The one-time note about Chrome's debugging bar, shown above the native tree
 * until the user acknowledges it. Nothing asks first, so this is where the
 * bar gets explained: a bar reading "… started debugging this browser" that
 * nobody mentioned looks like something is wrong. Not a dialog: it takes no
 * focus and blocks nothing.
 */
export function NativeModeNotice({
  onAcknowledge,
}: {
  onAcknowledge: () => void;
}) {
  return (
    <div
      class="sn-native-consent-banner"
      role="note"
      aria-label="About Chrome's debugging bar"
    >
      <p>
        While {extensionName()} reads a page, Chrome shows a bar across every
        window: “{extensionName()}” started debugging this browser. That's
        expected: it's how the panel reads the tree Chrome itself gives
        assistive technology.
      </p>
      <div class="sn-native-consent-actions">
        <button class="sn-toolbar-btn" onClick={onAcknowledge}>
          Got it
        </button>
      </div>
    </div>
  );
}
