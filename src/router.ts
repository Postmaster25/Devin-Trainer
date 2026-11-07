import { useEffect, useState } from 'react';

export type Route =
  | { name: 'schedule'; week?: number }
  | { name: 'workout'; key: string }
  | { name: 'timer'; key: string }
  | { name: 'settings' };

export function parseHash(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  if (parts[0] === 'workout' && parts[1]) return { name: 'workout', key: parts[1] };
  if (parts[0] === 'timer' && parts[1]) return { name: 'timer', key: parts[1] };
  if (parts[0] === 'settings') return { name: 'settings' };
  if (parts[0] === 'week' && parts[1]) return { name: 'schedule', week: Number(parts[1]) };
  return { name: 'schedule' };
}

export function href(route: Route): string {
  switch (route.name) {
    case 'workout':
      return `#/workout/${route.key}`;
    case 'timer':
      return `#/timer/${route.key}`;
    case 'settings':
      return '#/settings';
    case 'schedule':
      return route.week ? `#/week/${route.week}` : '#/';
  }
}

export function navigate(route: Route, replace = false) {
  const h = href(route);
  if (replace) history.replaceState(null, '', h);
  else location.hash = h;
  if (replace) window.dispatchEvent(new HashChangeEvent('hashchange'));
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseHash(location.hash));
  useEffect(() => {
    const on = () => setRoute(parseHash(location.hash));
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}
