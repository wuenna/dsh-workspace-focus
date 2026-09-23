/**
 * Browser half of `dsh-workspace-focus`.
 *
 * Adds one eye toggle to the sidebar's workspace-browser header — beside the
 * built-in search, view-options, and add-workspace buttons — and, while that
 * toggle is active, hides every Workspace the sidebar lists except the one
 * holding the current Session.
 *
 * How the hiding works: the sidebar renders one group section per Workspace
 * inside the list that carries `role="tree"` (see the built-in `groupByWorkspace`),
 * either flat or, since DSH 0.1.6, nested by path inside `role="group"`
 * wrappers. This plugin never touches the data behind that list — the
 * framework's Workspace and Session stores stay exactly as they were — it only
 * marks the section containers the sidebar itself rendered: the sections that
 * hold the current Session keep their place, every other section carries a hide
 * marker, and one attribute-scoped rule in the plugin's stylesheet turns that
 * marker into `display:none`.
 *
 * Marking sections instead of narrowing the store is what keeps this honest.
 * The built-in derives its sections from *Sessions* cross-referenced with the
 * Workspace list, so narrowing the Workspace list does not narrow the sidebar:
 * every Session whose Workspace is missing becomes "stray" and is swept into
 * the built-in's Ungrouped bucket — a group the user never asked for. Hiding the
 * rendered sections leaves no room for that: what is not wanted is simply not
 * displayed, and the open Session keeps its own Workspace on screen.
 *
 * The current Session is found the way the built-in finds it: the list row the
 * main view still retains. DSH 0.1.6 replaced the list's `current` field with
 * that retention count, which is why this bundle reads the rows and keeps the
 * old field only as a fallback.
 *
 * Two different signals are used to identify the parts of the built-in markup,
 * both structural rather than a hashed CSS-module class name (those change with
 * every rebuild of the built-in bundles):
 *
 * - the tree is `[role="tree"]`, and it is *the* tree whose branch has a sibling
 *   holding a button. A tree React portals to `body` — the subagent lineage
 *   menu — has no such sibling and is rejected by the same walk;
 * - the action row is the header child that holds buttons and no text input,
 *   which is what separates it from the search slot beside it.
 *
 * The eye glyph is drawn inline: the shipped icon set carries no eye (or
 * visibility) icon at all.
 */

window.__ModuleLoader__.load({
	id: 'dsh-workspace-focus',
	factory: () => {
		/** Dictionary namespace owned by this plugin. */
		const NS = 'workspace-focus';
		/** Persisted focus-mode preference; per browser profile, like other view flags. */
		const STORAGE_KEY = 'dsh.workspace.focus.v1';
		/** Marker class on the plugin's own button. */
		const BUTTON_CLASS = 'dsh-workspace-focus-button';
		/** Marker class while focus mode is on. */
		const ACTIVE_CLASS = 'dsh-workspace-focus-active';
		/** Identity of the plugin-owned stylesheet. */
		const STYLE_ATTR = 'data-dsh-workspace-focus-css';
		/** Marks the header the width rule is scoped to. */
		const HEADER_ATTR = 'data-dsh-workspace-focus-header';
		/** Marks the action row that has to make room for a third button. */
		const ROW_ATTR = 'data-dsh-workspace-focus-row';
		/** Marks the tree the hide rule is scoped to; dropping it shows everything. */
		const TREE_ATTR = 'data-dsh-workspace-focus-tree';
		/** Marks a section the sidebar must not display while focus mode is on. */
		const HIDE_ATTR = 'data-dsh-workspace-focus-hide';

		/** Chinese copy (the primary UI language on this machine). */
		const zh = {
			'focus.label': '只显示当前工作区',
			'focus.on': '已锁定：只显示当前会话所在的工作区',
			'focus.off': '只显示当前会话所在的工作区',
			'focus.unavailable': '当前没有会话，无法锁定工作区'
		};
		/** English copy (the shell's fallback language). */
		const en = {
			'focus.label': 'Show current workspace only',
			'focus.on': 'Locked: showing only the current session\u2019s workspace',
			'focus.off': "Show only the current session's workspace",
			'focus.unavailable': 'No current session to focus on'
		};

		/**
		 * Inline eye glyph, a 16-unit outline icon on the grid the built-in toolbar
		 * icons use. The struck-through variant carries one extra diagonal stroke.
		 * Both are static strings owned by this plugin, so assigning them through
		 * `innerHTML` introduces nothing from outside the bundle.
		 */
		const EYE_PATHS = [
			'M0.75 8C2.6 4.6 5.15 3 8 3s5.4 1.6 7.25 5C13.4 11.4 10.85 13 8 13S2.6 11.4 0.75 8Z',
			'M8 10.1A2.1 2.1 0 1 0 8 5.9a2.1 2.1 0 0 0 0 4.2Z'
		];
		const EYE_OFF_PATHS = [...EYE_PATHS, 'M2.6 2.6 13.4 13.4'];

		/**
		 * Build the eye glyph markup.
		 * @param {boolean} active - true for the open eye, false for the struck one.
		 * @returns {string} `<svg>` markup.
		 */
		function eyeMarkup(active) {
			const paths = (active ? EYE_PATHS : EYE_OFF_PATHS)
				.map((d) => `<path d="${d}" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`)
				.join('');
			return `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" aria-hidden="true">${paths}</svg>`;
		}

		/**
		 * Whether one value behaves like an observable source (the shape every
		 * standard hook seat is built from).
		 * @param {unknown} value - candidate.
		 * @returns {boolean} true for a `{ getSnapshot, subscribe }` object.
		 */
		function isSource(value) {
			return (
				typeof value === 'object' &&
				value !== null &&
				typeof value.getSnapshot === 'function' &&
				typeof value.subscribe === 'function'
			);
		}

		/**
		 * Subscribe to a source, normalizing a missing disposer.
		 * @param {any} source - an observable source.
		 * @param {() => void} listener - callback.
		 * @returns {() => void} unsubscriber.
		 */
		function watch(source, listener) {
			const stop = source.subscribe(listener);
			return typeof stop === 'function' ? stop : () => {};
		}

		/**
		 * The session the main view is showing, or undefined when it shows none.
		 *
		 * The authority for this moved in DSH 0.1.6: the session list no longer
		 * carries a `current` field at all — it is `{ ids, byId, phase, … }` — and the
		 * main view's session is the one the main view still retains, which is what
		 * the built-in browser itself now reads. The older field is honoured as a
		 * fallback so the plugin also runs against builds that predate retention.
		 * @param {any} sessions - the `sessions` service.
		 * @returns {string|undefined} session id.
		 */
		function currentSessionId(sessions) {
			const snapshot = sessions?.list?.getSnapshot();
			const byId = snapshot?.byId;
			if (byId !== null && typeof byId === 'object') {
				for (const [key, row] of Object.entries(byId)) {
					if ((row?.retainedBy?.mainView ?? 0) > 0) return typeof row.id === 'string' ? row.id : key;
				}
			}
			const legacy = snapshot?.current;
			return typeof legacy === 'string' && legacy.length > 0 ? legacy : undefined;
		}

		/**
		 * The id of the workspace holding the current session, or undefined when no
		 * session is current. Undefined is a normal state (a blank shell, or a right
		 * panel taking the selection over), which is why focus mode remembers the
		 * last answered workspace rather than treating it as "nothing".
		 * @param {any} snapshot - a raw `workspaces` snapshot.
		 * @param {any} sessions - the `sessions` service.
		 * @returns {string|undefined} workspace id.
		 */
		function workspaceOf(snapshot, sessions) {
			const current = currentSessionId(sessions);
			if (current === undefined) return undefined;
			const items = Array.isArray(snapshot?.items) ? snapshot.items : [];
			const owner = items.find((item) => Array.isArray(item?.sessionIds) && item.sessionIds.includes(current));
			return owner?.workspaceId;
		}

		/**
		 * Read the persisted preference, tolerating a hostile or absent store.
		 * @returns {boolean} true when focus mode was on.
		 */
		function readStored() {
			try {
				return window.localStorage.getItem(STORAGE_KEY) === '1';
			} catch {
				return false;
			}
		}

		/**
		 * Persist the preference; a denied store must not break the toggle.
		 * @param {boolean} value - the new focus-mode state.
		 */
		function writeStored(value) {
			try {
				window.localStorage.setItem(STORAGE_KEY, value ? '1' : '0');
			} catch {
				// Private mode or a blocked origin: the in-memory state still works.
			}
		}

		/** The session tree. Every list mode of the browser gives it `role="tree"`. */
		const TREE_SELECTOR = '[role="tree"]';
		/** One row of that tree: a Workspace header or a Session. */
		const ROW_SELECTOR = '[role="treeitem"]';
		/** The row the main view's session occupies; the one unarguable landmark. */
		const SELECTED_SELECTOR = '[role="treeitem"][aria-selected="true"]';
		/** The wrapper the built-in nests child Workspaces in when they are a tree. */
		const GROUP_SELECTOR = '[role="group"]';

		/**
		 * The plugin's stylesheet.
		 *
		 * The first rule is what lets a third button exist at all: the built-in
		 * action row is capped at exactly its two buttons' width and clips the rest,
		 * so the cap is raised while the search box is collapsed. The rule is scoped
		 * to the marked header and matched with `:has()` rather than written as a
		 * JavaScript style write, which keeps the built-in's own collapse — the same
		 * property, set when the search box expands — authoritative without this
		 * plugin having to observe that state or re-apply anything.
		 *
		 * The second rule is the whole of focus mode, and it is scoped to the marked
		 * tree so that dropping one attribute reveals everything again. It reaches
		 * any depth on purpose: with Workspaces nested, a hidden section is as likely
		 * to sit inside its parent's `role="group"` wrapper as under the tree itself.
		 */
		const CSS_TEXT = [
			`.${BUTTON_CLASS}{flex:none}`,
			`.${BUTTON_CLASS}.${ACTIVE_CLASS}{color:var(--dsw-alias-brand-primary)}`,
			`.${BUTTON_CLASS}:disabled{opacity:.4;cursor:default}`,
			`[${HEADER_ATTR}]:has(button[aria-expanded="false"])>[${ROW_ATTR}]{max-width:96px}`,
			`[${TREE_ATTR}] [${HIDE_ATTR}]{display:none}`
		].join('');

		/**
		 * Set or clear a marker attribute, without writing when nothing changes: a
		 * repeated `setAttribute` still invalidates the element's style.
		 * @param {Element|null} element - target.
		 * @param {string} name - attribute name.
		 * @param {boolean} on - whether it must be present.
		 * @returns {void}
		 */
		function mark(element, name, on) {
			if (element === null) return;
			if (element.hasAttribute(name) === on) return;
			if (on) element.setAttribute(name, '');
			else element.removeAttribute(name);
		}

		/**
		 * The browser's section header, found from the tree: the nearest ancestor
		 * that has a sibling holding a button.
		 *
		 * The built-in nests the list several levels below the browser root (the
		 * list inside its body inside the list area) and puts the header beside that
		 * branch, so the climb stops at the first level where the tree's branch has a
		 * button-holding sibling — no level is counted, and an inserted wrapper does
		 * not break it.
		 *
		 * A tree React portals straight to `body` — the subagent lineage menu — has
		 * no such sibling anywhere below `body`, so the same walk rejects it.
		 * @param {Element} tree - the candidate list.
		 * @returns {Element|null} the header, or null when there is none.
		 */
		function headerOf(tree) {
			let branch = tree;
			let node = tree.parentElement;
			while (node !== null && node !== document.body) {
				for (const sibling of node.children) {
					if (sibling === branch) continue;
					if (sibling.querySelector('button') !== null) return sibling;
				}
				branch = node;
				node = node.parentElement;
			}
			return null;
		}

		/**
		 * The header's action row: the child that holds buttons and no text input.
		 *
		 * A single built-in button is enough to prove the row, so the plugin keeps
		 * working if the built-in renders only one of them, and the count ignores the
		 * plugin's own button so re-detection cannot feed on itself. The search slot
		 * is rejected by its input rather than by its position, and a header without
		 * any input is not the expanded sidebar's header at all — the collapsed rail
		 * has no toolbar to sit in.
		 * @param {Element} header - the section header.
		 * @returns {Element|null} the action row, or null when the header has none.
		 */
		function toolbarRow(header) {
			if (header.querySelector('input') === null) return null;
			for (const child of header.children) {
				if (child.querySelector('input') !== null) continue;
				if (child.querySelector(`button:not(.${BUTTON_CLASS})`) === null) continue;
				return child;
			}
			return null;
		}

		/**
		 * The live workspace browser: its tree, its header, and its action row when
		 * the header has one (the collapsed rail keeps the tree but drops the row).
		 * @returns {{ tree: Element, header: Element, row: Element|null }|null} parts.
		 */
		function findBrowser() {
			for (const tree of document.querySelectorAll(TREE_SELECTOR)) {
				const header = headerOf(tree);
				if (header === null) continue;
				return { tree, header, row: toolbarRow(header) };
			}
			return null;
		}

		/**
		 * Whether one element is a Workspace section.
		 *
		 * A section's first row is its Workspace header, which is the only kind that
		 * expands; the flat and search list modes are made of plain session rows, and
		 * those must never be mistaken for sections, or focusing would hide the one
		 * session that happens to sit at the focused Workspace's index.
		 * @param {Element} element - a candidate container.
		 * @returns {boolean} true for a Workspace section.
		 */
		function isGroupSection(element) {
			const row = element.querySelector(ROW_SELECTOR);
			if (row === null) return false;
			return row.hasAttribute('aria-expanded') && !row.hasAttribute('aria-selected');
		}

		/**
		 * Every Workspace section the sidebar rendered, at any depth.
		 *
		 * A section holds its child Workspaces inside a `role="group"` wrapper when
		 * the browser nests them, so the sections are the section-shaped children of
		 * the tree *and* of those wrappers — the tree's own children alone would miss
		 * every nested Workspace.
		 * @param {Element} tree - the list.
		 * @returns {Element[]} section containers, in document order.
		 */
		function groupSections(tree) {
			const sections = [];
			for (const container of [tree, ...tree.querySelectorAll(GROUP_SELECTOR)]) {
				for (const child of container.children) {
					if (isGroupSection(child)) sections.push(child);
				}
			}
			return sections;
		}

		/**
		 * Whether a section really is the one the host's Workspace order says it is.
		 *
		 * The built-in emits exactly one section per Workspace, in the host's order,
		 * and appends its Ungrouped bucket last, so a section's index is the
		 * Workspace's index. That mapping is checked against the label the sidebar
		 * rendered before anything is hidden: a mismatch means the built-in changed
		 * shape under us, and the honest answer then is to hide nothing.
		 * @param {Element} section - the section that should hold the Workspace.
		 * @param {any} item - the Workspace item.
		 * @returns {boolean} true when the mapping holds.
		 */
		function sectionMatches(section, item) {
			const title = item?.title;
			if (typeof title !== 'string' || title === '') return true;
			const row = section.querySelector(ROW_SELECTOR);
			const text = row === null ? '' : row.textContent;
			return typeof text === 'string' && text.includes(title);
		}

		/**
		 * The plugin-owned focus state: the toggle, the sticky current Workspace, and
		 * the two things it drives (the header button, the set of hidden sections).
		 *
		 * Nothing here writes to the framework's stores. The Workspace source is read
		 * and subscribed to, so the focus can follow the selection, and that is all.
		 */
		class Focus {
			/**
			 * @param {any} source - the `workspaces.list` store, or null when absent.
			 * @param {any} hostSessions - the `sessions` service.
			 */
			constructor(source, hostSessions) {
				this.source = isSource(source) ? source : null;
				this.hostSessions = hostSessions;
				/** Whether the toggle is on. */
				this.active = readStored();
				/** Workspace the sidebar keeps showing while active. */
				this.workspaceId = undefined;
				/** @type {(() => void)[]} store unsubscribers. */
				this.stops = [];
				/** @type {(() => void)|undefined} called after every state change. */
				this.onChange = undefined;
			}

			/** The unfiltered Workspace snapshot, or undefined. */
			snapshot() {
				return this.source === null ? undefined : this.source.getSnapshot();
			}

			/** Follow the Workspace store and the current Session; runs until unload. */
			start() {
				const bump = () => {
					this.track();
					this.onChange?.();
				};
				if (this.source !== null) this.stops.push(watch(this.source, bump));
				if (isSource(this.hostSessions?.list)) this.stops.push(watch(this.hostSessions.list, bump));
				bump();
			}

			/** Follow nothing anymore. */
			stop() {
				for (const stop of this.stops) stop();
				this.stops = [];
			}

			/**
			 * Re-resolve the focused Workspace from the current Session. A blank or
			 * unknown selection keeps the last answer, so a right panel taking the
			 * selection over never empties the sidebar.
			 * @returns {void}
			 */
			track() {
				const owner = workspaceOf(this.snapshot(), this.hostSessions);
				if (owner !== undefined) this.workspaceId = owner;
			}

			/** Whether the toggle can do anything right now. */
			available() {
				return this.workspaceId !== undefined;
			}

			/**
			 * Turn focus mode on or off. Refuses while no Workspace can be focused,
			 * so the toggle can never land in a state that hides everything.
			 * @returns {boolean} true when the state changed.
			 */
			toggle() {
				if (!this.active && !this.available()) return false;
				this.active = !this.active;
				writeStored(this.active);
				this.onChange?.();
				return true;
			}

			/**
			 * The sections the sidebar may keep on screen while focus mode is on, or
			 * null when the filter cannot be applied to this list at all.
			 *
			 * The current session's own row is the authority, and deliberately so: it
			 * is selected exactly when it is the session the main view shows, and it
			 * says nothing about how the built-in arranged its sections. Every section
			 * between that row and the tree is a Workspace that has to stay — the
			 * focused one, plus the ancestors holding it when Workspaces are nested —
			 * so the rule survives both arrangements, and survives the host reordering
			 * its Workspaces.
			 *
			 * When the row is not on screen (its Workspace is collapsed, so no session
			 * rows are rendered at all) the flat arrangement is matched positionally
			 * instead. Nesting makes that mapping meaningless, so it is only attempted
			 * while every section is a direct child of the tree.
			 * @param {Element} tree - the live tree.
			 * @param {Element[]} sections - every rendered section.
			 * @returns {Set<Element>|null} the sections to keep.
			 */
			keep(tree, sections) {
				if (!this.active || !this.available()) return null;
				const row = tree.querySelector(SELECTED_SELECTOR);
				if (row !== null) {
					const keep = new Set();
					for (let node = row.parentElement; node !== null && node !== tree; node = node.parentElement) {
						if (isGroupSection(node)) keep.add(node);
					}
					// A selected row with no section above it is not an arrangement this
					// rule understands; hiding everything on that guess would be worse
					// than hiding nothing.
					return keep.size === 0 ? null : keep;
				}
				const items = this.snapshot()?.items;
				if (!Array.isArray(items) || items.length === 0) return null;
				if (sections.length !== tree.children.length) return null;
				// One section per Workspace, plus the built-in's Ungrouped bucket last.
				if (sections.length !== items.length && sections.length !== items.length + 1) return null;
				const at = items.findIndex((item) => item?.workspaceId === this.workspaceId);
				if (at < 0 || !sectionMatches(sections[at], items[at])) return null;
				return new Set([sections[at]]);
			}
		}

		/** Required services (cordis fiber inject). */
		const inject = ['workspaces', 'sessions', 'locale'];

		/**
		 * Owns the whole browser-side feature: the focus state, the header button,
		 * and the hide markers on the sections the sidebar rendered.
		 * @param {any} ctx - client root context.
		 */
		function apply(ctx) {
			const workspaces = ctx.get('workspaces');
			const sessions = ctx.get('sessions');
			const t = ctx.locale.bind(NS);

			const focus = new Focus(workspaces?.list, sessions);
			const state = {
				disposed: false,
				tree: /** @type {Element|null} */ (null),
				header: /** @type {Element|null} */ (null),
				host: /** @type {Element|null} */ (null),
				button: /** @type {HTMLButtonElement|null} */ (null),
				painted: /** @type {string|null} */ (null)
			};

			// -------------------------------------------------------------- button

			/**
			 * Give the plugin's button the built-in toolbar button's own classes,
			 * captured from a sibling, so it inherits hover, corner shape and sizing
			 * without this plugin pinning a hashed class name. The captured string is
			 * copied wholesale rather than being written by this bundle.
			 * @param {Element} row - the built-in action row.
			 * @returns {string} class list for the plugin's button.
			 */
			function dress(row) {
				const sibling = row.querySelector(`button:not(.${BUTTON_CLASS})`);
				return sibling !== null && sibling.className ? sibling.className : '';
			}

			/**
			 * Push the current focus state into the mounted button.
			 *
			 * The button is repainted on every state change and on every mount tick, so
			 * the last painted state is remembered and a repeat write is skipped: the
			 * markup only changes when the toggle or its availability really changed.
			 */
			function paint() {
				const button = state.button;
				if (button === null) return;
				const active = focus.active;
				const usable = focus.available();
				const stamp = `${active ? '1' : '0'}${usable ? '1' : '0'}`;
				if (state.painted === stamp) return;
				state.painted = stamp;
				button.classList.toggle(ACTIVE_CLASS, active);
				button.disabled = !usable && !active;
				button.title = !usable ? t('focus.unavailable') : active ? t('focus.on') : t('focus.off');
				button.setAttribute('aria-label', t('focus.label'));
				button.setAttribute('aria-pressed', active ? 'true' : 'false');
				button.innerHTML = eyeMarkup(active);
			}

			/** Remove the plugin's button and the markers that made room for it. */
			function detachButton() {
				state.button?.remove();
				state.button = null;
				state.painted = null;
				mark(state.host, ROW_ATTR, false);
				mark(state.header, HEADER_ATTR, false);
				state.host = null;
				state.header = null;
			}

			/**
			 * Adopt the action row and (re)attach the button to it.
			 *
			 * Re-applied on every tick rather than only on mount: the header is
			 * React-rendered and may be replaced when the sidebar switches layout, and
			 * the plugin's own markers would go with it.
			 * @param {Element|null} row - the live action row, or null.
			 * @param {Element|null} header - the header it belongs to.
			 */
			function mountButton(row, header) {
				if (row === null || header === null) {
					// The collapsed sidebar renders no toolbar to sit in, so the button
					// simply has no seat until the sidebar expands again. Focus mode
					// itself stays on: the tree is still there to hide sections in.
					detachButton();
					return;
				}
				if (state.header !== header) {
					mark(state.host, ROW_ATTR, false);
					mark(state.header, HEADER_ATTR, false);
					state.header = header;
					state.host = null;
				}
				if (state.host !== row) {
					mark(state.host, ROW_ATTR, false);
					state.host = row;
				}
				mark(header, HEADER_ATTR, true);
				mark(row, ROW_ATTR, true);
				if (state.button !== null && row.contains(state.button)) {
					paint();
					return;
				}
				state.button?.remove();
				const button = document.createElement('button');
				state.button = button;
				state.painted = null;
				// The built-in icon buttons render their glyph through a tooltip
				// wrapper; this one carries the tooltip text itself, so a plain
				// `title` is set rather than reaching for the primitives module.
				button.type = 'button';
				button.className = [dress(row), BUTTON_CLASS].filter(Boolean).join(' ');
				button.addEventListener('click', (event) => {
					event.preventDefault();
					event.stopPropagation();
					focus.toggle();
				});
				row.appendChild(button);
				paint();
			}

			// ----------------------------------------------------------- visibility

			/** Forget the marked tree and reveal everything it was hiding. */
			function releaseTree() {
				if (state.tree === null) return;
				mark(state.tree, TREE_ATTR, false);
				for (const section of groupSections(state.tree)) mark(section, HIDE_ATTR, false);
				state.tree = null;
			}

			/**
			 * Mark every section the focused Workspace does not need for hiding.
			 *
			 * The marker attributes are the whole state: with the tree marked, the
			 * plugin's own stylesheet hides the marked sections and nothing else, so a
			 * mistake can only ever reveal more of the sidebar, never less.
			 * @param {Element|null} tree - the live tree, or null.
			 */
			function paintVisibility(tree) {
				if (tree === null) {
					releaseTree();
					return;
				}
				if (state.tree !== tree) {
					releaseTree();
					state.tree = tree;
				}
				const sections = groupSections(tree);
				const keep = focus.keep(tree, sections);
				if (keep === null || sections.length === 0) {
					mark(tree, TREE_ATTR, false);
					for (const section of sections) mark(section, HIDE_ATTR, false);
					return;
				}
				mark(tree, TREE_ATTR, true);
				for (const section of sections) mark(section, HIDE_ATTR, !keep.has(section));
			}

			// -------------------------------------------------------------- wiring

			/** Re-read the document and the stores, and push both into the markup. */
			function sync() {
				if (state.disposed) return;
				const browser = findBrowser();
				mountButton(browser?.row ?? null, browser?.header ?? null);
				paintVisibility(browser?.tree ?? null);
			}

			focus.onChange = () => sync();

			ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-workspace-focus: dictionaries');

			ctx.effect(() => {
				const style = document.createElement('style');
				style.setAttribute(STYLE_ATTR, '');
				style.textContent = CSS_TEXT;
				document.head.appendChild(style);
				focus.start();
				sync();
				// The sidebar unmounts its whole list whenever the layout switches —
				// collapsing to the rail renders the list area with no children at all —
				// and every marker lives on those nodes, so expanding again remounts the
				// sections bare. Watching for that is what keeps the switch from showing
				// the full list first: MutationObserver callbacks run before the frame
				// paints, so re-marking there is never seen. `childList` alone is enough
				// because everything this plugin writes is an attribute, and an
				// attribute write therefore cannot feed back into the observer.
				const observer = new MutationObserver(() => sync());
				observer.observe(document.body, { childList: true, subtree: true });
				// A low-frequency net under the observer: one cheap pass per second buys
				// convergence even if a mutation is ever missed.
				const tick = window.setInterval(() => sync(), 1000);
				return () => {
					state.disposed = true;
					observer.disconnect();
					window.clearInterval(tick);
					focus.stop();
					detachButton();
					releaseTree();
					style.remove();
				};
			}, 'dsh-workspace-focus: mount');
		}

		return {
			name: 'workspace-focus',
			inject,
			apply,
			__internals: {
				Focus,
				workspaceOf,
				currentSessionId,
				headerOf,
				toolbarRow,
				findBrowser,
				groupSections,
				inject,
				NS,
				CSS_TEXT,
				eyeMarkup
			}
		};
	}
});
