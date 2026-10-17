/**
 * Hash routing: #/  #/learn/<lesson>  #/explore  #/under-the-hood
 *
 * Why the hash? The site is static files on any host and any sub-path (e.g. /fee-explorer/).
 * Everything after # stays in the browser, so the server never sees /learn/… and can't 404 on it.
 */
export type Route =
  | { view: 'home' }
  | { view: 'learn'; lesson: string | null }
  | { view: 'explore' }
  | { view: 'hood' };

export function parseRoute(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  switch (parts[0]) {
    case 'learn':
      return { view: 'learn', lesson: parts[1] ? decodeURIComponent(parts[1]) : null };
    case 'explore':
      return { view: 'explore' };
    case 'under-the-hood':
      return { view: 'hood' };
    default:
      return { view: 'home' };
  }
}

export function href(route: Route): string {
  switch (route.view) {
    case 'home':
      return '#/';
    case 'learn':
      return route.lesson ? `#/learn/${encodeURIComponent(route.lesson)}` : '#/learn';
    case 'explore':
      return '#/explore';
    case 'hood':
      return '#/under-the-hood';
  }
}
