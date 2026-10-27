---
"@real-a11y-dev/inspector": patch
---

A `mount()` that throws now undoes itself, so the container it failed on no longer drops out of every other tree on the page.

With the default `mount: "shadow"`, `mount()` throws on a container that can't host a shadow root, such as a `<form>`, an `<a>` or an `<img>`. It had already marked that container as the panel's own (`data-real-a11y-panel`), and extraction leaves the panel out of the trees it builds, so every other inspector or extraction on the page left the container and everything inside it out: a form's fields went missing. The instance also stayed marked as mounted, so calling `mount()` again did nothing. Now a `mount()` that throws removes the marker and leaves the instance unmounted, and the error still reaches the caller unchanged. A shadow root it attached before failing stays, because a shadow root can't be removed, and the next `mount()` reuses it.

An inspector also no longer removes a marker it didn't add. If the container was already marked, say by a `mount: "light"` panel rendering in it, neither a failed `mount()` nor `unmount()` takes the marker away, so that panel's controls stay out of the page's tree.
