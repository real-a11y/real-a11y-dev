/**
 * The one-time note about Chrome's debugging bar, and the name the bar quotes.
 */

import { useId } from "preact/hooks";

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
 * until the user acknowledges it. Native mode is on by default and nothing
 * asks first, so this is where the bar gets explained: a bar reading "…
 * started debugging this browser" that nobody mentioned looks like something
 * is wrong. Not a dialog: it takes no focus and blocks nothing, and Turn off
 * is the same switch as the Settings checkbox.
 */
export function NativeModeNotice({
  onAcknowledge,
  onTurnOff,
  turningOff,
}: {
  onAcknowledge: () => void;
  onTurnOff: () => void;
  /** A change to the setting is on its way: Turn off has nothing to add. */
  turningOff: boolean;
}) {
  const textId = useId();
  return (
    <div
      class="sn-native-consent-banner"
      role="note"
      aria-label="About Chrome's debugging bar"
    >
      <p id={textId}>
        While {extensionName()} reads a page, Chrome shows a bar across every
        window: “{extensionName()}” started debugging this browser. That's
        expected: it's how the panel reads the tree Chrome itself gives
        assistive technology. Turn it off to have the panel read the page
        itself, with no bar.
      </p>
      <div class="sn-native-consent-actions">
        <button class="sn-toolbar-btn" onClick={onAcknowledge}>
          Got it
        </button>
        <button
          class="sn-toolbar-btn"
          aria-describedby={textId}
          aria-disabled={turningOff}
          onClick={onTurnOff}
        >
          Turn off
        </button>
      </div>
    </div>
  );
}
