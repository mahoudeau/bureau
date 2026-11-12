// Boot: take a handed-over token, draw the frame, start routing.

import * as api from './api.js';
import * as store from './store.js';
import { mountLayout } from './layout.js';
import { startRouter } from './router.js';
import './palette.js';
import { startSelectMenus } from './select-menu.js';
import { foldIfAsked } from './motion.js';

const desk = () => import('./pages/desk.js');

const routes = [
  { path: '/', title: 'Desk', load: desk },
  { path: '/index.html', title: 'Desk', load: desk },
  { path: '/sign-in', title: 'Sign in', public: true, bare: true, load: () => import('./pages/sign-in.js') },
  { path: '/missions', title: 'Missions', load: () => import('./pages/missions.js') },
  { path: '/missions/new', title: 'New mission', load: () => import('./pages/mission-new.js') },
  { path: '/missions/:id', title: 'Mission', load: () => import('./pages/mission.js') },
  { path: '/goals', title: 'Goals', load: () => import('./pages/goals.js') },
  { path: '/goals/new', title: 'New goal', load: () => import('./pages/goal-new.js') },
  { path: '/goals/:id', title: 'Goal', load: () => import('./pages/goal.js') },
  { path: '/brain', title: 'Brain', load: () => import('./pages/brain.js') },
  { path: '/brain/*path', title: 'Brain', load: () => import('./pages/note.js') },
  { path: '/projects', title: 'Projects', load: () => import('./pages/projects.js') },
  { path: '/projects/:id', title: 'Project', load: () => import('./pages/project.js') },
  { path: '/agents', title: 'Agents', load: () => import('./pages/agents.js') },
  { path: '/activity', title: 'Activity', load: () => import('./pages/activity.js') },
  { path: '/settings', title: 'Settings', load: () => import('./pages/settings.js') },
];

function guard(route, url) {
  if (url.pathname === '/sign-in') return api.getToken() ? api.nextPath(url.search) : null;
  if (route.public) return null;
  if (!api.getToken()) return api.signInPath();
  store.start();
  return null;
}

window.BureauHub.takeUrlToken();
// A #token= pasted over an open tab doesn't load a page, so nothing else sees it.
window.addEventListener('hashchange', () => {
  if (window.BureauHub.takeUrlToken()) location.reload();
});

const layout = mountLayout(document.getElementById('app'));
startRouter({ routes, outlet: layout.outlet, guard, onRoute: layout.update });
startSelectMenus();
// Meters, heat strips, images, the long shadow, the dock band and fill
// titles, kept drawn as pages render (OMAKO DS, js/dither.js).
if (window.OmakoDither) window.OmakoDither.start();
// After signing in, the first page folds open, once a session.
layout.outlet.addEventListener('bureau:rendered', () => foldIfAsked(layout.outlet));
