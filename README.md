# dsh-workspace-focus

A DSH Web plugin that adds one **eye toggle** to the sidebar's workspace-browser
header, next to the built-in *search*, *view options*, and *add workspace*
buttons. While the toggle is active, the sidebar shows **only the workspace that
holds the current session** — every other workspace is hidden.

```
┌ 工作区 ───────────────  ⌕  ≡  ＋  👁 ┐   ← the plugin's button, last in the row
│ ▾ .dsh                                │
│     53 分钟                            │   ← only the current session's workspace
└───────────────────────────────────────┘
```

## Behaviour

| | |
|---|---|
| **Off** (default) | Every workspace is listed, exactly as the built-in browser renders it. The icon is a struck-through eye. |
| **On** | Only the workspace containing the current session is listed — the other sections are not displayed at all, not collected into a bucket. The icon is an open eye, tinted with the brand colour. The choice survives a reload (`localStorage["dsh.workspace.focus.v1"]`). |
| **Nested workspaces** | DSH 0.1.6 can arrange workspaces as a tree. The focused workspace stays *together with the ancestors that hold it*, and every other branch is hidden. |
| **No current session** | The button is disabled and its tooltip says so. The toggle can never be switched on into a state that hides everything. |
| **A right panel is open** | The main view stops retaining the session while a panel takes the selection over. Focus mode keeps remembering the last answered workspace, so the list does not blink out for a reason the user cannot see. |
| **List mode "one list"** | The sidebar's *view options* can drop the grouping. There are no workspace sections then and focus mode hides nothing; it takes effect again as soon as the grouped view is back. |

## How it works

The sidebar renders **one section per workspace** inside the list that carries
`role="tree"` — that is what the built-in's `groupByWorkspace` produces; since DSH
0.1.6 it can nest them by path inside `role="group"` wrappers as well. Focus mode
is applied to that rendered markup and nowhere else: the sections holding the
current workspace keep their place, every other section gets one marker
attribute, and a single rule in the plugin's stylesheet turns that marker into
`display: none`.

```js
// the plugin's entire stylesheet for the filter
[data-dsh-workspace-focus-tree] [data-dsh-workspace-focus-hide] { display: none }
```

Marking sections instead of narrowing the store is the whole point, and it is
worth spelling out why the store was the wrong seam. The built-in derives its
sections from **sessions**, cross-referenced with the workspace list:

```js
for (const workspace of workspaces) { /* members from workspace.sessionIds */ }
const stray = list.ids.filter((id) => !accounted.has(id));   // → the "未分组" bucket
```

Narrowing the workspace list therefore does *not* narrow the sidebar. Every
session whose workspace vanished from the list becomes "stray" and is swept into
the built-in's **Ungrouped** bucket, so hiding four workspaces produces a fifth
group holding all of their sessions. Nothing about the framework's stores is
touched here, so that bucket never gets fed, and what the user asked to hide is
simply not displayed.

### Which session is current

The plugin reads this the way the built-in does, and that moved in DSH 0.1.6. The
session list no longer carries a `current` field — it is `{ ids, byId, phase, … }`
— and the session the main view is showing is now the one the main view still
**retains**: the row whose `retainedBy.mainView` is non-zero. The old field is
still honoured as a fallback, so the plugin runs against builds on either side of
that change.

### Which sections stay

The current session's own row — the `role="treeitem"` that is `aria-selected` —
is the authority, deliberately: it says nothing about how the built-in arranged
its sections. Every section between that row and the tree is a workspace that has
to stay, which yields the focused workspace plus its ancestors when workspaces are
nested, and it keeps working if the host reorders its workspaces.

When that row is not on screen (the focused workspace is collapsed, so it renders
no session rows at all) the older positional mapping is used instead: one section
per workspace in the host's order, checked against the label the sidebar rendered.
That mapping is meaningless while sections nest, so it is only attempted when every
section is a direct child of the tree.

Consequences worth knowing:

- The framework's workspace and session stores are **read only** — the plugin
  subscribes to them to follow the selection and never writes to them.
- Every uncertain case fails towards *showing more*: no current session, an
  unrecognised list shape, or a section whose rendered label does not match the
  workspace it should stand for all leave the list alone. The gate attribute
  lives on the tree, so dropping that one attribute reveals everything.
- **The layout switch does not flash.** Collapsing the sidebar to its rail makes
  the built-in render the list area with no children at all, so the tree — and
  every marker on it — is unmounted; expanding mounts the sections bare. A
  `MutationObserver` on the document re-marks them, and because its callback runs
  before the frame paints, the transition never shows the full list first. A
  one-second interval sits under it as a net.

### Finding the parts of the built-in markup

Nothing here pins a CSS-module class name: those are content-hashed and change
with every rebuild of the shipped bundles. Both anchors are structural.

- **The tree** is `[role="tree"]` — *the* one whose branch has a sibling holding a
  button. The climb from the tree goes up parents until the level where the
  tree's branch has a button-holding sibling, which is the section header; no
  level is counted, so an extra wrapper does not break it. A tree React portals
  straight to `body` — the subagent lineage menu — has no such sibling and is
  rejected by the same walk.
- **The action row** is the header child that holds buttons and no text input,
  which is what separates it from the search slot beside it. One built-in button
  is enough to prove the row, so the plugin keeps working if the built-in renders
  only one of them.

The button copies the sibling's own class list, so it inherits the icon-button
hover, shape, and sizing.

### The third button needs room

The built-in's action row is capped at exactly its two buttons' width
(`max-width: 60px` for two 28px buttons and the 4px gap) and clips what does not
fit, so a third button would be invisible without raising that cap. The plugin
does it in CSS, scoped to the marked header and matched with `:has()`:

```css
[data-dsh-workspace-focus-header]:has(button[aria-expanded="false"]) > [data-dsh-workspace-focus-row] { max-width: 96px }
```

Writing it as a stylesheet rule rather than a JavaScript style write is what
keeps the built-in authoritative: when the search box expands, `aria-expanded`
flips to `true`, the rule stops matching, and the built-in's own collapse of the
row applies again — no state to observe, no re-apply, no window in which the row
stays wide over the search field. The row's natural width is its contents', so a
built-in with only one button is unaffected by the raised cap.

The eye glyph is drawn inline: the shipped icon set contains no eye or
visibility icon.

## Layout

| File | Role |
|---|---|
| `lib/index.js` | Host half — intentionally empty. It exists so the Loader scans the row, which is what composes the browser bundle. |
| `lib/client.js` | Browser half — the whole feature. |
| `cordis.patch.yml` | The package's own bundle patch: the host row. |
| `test/client.test.mjs` | Self-contained checks: a DOM stand-in with a small selector matcher, reproducing the built-in browser's real nesting (including the tooltip wrapper and the header's search input), plus service stand-ins. `node test/client.test.mjs` from the package root. |

## Install

The plugin lives at `~/.dsh/plugins/dsh-workspace-focus`, linked into the Web
profile, exactly like `dsh-deepseek-cost`:

```powershell
New-Item -ItemType Junction `
  -Path "$env:USERPROFILE\.dsh\profiles\web\node_modules\dsh-workspace-focus" `
  -Target "$env:USERPROFILE\.dsh\plugins\dsh-workspace-focus"
```

Three things make it load, and all three are needed:

| Where | What |
|---|---|
| `~/.dsh/profiles/web/package.json` | `dsh.profile.bundles` lists `dsh-workspace-focus`, and `dependencies` links it as `link:../../plugins/dsh-workspace-focus`. |
| `cordis.patch.yml` (the package's own) | `dsh.bundle.patch` mounts the host row `workspace-focus`. |
| `lib/index.js` | The deliberately empty host half. The Loader only composes the browser bundle for a row whose package resolves. |

Registration must **not** also be repeated in the profile's
`~/.dsh/profiles/web/cordis.patch.yml`: bundle layers run first and `insert`
appends, so the same row id would mount twice. Once these are in place the
built-in plugin manager owns the row and can enable or disable it from its own
page (`plugins.json`, rowId `workspace-focus`).

## Adapting to a framework update

An upgrade can move the built-in surface this plugin reads. A vanished toggle is
almost always one of these, in this order — check them before changing code.

1. **Reload the page.** A framework upgrade replaces many client bundles at
   once, this plugin's dependencies among them. A page still holding the
   pre-upgrade module graph can be missing plugin rows entirely; a fresh load
   recomposes the graph. Confirm the plugin is even in it:

   ```powershell
   curl.exe -s -N --max-time 6 -o "$env:TEMP\events.txt" http://127.0.0.1:3080/plugins/events
   Select-String -LiteralPath "$env:TEMP\events.txt" -Pattern 'dsh-workspace-focus'
   ```

   (`curl` exits 28 on that stream by design; the payload is still written.)
2. **Services.** `apply` injects `workspaces`, `sessions`, and `locale`. In
   0.1.7 the workspace browser also provides a new `uiWorkspace` service — that
   is an addition (directory picking, archive), not a rename of `workspaces`.
3. **Snapshot shapes.** `sessions.list` has now changed twice: 0.1.6 dropped
   `current` in favour of `retainedBy.mainView`, and 0.1.7 replaced
   `subagentsByParent`/`jobsBySession` with `projectionsBySession`. Only the
   retention field matters here, and it has survived both.
4. **DOM anchors.** Re-verify the ones named under
   [Finding the parts of the built-in markup](#finding-the-parts-of-the-built-in-markup)
   against
   `node_modules/@deepseek-ai/dsh-client-ui-workspace/lib/client.js`.
5. **Run the tests.** `node test/client.test.mjs`. They cover the logic, not the
   built-in's markup, so a green run with a missing toggle points at anchors 4
   (or at anchor 1).
