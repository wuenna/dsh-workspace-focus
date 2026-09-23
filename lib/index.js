/**
 * Host half of `dsh-workspace-focus`.
 *
 * The feature is entirely browser-side: it adds one eye toggle to the sidebar's
 * workspace-browser header and, while active, narrows the workspace list the
 * sidebar renders to the workspace holding the current session. Nothing on the
 * host changes, so this half only exists to put the row on the Loader and let
 * `dsh-client-modules` compose the browser bundle from the same package
 * (`dsh.client` in package.json, bundle exported at `./client`).
 *
 * @module dsh-workspace-focus
 */

/** Cordis plugin name. */
const name = 'workspace-focus';

/** No host service is consumed; the fiber activates as soon as it is loaded. */
const inject = [];

/**
 * Activate the host half. Deliberately empty: the plugin owns no host state,
 * projection, or service — the client half is the whole feature.
 */
function apply() {}

export { apply, inject, name };
