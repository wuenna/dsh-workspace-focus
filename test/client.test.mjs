/**
 * Browser-half checks for dsh-workspace-focus.
 *
 * Loads `lib/client.js` exactly the way the client module system does — through
 * `window.__ModuleLoader__.load` with a lazy-CJS factory — and then runs the
 * registered `apply()` against a minimal DOM stand-in. React is a browser-side
 * static module in DSH and is not installed as a Node package here; that is
 * fine, because this bundle renders with `document.createElement` rather than
 * through React and requires no modules at all.
 *
 * The stand-in implements the handful of DOM operations this plugin performs,
 * including a small selector matcher, so the *structural* finders are genuinely
 * exercised. The fixture reproduces the real shape of the built-in workspace
 * browser, taken from its shipped bundle:
 *
 * ```text
 * div.root
 * ├── div.sectionHeader
 * │   ├── span.sectionLabel
 * │   ├── div.searchSlot → div.search → input + button[aria-expanded]
 * │   └── div.headerActions → button (view options), span (tooltip) → button (add)
 * └── div.listArea → div.treeBody → div.list[role="tree"]
 *     ├── div.groupSection → div[role="treeitem"][aria-expanded] + session rows
 *     └── …
 * ```
 *
 * Run with `node test/client.test.mjs` from the package root.
 */
import assert from 'node:assert/strict';

// ---------------------------------------------------------------- DOM stand-in

const BUTTON_CLASS = 'dsh-workspace-focus-button';
const ACTIVE_CLASS = 'dsh-workspace-focus-active';
const HEADER_ATTR = 'data-dsh-workspace-focus-header';
const ROW_ATTR = 'data-dsh-workspace-focus-row';
const TREE_ATTR = 'data-dsh-workspace-focus-tree';
const HIDE_ATTR = 'data-dsh-workspace-focus-hide';
const BUILTIN_ICON = 'mod_iconButton';
const WORKSPACE_A = 'ws-alpha';
const WORKSPACE_B = 'ws-beta';

/**
 * Split a `class` attribute into tokens.
 * @param {string} value - the attribute value.
 * @returns {Set<string>} the tokens.
 */
function tokens(value) {
	return new Set(String(value ?? '').split(/\s+/).filter(Boolean));
}

/**
 * Match one element against the subset of selectors this plugin uses: a compound
 * of tag names, `.class`, `[attr]` and `[attr="value"]`, with one optional
 * `:not(…)` around any of those.
 * @param {FakeElement} node - candidate.
 * @param {string} selector - the selector.
 * @returns {boolean} whether the node matches.
 */
function matches(node, selector) {
	const trimmed = selector.trim();
	const negated = /:not\(([^)]*)\)/.exec(trimmed);
	if (negated !== null && matches(node, negated[1])) return false;
	const base = trimmed.replace(/:not\([^)]*\)/, '').trim();
	if (base === '') return true;
	const parts = base.match(/[A-Za-z][A-Za-z0-9-]*|\.[A-Za-z0-9_-]+|\[[A-Za-z0-9_-]+(?:="[^"]*")?\]/g);
	if (parts === null || parts.join('') !== base) {
		throw new Error(`the stand-in cannot parse the selector "${selector}"`);
	}
	return parts.every((part) => matchesPart(node, part));
}

/**
 * Match one tag, class or attribute token of a compound selector.
 * @param {FakeElement} node - candidate.
 * @param {string} part - the token.
 * @returns {boolean} whether the node matches.
 */
function matchesPart(node, part) {
	if (part.startsWith('.')) return node.classList.contains(part.slice(1));
	if (part.startsWith('[')) {
		const attribute = /^\[([A-Za-z0-9_-]+)(?:="([^"]*)")?\]$/.exec(part);
		if (attribute === null) return false;
		if (!node.hasAttribute(attribute[1])) return false;
		return attribute[2] === undefined || node.getAttribute(attribute[1]) === attribute[2];
	}
	return node.tagName === part.toUpperCase();
}

class FakeClassList {
	/**
	 * @param {FakeElement} owner - the element this list belongs to.
	 */
	constructor(owner) {
		this.owner = owner;
	}

	/** @returns {string[]} the current tokens. */
	all() {
		return [...tokens(this.owner.attrs.class)];
	}

	/** @param {string} name - token to add. */
	add(name) {
		const next = tokens(this.owner.attrs.class);
		next.add(name);
		this.owner.attrs.class = [...next].join(' ');
	}

	/** @param {string} name - token to remove. */
	remove(name) {
		const next = tokens(this.owner.attrs.class);
		next.delete(name);
		this.owner.attrs.class = [...next].join(' ');
	}

	/**
	 * @param {string} name - token to test.
	 * @returns {boolean} whether the token is present.
	 */
	contains(name) {
		return tokens(this.owner.attrs.class).has(name);
	}

	/**
	 * @param {string} name - token.
	 * @param {boolean} [force] - presence to force.
	 * @returns {boolean} whether the token is present afterwards.
	 */
	toggle(name, force) {
		const want = force === undefined ? !this.contains(name) : force;
		if (want) this.add(name);
		else this.remove(name);
		return want;
	}

	/** @returns {number} how many tokens are present. */
	get length() {
		return this.all().length;
	}
}

/** Monotonic ids, so a failure message can name the node it means. */
let idSeq = 0;

class FakeElement {
	/**
	 * @param {string} tagName - tag name.
	 */
	constructor(tagName) {
		this.tagName = tagName.toUpperCase();
		this.children = [];
		this.parentElement = null;
		this.attrs = /** @type {Record<string,string>} */ ({});
		this.classList = new FakeClassList(this);
		this.listeners = /** @type {Record<string, Function[]>} */ ({});
		this._html = '';
		this._text = '';
		this.type = '';
		this.disabled = false;
		this.title = '';
		this.node = ++idSeq;
	}

	/** @returns {FakeElement|null} the last element child, as the DOM exposes it. */
	get lastElementChild() {
		return this.children.at(-1) ?? null;
	}

	/** @returns {FakeElement|null} the first element child. */
	get firstElementChild() {
		return this.children[0] ?? null;
	}

	/** @returns {string} the `class` attribute, as the DOM exposes it. */
	get className() {
		return this.attrs.class ?? '';
	}
	/** @param {string} value - new `class` attribute. */
	set className(value) {
		this.attrs.class = String(value ?? '');
	}

	/** @returns {string} assigned markup, or the serialized children. */
	get innerHTML() {
		return this.children.length > 0 ? this.children.map((child) => child.outerHTML).join('') : this._html;
	}

	/** @param {string} value - markup to store verbatim. */
	set innerHTML(value) {
		this._html = String(value);
		this.children = [];
	}

	/** @returns {string} this element's own text plus every descendant's. */
	get textContent() {
		return this._text + this.children.map((child) => child.textContent).join('');
	}

	/** @param {string} value - text content. */
	set textContent(value) {
		this._text = String(value);
		this.children = [];
	}

	/** @returns {string} this element's own tag and class, for failure messages. */
	get outerHTML() {
		const cls = this.className ? ` class="${this.className}"` : '';
		return `<${this.tagName.toLowerCase()}${cls}>`;
	}

	/**
	 * @param {FakeElement} child - element to append.
	 * @returns {FakeElement} the child.
	 */
	appendChild(child) {
		child.parentElement = this;
		this.children.push(child);
		return child;
	}

	/** @returns {FakeElement} this element, detached from its parent. */
	remove() {
		const parent = this.parentElement;
		if (parent !== null) {
			const at = parent.children.indexOf(this);
			if (at >= 0) parent.children.splice(at, 1);
		}
		this.parentElement = null;
		return this;
	}

	/**
	 * @param {string} name - attribute name.
	 * @param {string} value - attribute value.
	 */
	setAttribute(name, value) {
		this.attrs[name] = String(value);
	}

	/**
	 * @param {string} name - attribute name.
	 * @returns {string|null} the attribute value.
	 */
	getAttribute(name) {
		return Object.hasOwn(this.attrs, name) ? this.attrs[name] : null;
	}

	/**
	 * @param {string} name - attribute name.
	 * @returns {boolean} whether the attribute is present.
	 */
	hasAttribute(name) {
		return Object.hasOwn(this.attrs, name);
	}

	/** @param {string} name - attribute name. */
	removeAttribute(name) {
		delete this.attrs[name];
	}

	/**
	 * @param {string} name - event name.
	 * @param {Function} listener - listener.
	 */
	addEventListener(name, listener) {
		(this.listeners[name] ??= []).push(listener);
	}

	/**
	 * @param {string} name - event name.
	 * @param {Function} listener - listener to drop.
	 */
	removeEventListener(name, listener) {
		const list = this.listeners[name] ?? [];
		const at = list.indexOf(listener);
		if (at >= 0) list.splice(at, 1);
	}

	/**
	 * Dispatch an event and report what the listeners did.
	 * @param {string} name - event name.
	 * @returns {{ defaultPrevented: boolean, propagationStopped: boolean }} listener outcome.
	 */
	dispatch(name) {
		const outcome = { defaultPrevented: false, propagationStopped: false };
		const event = {
			type: name,
			preventDefault: () => {
				outcome.defaultPrevented = true;
			},
			stopPropagation: () => {
				outcome.propagationStopped = true;
			}
		};
		for (const listener of [...(this.listeners[name] ?? [])]) listener(event);
		return outcome;
	}

	/** @returns {FakeElement[]} this element and every descendant, in document order. */
	walk() {
		const out = [this];
		for (const child of this.children) out.push(...child.walk());
		return out;
	}

	/**
	 * @param {FakeElement} node - candidate.
	 * @returns {boolean} whether `node` is this element or one of its descendants.
	 */
	contains(node) {
		return this.walk().includes(node);
	}

	/**
	 * @param {string} selector - the selector.
	 * @returns {FakeElement[]} matching descendants, excluding this element.
	 */
	querySelectorAll(selector) {
		return this.walk()
			.slice(1)
			.filter((node) => matches(node, selector));
	}

	/**
	 * @param {string} selector - the selector.
	 * @returns {FakeElement|null} the first match.
	 */
	querySelector(selector) {
		return this.querySelectorAll(selector)[0] ?? null;
	}
}

/** The document-wide lookups the plugin performs, plus element creation. */
const document = {
	head: new FakeElement('head'),
	body: new FakeElement('body'),
	/**
	 * Document lookups walk the live tree from `body`, exactly as the DOM does, so
	 * a detached node is never a match and a rebuilt tree cannot be shadowed by a
	 * stale one.
	 * @param {string} selector - the selector.
	 * @returns {FakeElement[]} matches, in document order.
	 */
	querySelectorAll(selector) {
		return document.body.walk().filter((node) => matches(node, selector));
	},
	/**
	 * @param {string} selector - the selector.
	 * @returns {FakeElement|null} the first match.
	 */
	querySelector(selector) {
		return document.querySelectorAll(selector)[0] ?? null;
	},
	/**
	 * @param {string} tagName - tag name.
	 * @returns {FakeElement} a detached element.
	 */
	createElement(tagName) {
		return new FakeElement(tagName);
	}
};

/** One in-memory localStorage. */
const storage = {
	/** @type {Map<string,string>} */
	values: new Map(),
	/**
	 * @param {string} key - key.
	 * @returns {string|null} stored value.
	 */
	getItem(key) {
		return storage.values.has(key) ? storage.values.get(key) : null;
	},
	/**
	 * @param {string} key - key.
	 * @param {string} value - value.
	 */
	setItem(key, value) {
		storage.values.set(key, String(value));
	}
};

/** Intervals the plugin asked for; `fireTimers()` runs each one. */
const timers = new Map();
let timerSeq = 0;

/** Mutation observers the plugin installed; `fireObservers()` runs each live one. */
const observers = [];

/**
 * The stand-in has no mutation pipeline, so a case that changes the markup the
 * way React does announces it through `fireObservers()` instead.
 */
class FakeMutationObserver {
	/** @param {() => void} callback - the observer callback. */
	constructor(callback) {
		this.callback = callback;
		this.targets = [];
		this.live = false;
		observers.push(this);
	}

	/**
	 * @param {FakeElement} target - observed node.
	 * @param {any} options - observer options.
	 */
	observe(target, options) {
		this.targets.push({ target, options });
		this.live = true;
	}

	/** Stop reporting. */
	disconnect() {
		this.live = false;
	}
}

globalThis.window = {
	__ModuleLoader__: { load: (registration) => loaded.push(registration) },
	localStorage: storage,
	setInterval: (fn) => {
		const id = ++timerSeq;
		timers.set(id, fn);
		return id;
	},
	clearInterval: (id) => {
		timers.delete(id);
	}
};
globalThis.document = document;
globalThis.MutationObserver = FakeMutationObserver;

/** Captured `__ModuleLoader__.load` registrations. */
const loaded = [];

await import('../lib/client.js');

assert.equal(loaded.length, 1, 'the bundle must register exactly one module');
assert.equal(loaded[0].id, 'dsh-workspace-focus', 'the module id must be the package name');

// The bundle must be self-contained: the factory is handed a `require` that
// refuses everything, so any module request at all is a failure.
const client = loaded[0].factory(() => {
	throw new Error('the bundle must not require any module');
});

assert.equal(client.name, 'workspace-focus');
assert.equal(typeof client.apply, 'function');
assert.deepEqual(client.inject, ['workspaces', 'sessions', 'locale']);

// ------------------------------------------------------------- browser fixture

/**
 * A source shaped like the framework's observable stores.
 * @param {() => any} read - builds a fresh snapshot.
 * @returns {any} the source, with its listener set exposed.
 */
function makeSource(read) {
	const listeners = new Set();
	return {
		listeners,
		/** Publish a new snapshot and wake every listener, as a real store does. */
		emit() {
			for (const listener of [...listeners]) listener();
		},
		getSnapshot: read,
		subscribe(listener) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		}
	};
}

/** Mutable host state the fixture services read. */
const host = {
	/** @type {any[]} */
	workspaces: [],
	/** @type {string|undefined} */
	current: undefined,
	/** When set, the session list reports this field instead of retention. */
	legacyCurrent: undefined
};

/** @type {any} the live workspace source (rebuilt by {@link resetCase}). */
let workspacesList;
/** @type {any} the live session source (rebuilt by {@link resetCase}). */
let sessionsList;
/** The services the plugin resolves by name. */
const services = {
	/** @type {any} */
	workspaces: null,
	/** @type {any} */
	sessions: null
};

/**
 * The session list snapshot the shipped 0.1.6 controller publishes: no `current`
 * field, and the main view's session marked by its retention count.
 * @returns {any} the snapshot.
 */
function sessionSnapshot() {
	const byId = /** @type {Record<string, any>} */ ({});
	if (host.current !== undefined) {
		byId[host.current] = { id: host.current, retainedBy: { mainView: 1 } };
	}
	return { ids: Object.keys(byId), byId, phase: 'ready', subagentsByParent: {}, jobsBySession: {} };
}

/** Rebuild the host state and both sources from scratch. */
function seedHost() {
	host.workspaces = [{ workspaceId: WORKSPACE_A, path: 'C:/one', title: 'one', sessionIds: ['s1'] }];
	host.current = 's1';
	host.legacyCurrent = undefined;
	workspacesList = makeSource(() => ({
		items: host.workspaces,
		phase: 'ready',
		state: 'idle',
		archivedSessionIds: []
	}));
	sessionsList = makeSource(() => {
		const snapshot = sessionSnapshot();
		return host.legacyCurrent === undefined ? snapshot : { ...snapshot, byId: { ...snapshot.byId }, current: host.legacyCurrent };
	});
	services.workspaces = { list: workspacesList };
	services.sessions = { list: sessionsList };
}

/** Locale registrations the plugin made. */
const dicts = [];

/** Clear everything one case may have left behind, and rebuild the host. */
function resetCase() {
	timers.clear();
	observers.length = 0;
	dicts.length = 0;
	storage.values.clear();
	document.head = new FakeElement('head');
	document.body = new FakeElement('body');
	seedHost();
}

/**
 * Build the built-in workspace-browser fixture.
 *
 * The tree sits *three* levels below the browser root, the action row is the
 * header's last child rather than a child of the root, the add-workspace button
 * is wrapped the way the built-in's tooltip wraps it, and the header carries the
 * search box's input — a finder that counted levels, looked at the root's own
 * children or matched the toolbar by position would get this wrong.
 *
 * With `lazy`, the list area is absent until `attachTree()`, which is how the
 * sidebar looks before the built-in component has rendered its list.
 * @param {{ lazy?: boolean, rail?: boolean }} [options] - fixture options.
 * @returns {any} the fixture handles.
 */
function buildBrowser(options = {}) {
	resetCase();
	const root = document.createElement('div');
	document.body.appendChild(root);

	const header = root.appendChild(document.createElement('div'));
	header.className = 'mod_sectionHeader';
	const label = header.appendChild(document.createElement('span'));
	label.className = 'mod_sectionLabel';
	label.textContent = 'workspaces';

	const searchSlot = header.appendChild(document.createElement('div'));
	searchSlot.className = 'mod_searchSlot';
	const searchBox = searchSlot.appendChild(document.createElement('div'));
	let searchButton = null;
	if (options.rail !== true) searchBox.appendChild(document.createElement('input'));
	searchButton = searchBox.appendChild(document.createElement('button'));
	searchButton.className = 'mod_searchButton';
	searchButton.setAttribute('aria-expanded', 'false');

	const actions = header.appendChild(document.createElement('div'));
	actions.className = 'mod_headerActions';
	const viewOptions = actions.appendChild(document.createElement('button'));
	viewOptions.className = `${BUILTIN_ICON} mod_wide`;
	const tooltip = actions.appendChild(document.createElement('span'));
	const addWorkspace = tooltip.appendChild(document.createElement('button'));
	addWorkspace.className = BUILTIN_ICON;

	const attachTree = () => {
		const listArea = root.appendChild(document.createElement('div'));
		const body = listArea.appendChild(document.createElement('div'));
		const tree = body.appendChild(document.createElement('div'));
		tree.setAttribute('role', 'tree');
		return tree;
	};
	if (options.lazy !== true) attachTree();
	return { root, header, searchButton, actions, attachTree };
}

/**
 * Append one rendered Workspace section: its header row first, then its Session
 * rows — the order and nesting the built-in's `groupByWorkspace` produces.
 * @param {FakeElement} tree - the list.
 * @param {string} title - the label the sidebar renders for the Workspace.
 * @param {{ sessions?: { title: string, current?: boolean }[] }} [options] - section contents.
 * @returns {FakeElement} the section container.
 */
function addSection(tree, title, options = {}) {
	const section = tree.appendChild(document.createElement('div'));
	section.className = 'mod_groupSection';
	const row = section.appendChild(document.createElement('div'));
	row.setAttribute('role', 'treeitem');
	row.setAttribute('aria-expanded', 'false');
	row.appendChild(document.createElement('span')).textContent = title;
	for (const session of options.sessions ?? []) {
		const node = section.appendChild(document.createElement('div'));
		node.setAttribute('role', 'treeitem');
		node.setAttribute('aria-selected', session.current === true ? 'true' : 'false');
		node.appendChild(document.createElement('span')).textContent = session.title;
	}
	return section;
}

/**
 * Render the fixture's Workspace items as sections, in the host's order, plus
 * the built-in's Ungrouped bucket when the host has loose Sessions.
 * @param {FakeElement} tree - the list.
 * @param {any[]} items - the Workspaces, in host order.
 * @param {{ ungrouped?: boolean, sessions?: Record<string, { title: string, current?: boolean }[]> }} [options] - extras.
 * @returns {FakeElement[]} the sections, in render order.
 */
function renderSections(tree, items, options = {}) {
	const sections = items.map((item) =>
		addSection(tree, item.title, { sessions: options.sessions?.[item.workspaceId] ?? [] })
	);
	if (options.ungrouped === true) sections.push(addSection(tree, '未分组', { sessions: [{ title: 'loose' }] }));
	return sections;
}

/**
 * Render a nested arrangement: `parent` holds `children` inside the
 * `role="group"` wrapper the built-in uses when Workspaces are a tree.
 * @param {FakeElement} container - where the parent section goes.
 * @param {string} title - the parent Workspace's label.
 * @param {string[]} children - the child Workspaces' labels.
 * @param {{ sessions?: Record<string, { title: string, current?: boolean }[]> }} [options] - session rows by label.
 * @returns {any} the sections.
 */
function renderNested(container, title, children, options = {}) {
	const parent = addSection(container, title, { sessions: options.sessions?.[title] ?? [] });
	const wrapper = parent.appendChild(document.createElement('div'));
	wrapper.setAttribute('role', 'group');
	const nested = children.map((child) =>
		addSection(wrapper, child, { sessions: options.sessions?.[child] ?? [] })
	);
	return { parent, wrapper, nested };
}

/**
 * A context carrying only what the plugin touches, recording its effects so a
 * case can run and tear them down the way the fiber does.
 * @param {{ locale?: any }} [overrides] - swapped services.
 * @returns {any} the context plus its bookkeeping.
 */
function makeCtx(overrides = {}) {
	const effects = [];
	return {
		effects,
		ctx: {
			get: (name) => services[name],
			locale: overrides.locale ?? {
				register: (ns, table) => {
					dicts.push({ ns, table });
				},
				bind: () => (key) => `[${key}]`
			},
			effect(fn, label) {
				effects.push({ fn, label });
			}
		}
	};
}

/**
 * Run every recorded effect the way the fiber does.
 * @param {any} made - the result of {@link makeCtx}.
 * @returns {(() => void)[]} disposers.
 */
function runEffects(made) {
	return made.effects.map(({ fn }) => {
		const dispose = fn();
		return typeof dispose === 'function' ? dispose : () => {};
	});
}

/** Run the plugin's periodic re-anchor check. */
function fireTimers() {
	for (const fn of [...timers.values()]) fn();
}

/** Run the plugin's mutation observers, as the DOM does after a React commit. */
function fireObservers() {
	for (const observer of [...observers]) {
		if (observer.live) observer.callback([]);
	}
}

/** The plugin's mounted button, or null. */
const mountedButton = () => document.querySelector(`.${BUTTON_CLASS}`);

/** The tree the fixture rendered. */
const tree = () => document.querySelector('[role="tree"]');

/** Every section the sidebar rendered, in order. */
const sections = () => client.__internals.groupSections(tree());

/** The sections focus mode is currently hiding. */
const hidden = () => sections().filter((section) => section.hasAttribute(HIDE_ATTR));

/** The sections still on screen. */
const shown = () => sections().filter((section) => !section.hasAttribute(HIDE_ATTR));

/** The label the sidebar rendered for one section. */
const labelOf = (section) => section.children[0].textContent;

/** Two Workspaces, the second holding `s2`. */
const twoWorkspaces = () => [
	{ workspaceId: WORKSPACE_A, path: 'C:/one', title: 'one', sessionIds: ['s1'] },
	{ workspaceId: WORKSPACE_B, path: 'C:/two', title: 'two', sessionIds: ['s2'] }
];

// ------------------------------------------------------------------- reporting

let failures = 0;
/**
 * Run one case, reporting pass/fail without a test framework.
 *
 * The fixture is cleared first: a case that builds its own markup must not
 * satisfy the document-wide lookups from the previous case's leftovers.
 * @param {string} name - case name.
 * @param {() => void} body - case body.
 */
function test(name, body) {
	try {
		resetCase();
		body();
		console.log(`ok   ${name}`);
	} catch (error) {
		failures += 1;
		console.log(`FAIL ${name}`);
		console.log(`     ${error?.message ?? error}`);
	}
}

// ----------------------------------------------------------------------- cases

test('the bundle exports the contract the client module system expects', () => {
	assert.equal(client.name, 'workspace-focus');
	assert.equal(typeof client.apply, 'function');
	assert.deepEqual(client.inject, ['workspaces', 'sessions', 'locale']);
	assert.equal(typeof client.__internals.Focus, 'function');
});

test('the header and its action row are found structurally, not by position', () => {
	const browser = buildBrowser();
	const found = client.__internals.findBrowser();
	assert.ok(found !== null, 'the browser must be found from the tree alone');
	assert.equal(found.tree, tree(), 'through the tree');
	assert.equal(found.header, browser.header, 'up to the header that owns the buttons');
	assert.equal(found.row, browser.actions, 'and on to the toolbar, past the search slot and the tooltip wrapper');
});

test('the finder tolerates deeper list nesting', () => {
	const browser = buildBrowser();
	// A wrapper inserted between the list area and the tree body must not break
	// the climb, and the search slot must never be mistaken for the toolbar.
	const list = tree();
	const wrapper = document.createElement('div');
	list.parentElement.appendChild(wrapper);
	wrapper.appendChild(list);
	const found = client.__internals.findBrowser();
	assert.equal(found.tree, list, 'the tree is still the tree');
	assert.equal(found.header, browser.header);
	assert.equal(found.row, browser.actions);
});

test('a tree React portals to the body is rejected', () => {
	const browser = buildBrowser();
	const sidebar = tree();
	// The subagent lineage menu is a second `role="tree"`, mounted under `body`
	// while it is open. It comes first in document order, so only the walk up to
	// a button-holding sibling keeps the plugin on the sidebar.
	const portal = document.createElement('div');
	portal.setAttribute('role', 'tree');
	document.body.children.unshift(portal);
	portal.parentElement = document.body;
	assert.equal(document.querySelector('[role="tree"]'), portal, 'the portal really is the first tree');

	const found = client.__internals.findBrowser();
	assert.equal(found.tree, sidebar, 'the sidebar tree must win');
	assert.equal(found.header, browser.header);

	const made = makeCtx();
	client.apply(made.ctx);
	runEffects(made);
	assert.ok(browser.actions.contains(mountedButton()), 'and the button must land in the sidebar');
});

test('the collapsed rail keeps the tree but offers no toolbar to mount in', () => {
	const browser = buildBrowser({ rail: true });
	const found = client.__internals.findBrowser();
	assert.ok(found !== null, 'the rail still has a browser');
	assert.equal(found.tree, tree(), 'with a tree');
	assert.equal(found.row, null, 'and no action row, because the header has no search box');

	const made = makeCtx();
	client.apply(made.ctx);
	runEffects(made);
	assert.equal(mountedButton(), null, 'so nothing is mounted there');
	assert.equal(browser.actions.hasAttribute(ROW_ATTR), false, 'and no row is widened');
});

test('the button mounts last in the built-in action row and marks the row for widening', () => {
	const browser = buildBrowser();
	host.workspaces = twoWorkspaces();
	renderSections(tree(), host.workspaces);
	const made = makeCtx();
	client.apply(made.ctx);
	runEffects(made);

	const button = mountedButton();
	assert.ok(button, 'the button must exist');
	assert.ok(browser.actions.contains(button), 'inside the built-in action row');
	assert.equal(browser.actions.children.at(-1), button, 'after the built-in buttons');
	assert.ok(button.classList.contains(BUILTIN_ICON), 'wearing the built-in icon-button classes');
	assert.ok(button.classList.contains(BUTTON_CLASS), 'and its own marker class');
	assert.ok(browser.actions.hasAttribute(ROW_ATTR), 'the row must be marked so the width rule applies');
	assert.ok(browser.header.hasAttribute(HEADER_ATTR), 'and the header, which scopes that rule');
	assert.ok(browser.searchButton.hasAttribute(ROW_ATTR) === false, 'the search control is not the row');
	assert.ok(document.head.children.some((node) => node.tagName === 'STYLE'), 'the stylesheet must be injected');
});

test('the width rule only widens the row while the search box is collapsed', () => {
	const css = client.__internals.CSS_TEXT;
	assert.ok(
		css.includes(`[${HEADER_ATTR}]:has(button[aria-expanded="false"])>[${ROW_ATTR}]{max-width:96px}`),
		`the cap must be raised for a third button, and only then: ${css}`
	);
	assert.ok(
		css.includes(`[${TREE_ATTR}] [${HIDE_ATTR}]{display:none}`),
		'the hide rule must be scoped to the marked tree and reach nested sections'
	);
	assert.equal(
		css.split('max-width').length - 1,
		1,
		'the row cap is the only width the plugin may touch; its own button must not be resized'
	);
	assert.ok(css.includes(`.${BUTTON_CLASS}{flex:none}`), 'the button must only opt out of shrinking');
});

test('nothing mounts before the tree exists, and the tick adopts it later', () => {
	const browser = buildBrowser({ lazy: true });
	host.workspaces = twoWorkspaces();
	const made = makeCtx();
	client.apply(made.ctx);
	runEffects(made);
	assert.equal(mountedButton(), null, 'no anchor means no button');

	renderSections(browser.attachTree(), host.workspaces);
	fireTimers();
	assert.ok(mountedButton(), 'the periodic check must adopt the row once it appears');
	assert.ok(browser.actions.contains(mountedButton()));
});

test('with no current session the toggle is disabled and refuses to activate', () => {
	const browser = buildBrowser();
	host.workspaces = twoWorkspaces();
	renderSections(tree(), host.workspaces);
	host.current = undefined;
	sessionsList.emit();
	const made = makeCtx();
	client.apply(made.ctx);
	runEffects(made);

	const button = mountedButton();
	assert.ok(browser.actions.contains(button));
	assert.equal(button.disabled, true, 'it must be disabled while nothing can be focused');
	assert.equal(button.getAttribute('aria-pressed'), 'false');
	assert.equal(button.title, '[focus.unavailable]');

	const outcome = button.dispatch('click');
	assert.equal(outcome.defaultPrevented, true, 'the click must not reach the built-in row');
	assert.equal(outcome.propagationStopped, true);
	assert.equal(button.getAttribute('aria-pressed'), 'false', 'the toggle must refuse to activate');
	assert.equal(storage.getItem('dsh.workspace.focus.v1'), null, 'nothing may be persisted');
	assert.equal(tree().hasAttribute(TREE_ATTR), false, 'and nothing may be hidden');
});

test('the current session is read from the retention model the built-in now uses', () => {
	const { currentSessionId, workspaceOf } = client.__internals;
	const snapshot = () => workspacesList.getSnapshot();
	assert.equal(currentSessionId(services.sessions), 's1', 'the retained row is the main view’s session');
	assert.equal(workspaceOf(snapshot(), services.sessions), WORKSPACE_A, 'and resolves to its Workspace');

	host.current = undefined;
	sessionsList.emit();
	assert.equal(currentSessionId(services.sessions), undefined, 'no retained row means no current session');

	// A build that predates retention reports the field the list used to carry.
	host.legacyCurrent = 's1';
	sessionsList.emit();
	assert.equal(currentSessionId(services.sessions), 's1', 'the legacy field is honoured');
	assert.equal(workspaceOf(snapshot(), services.sessions), WORKSPACE_A, 'and resolves the same way');

	host.current = 's1';
	host.legacyCurrent = 's-stale';
	sessionsList.emit();
	assert.equal(currentSessionId(services.sessions), 's1', 'retention outranks the legacy field');
});

test('activating hides every Workspace section but the current one', () => {
	const browser = buildBrowser();
	host.workspaces = twoWorkspaces();
	renderSections(tree(), host.workspaces, {
		sessions: { [WORKSPACE_A]: [{ title: 'first', current: true }] }
	});
	const made = makeCtx();
	client.apply(made.ctx);
	runEffects(made);

	const button = mountedButton();
	assert.ok(browser.actions.contains(button));
	assert.equal(button.disabled, false, 'a current session makes the toggle available');
	assert.equal(button.title, '[focus.off]');
	assert.deepEqual(shown().map(labelOf), ['one', 'two'], 'unfocused, every Workspace is listed');

	button.dispatch('click');

	assert.ok(tree().hasAttribute(TREE_ATTR), 'the tree must be marked as the gate');
	assert.deepEqual(shown().map(labelOf), ['one'], 'only the current Workspace stays on screen');
	assert.deepEqual(hidden().map(labelOf), ['two'], 'the other is hidden outright, not regrouped');
	assert.equal(button.getAttribute('aria-pressed'), 'true');
	assert.ok(button.classList.contains(ACTIVE_CLASS), 'the active state must be visible');
	assert.equal(storage.getItem('dsh.workspace.focus.v1'), '1', 'the choice must persist');
	assert.equal(button.title, '[focus.on]');
});

test('nested Workspaces keep the current one and the ancestors that hold it', () => {
	// DSH 0.1.6 can arrange Workspaces as a tree: children render inside their
	// parent's section under a `role="group"` wrapper, so the tree's own children
	// are no longer every section.
	const browser = buildBrowser();
	host.workspaces = [
		{ workspaceId: WORKSPACE_A, path: 'C:/work', title: 'work', sessionIds: [] },
		{ workspaceId: WORKSPACE_B, path: 'C:/work/app', title: 'work/app', sessionIds: ['s2'] },
		{ workspaceId: 'ws-other', path: 'C:/work/other', title: 'work/other', sessionIds: [] },
		{ workspaceId: 'ws-solo', path: 'C:/solo', title: 'solo', sessionIds: [] }
	];
	host.current = 's2';
	const list = tree();
	const nested = renderNested(list, 'work', ['work/app', 'work/other'], {
		sessions: { 'work/app': [{ title: 'the open session', current: true }] }
	});
	addSection(list, 'solo');
	const made = makeCtx();
	client.apply(made.ctx);
	runEffects(made);
	mountedButton().dispatch('click');

	assert.equal(client.__internals.groupSections(list).length, 4, 'sections are found at any depth');
	assert.deepEqual(shown().map(labelOf), ['work', 'work/app'], 'the focused Workspace and its ancestor stay');
	// Sections are discovered tree-first, so the nested pair is reported last.
	assert.deepEqual(hidden().map(labelOf), ['solo', 'work/other'], 'and nothing else does');
	assert.equal(nested.parent.hasAttribute(HIDE_ATTR), false);
	assert.equal(nested.nested[0].hasAttribute(HIDE_ATTR), false);
});

test('the built-in’s Ungrouped bucket is hidden too, not left holding the other Workspaces', () => {
	const browser = buildBrowser();
	host.workspaces = twoWorkspaces();
	const rendered = renderSections(tree(), host.workspaces, { ungrouped: true });
	assert.equal(rendered.length, 3, 'the fixture renders two Workspaces and the bucket');
	const made = makeCtx();
	client.apply(made.ctx);
	runEffects(made);
	mountedButton().dispatch('click');

	assert.deepEqual(shown().map(labelOf), ['one'], 'the bucket must not survive as a home for the rest');
	assert.deepEqual(hidden().map(labelOf), ['two', '未分组']);
	// The plugin never narrows the store, which is what used to feed that bucket.
	assert.equal(workspacesList.getSnapshot().items.length, 2, 'the host list must be untouched');
});

test('the store the sidebar reads is never narrowed', () => {
	const browser = buildBrowser();
	host.workspaces = twoWorkspaces();
	renderSections(tree(), host.workspaces);
	const pristineGetSnapshot = workspacesList.getSnapshot;
	const pristineSubscribe = workspacesList.subscribe;
	const made = makeCtx();
	client.apply(made.ctx);
	runEffects(made);
	mountedButton().dispatch('click');

	assert.equal(workspacesList.getSnapshot, pristineGetSnapshot, 'the source must not be patched');
	assert.equal(workspacesList.subscribe, pristineSubscribe, 'neither reader nor subscriber');
	assert.equal(workspacesList.getSnapshot().items.length, 2, 'and the snapshot must still carry every Workspace');
	assert.ok(browser.actions.contains(mountedButton()), 'the button is still the only thing added');
});

test('the flat list mode is left alone', () => {
	// `groupBy: flat` renders session rows straight into the tree. Hiding "all but
	// the Nth child" there would hide every session but one.
	const browser = buildBrowser();
	host.workspaces = twoWorkspaces();
	const list = tree();
	for (const title of ['a', 'b', 'c']) {
		const row = list.appendChild(document.createElement('div'));
		row.setAttribute('role', 'treeitem');
		row.setAttribute('aria-selected', 'false');
		row.appendChild(document.createElement('span')).textContent = title;
	}
	renderSections(list, []);
	const made = makeCtx();
	client.apply(made.ctx);
	runEffects(made);
	mountedButton().dispatch('click');

	assert.equal(client.__internals.groupSections(list).length, 0, 'session rows are not sections');
	assert.equal(hidden().length, 0, 'nothing may be hidden in a flat list');
	assert.equal(list.hasAttribute(TREE_ATTR), false, 'and the gate must stay off');
});

test('following the current session moves the focus to that session’s Workspace', () => {
	const browser = buildBrowser();
	host.workspaces = twoWorkspaces();
	renderSections(tree(), host.workspaces);
	const made = makeCtx();
	client.apply(made.ctx);
	runEffects(made);
	mountedButton().dispatch('click');
	assert.deepEqual(shown().map(labelOf), ['one']);

	host.current = 's2';
	sessionsList.emit();

	assert.deepEqual(shown().map(labelOf), ['two'], 'the focus must follow the session out');
});

test('the focus resolves the current session against the full Workspace list', () => {
	const browser = buildBrowser();
	host.workspaces = twoWorkspaces();
	renderSections(tree(), host.workspaces);
	const made = makeCtx();
	client.apply(made.ctx);
	runEffects(made);

	// The Workspace holding `s2` is hidden while focused, and still has to be
	// findable, or the focus could never leave `ws-alpha`.
	host.current = 's2';
	sessionsList.emit();
	mountedButton().dispatch('click');
	assert.deepEqual(shown().map(labelOf), ['two']);
});

test('a transiently blank current session keeps the last answered Workspace', () => {
	const browser = buildBrowser();
	host.workspaces = twoWorkspaces();
	renderSections(tree(), host.workspaces);
	const made = makeCtx();
	client.apply(made.ctx);
	runEffects(made);
	mountedButton().dispatch('click');

	host.current = undefined;
	sessionsList.emit();

	assert.deepEqual(shown().map(labelOf), ['one'], 'a right panel taking the selection over must not empty the sidebar');
});

test('a Workspace whose section cannot be identified hides nothing', () => {
	const browser = buildBrowser();
	host.workspaces = twoWorkspaces();
	// Same count, same order, wrong labels: the index mapping is no longer
	// trustworthy, and the honest answer is to show everything.
	renderSections(tree(), [{ title: 'alpha' }, { title: 'beta' }]);
	const made = makeCtx();
	client.apply(made.ctx);
	runEffects(made);
	mountedButton().dispatch('click');

	assert.equal(hidden().length, 0, 'a mismatch must fail towards showing more, never less');
	assert.equal(tree().hasAttribute(TREE_ATTR), false);
});

test('a section count that cannot be reconciled with the Workspace list hides nothing', () => {
	const browser = buildBrowser();
	host.workspaces = twoWorkspaces();
	// Only one of the two Workspaces has rendered its section (a mid-render
	// frame). The index mapping is not trustworthy yet, and the honest answer is
	// to show everything until it is.
	renderSections(tree(), [host.workspaces[0]]);
	const made = makeCtx();
	client.apply(made.ctx);
	runEffects(made);
	mountedButton().dispatch('click');
	assert.equal(hidden().length, 0, 'an unrecognised list shape must not be filtered');
	assert.equal(tree().hasAttribute(TREE_ATTR), false);
});

test('turning the toggle off reveals everything again', () => {
	const browser = buildBrowser();
	host.workspaces = twoWorkspaces();
	renderSections(tree(), host.workspaces, { ungrouped: true });
	const made = makeCtx();
	client.apply(made.ctx);
	runEffects(made);

	const button = mountedButton();
	button.dispatch('click');
	assert.equal(hidden().length, 2);
	button.dispatch('click');
	assert.equal(button.getAttribute('aria-pressed'), 'false');
	assert.equal(button.title, '[focus.off]');
	assert.equal(storage.getItem('dsh.workspace.focus.v1'), '0');
	assert.equal(hidden().length, 0, 'every section must come back');
	assert.equal(tree().hasAttribute(TREE_ATTR), false, 'and the gate must be lifted');
});

test('a persisted choice comes back on the next mount', () => {
	const browser = buildBrowser();
	host.workspaces = twoWorkspaces();
	renderSections(tree(), host.workspaces);
	storage.values.set('dsh.workspace.focus.v1', '1');
	const made = makeCtx();
	client.apply(made.ctx);
	runEffects(made);
	assert.equal(mountedButton().getAttribute('aria-pressed'), 'true');
	assert.ok(mountedButton().classList.contains(ACTIVE_CLASS));
	assert.deepEqual(shown().map(labelOf), ['one']);
});

test('the tick re-marks sections React rebuilt, and reveals one it dropped', () => {
	const browser = buildBrowser();
	host.workspaces = twoWorkspaces();
	renderSections(tree(), host.workspaces);
	const made = makeCtx();
	client.apply(made.ctx);
	runEffects(made);
	mountedButton().dispatch('click');
	assert.equal(hidden().length, 1);

	// React re-creates the sections (a real re-render does), losing the markers.
	const list = tree();
	for (const section of [...list.children]) section.remove();
	renderSections(list, host.workspaces);
	fireTimers();

	assert.deepEqual(shown().map(labelOf), ['one'], 'the tick must re-apply the filter to new nodes');
	assert.deepEqual(hidden().map(labelOf), ['two']);
});

test('the layout switch re-marks a remounted list without waiting for the tick', () => {
	const browser = buildBrowser();
	host.workspaces = twoWorkspaces();
	const list = tree();
	renderSections(list, host.workspaces);
	const made = makeCtx();
	client.apply(made.ctx);
	runEffects(made);
	mountedButton().dispatch('click');
	assert.equal(hidden().length, 1);

	// Collapse to the rail: the built-in renders the list area with no children at
	// all, so the tree leaves the document and takes every marker with it.
	list.remove();
	fireObservers();
	assert.equal(document.querySelector('[role="tree"]'), null, 'there is no list while collapsed');

	// Expand again. The sections come back bare, and only the observer stands
	// between that and a visible flash of the whole workspace list — no tick is
	// fired here.
	renderSections(browser.attachTree(), host.workspaces);
	fireObservers();

	assert.deepEqual(shown().map(labelOf), ['one'], 'the fresh list must be filtered before it paints');
	assert.deepEqual(hidden().map(labelOf), ['two']);
	assert.ok(browser.actions.contains(mountedButton()), 'and the button must be back in the row');
});

test('a null Workspace list leaves the toggle unavailable rather than hiding everything', () => {
	const browser = buildBrowser();
	host.workspaces = [];
	renderSections(tree(), []);
	const made = makeCtx();
	client.apply(made.ctx);
	runEffects(made);
	assert.equal(mountedButton().disabled, true);
	mountedButton().dispatch('click');
	assert.equal(mountedButton().getAttribute('aria-pressed'), 'false');
	assert.equal(hidden().length, 0, 'an unusable toggle must not change what the sidebar shows');
});

test('a service without an observable source leaves the plugin inert', () => {
	const browser = buildBrowser();
	host.workspaces = twoWorkspaces();
	renderSections(tree(), host.workspaces);
	services.workspaces = { list: { getSnapshot: 'not a function' } };
	const made = makeCtx();
	client.apply(made.ctx);
	runEffects(made);
	const button = mountedButton();
	assert.ok(button, 'the button still mounts');
	assert.equal(button.disabled, true, 'but nothing can be focused');
	button.dispatch('click');
	assert.equal(button.getAttribute('aria-pressed'), 'false');
	assert.ok(browser.actions.contains(button));
});

test('the dictionaries are registered under the plugin namespace in both languages', () => {
	buildBrowser();
	const made = makeCtx();
	client.apply(made.ctx);
	runEffects(made);
	assert.equal(dicts.length, 1, 'exactly one locale registration');
	assert.equal(dicts[0].ns, 'workspace-focus');
	assert.ok(dicts[0].table.zh['focus.label'], 'the Chinese copy must exist');
	assert.ok(dicts[0].table.en['focus.label'], 'the English copy must exist');
	assert.deepEqual(
		Object.keys(dicts[0].table.zh).sort(),
		Object.keys(dicts[0].table.en).sort(),
		'both languages must be complete'
	);
});

test('the glyph is drawn inline and distinguishes the two states', () => {
	buildBrowser();
	const made = makeCtx();
	client.apply(made.ctx);
	runEffects(made);

	const { eyeMarkup } = client.__internals;
	assert.match(eyeMarkup(true), /^<svg [^>]*>.*<\/svg>$/);
	assert.ok(eyeMarkup(true).includes('<path'), 'the open eye has paths');
	assert.ok(eyeMarkup(false).split('<path').length > eyeMarkup(true).split('<path').length, 'the struck eye adds a stroke');
	assert.ok(mountedButton().innerHTML.startsWith('<svg'), 'the mounted button must hold the glyph');
	assert.ok(mountedButton().innerHTML.includes('currentColor'), 'the glyph must inherit the button colour');
});

test('unloading takes the button, the markers, the gate and the stylesheet with it', () => {
	const browser = buildBrowser();
	host.workspaces = twoWorkspaces();
	renderSections(tree(), host.workspaces);
	const made = makeCtx();
	client.apply(made.ctx);
	const disposers = runEffects(made);
	mountedButton().dispatch('click');
	assert.ok(mountedButton());

	for (const dispose of disposers.reverse()) dispose();

	assert.equal(mountedButton(), null, 'the button must be gone');
	assert.equal(browser.actions.hasAttribute(ROW_ATTR), false, 'the row must be unmarked');
	assert.equal(browser.header.hasAttribute(HEADER_ATTR), false, 'and the header');
	assert.equal(tree().hasAttribute(TREE_ATTR), false, 'the gate must be lifted');
	assert.equal(hidden().length, 0, 'so nothing stays hidden');
	assert.equal(timers.size, 0, 'the periodic check must be cleared');
	assert.equal(observers.every((observer) => observer.live === false), true, 'the observer must be disconnected');
	assert.equal(workspacesList.listeners.size, 0, 'the plugin’s own store subscription must be released');
	assert.equal(sessionsList.listeners.size, 0, 'and so must the session one');
	assert.equal(document.head.children.length, 0, 'the plugin stylesheet must be removed');
});

test('a detached tree does not keep its gate', () => {
	const browser = buildBrowser();
	host.workspaces = twoWorkspaces();
	renderSections(tree(), host.workspaces);
	const made = makeCtx();
	client.apply(made.ctx);
	runEffects(made);
	mountedButton().dispatch('click');
	assert.ok(tree().hasAttribute(TREE_ATTR));

	// The sidebar unmounts its list entirely (layout switch).
	browser.root.remove();
	fireTimers();
	assert.equal(mountedButton(), null, 'the button follows the markup out');
	assert.equal(document.querySelector('[role="tree"]'), null);
});

console.log(failures === 0 ? '\nall cases passed' : `\n${failures} case(s) failed`);
process.exitCode = failures === 0 ? 0 : 1;
