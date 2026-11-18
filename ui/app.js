// The entry point Teralo loads in the app's frame, for the page and for the dashboard card.
// Bundled by `teralo-app build`, so it can import the SDK, Chart.js and ../screens.
import { api, connect, navigate, onNavigate, onTheme } from '@teralo-co/apps/client';
import card from '../screens/card.js';
import deliveries from '../screens/deliveries.js';
import history from '../screens/history.js';
import { empty, formatter, h, locationNames } from '../screens/lib.js';
import overview from '../screens/overview.js';
import remaining from '../screens/remaining.js';
import setup from '../screens/setup.js';

const SCREENS = [
	{ path: '/', label: 'Overview', render: overview },
	{ path: '/deliveries', label: 'Deliveries', render: deliveries },
	{ path: '/remaining', label: 'Remaining', render: remaining },
	{ path: '/setup', label: 'Setup', render: setup, managers: true },
	{ path: '/history', label: 'History', render: history }
];

const root = document.getElementById('app');
const { surface, path } = await connect();

/** What every screen reads: the summary from the server, its formats, and a way to reload. */
const app = { data: null, fmt: null, names: null, locations: [], path, refresh };

async function refresh() {
	const response = await api('/summary');
	if (!response.ok) {
		const { error } = await response.json().catch(() => ({}));
		root.replaceChildren(empty(error ?? 'The tracker could not be loaded.'));
		return;
	}
	app.data = await response.json();
	app.fmt = formatter(app.data.project);
	app.names = locationNames(app.data.locations);
	// Pickers list areas by full name, so a level sits above its rooms.
	app.locations = [...app.names]
		.map(([id, name]) => ({ id, name }))
		.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
	render();
}

function go(next) {
	app.path = next;
	navigate(next);
	render();
}

function render() {
	if (!app.data) return;
	if (surface === 'card') {
		root.replaceChildren(card(app));
		return;
	}
	const screen = SCREENS.find((s) => s.path === app.path) ?? SCREENS[0];
	const nav = h(
		'nav',
		null,
		SCREENS.filter((s) => !s.managers || app.data.person.canManage).map((s) =>
			h(
				'a',
				{
					href: s.path,
					class: s === screen ? 'current' : '',
					onclick: (event) => {
						event.preventDefault();
						go(s.path);
					}
				},
				s.label
			)
		)
	);
	root.replaceChildren(nav, screen.render(app));
}

onNavigate((next) => {
	app.path = next;
	render();
});
// The chart reads the theme's colours when it draws.
onTheme(render);
await refresh();
