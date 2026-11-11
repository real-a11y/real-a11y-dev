---
"@real-a11y-dev/inspector": patch
"@real-a11y-dev/react": patch
"@real-a11y-dev/storybook-addon": patch
"@real-a11y-dev/testing": patch
"@real-a11y-dev/cli": patch
"@real-a11y-dev/mcp": patch
---

Name `option`, `optgroup`, `output`, `meter`, `progress` and `aria-placeholder` inputs as HTML-AAM does, in trees the DOM producer builds.

`<option label="Lab">Text</option>` is now `option "Lab"` and `<optgroup label="EU">` is `group "EU"`. A `<label>` (by `for` or by wrapping) now names an `<output>`, `<meter>` or `<progress>`; an unlabelled one is unchanged. `<input aria-placeholder="Ph">` is `textbox "Ph"`, after `title` and `placeholder`, so it is no longer reported as unlabeled, and `real-a11y tabs` / `get_tab_order` list it by that name. Native (CDP) trees already carried these names and are unchanged. Saved DOM-producer snapshots that contain these elements will churn.
