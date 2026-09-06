// Hash router (works on GitHub Pages sub-paths without server config).
// Routes look like  #/ledger  or  #/stays/:id  and may declare `roles`.

export class Router {
  constructor({ routes, onChange, notFound }) {
    this.routes = routes.map(r => ({ ...r, re: compile(r.path) }));
    this.onChange = onChange;
    this.notFound = notFound;
    this.current = null;
    window.addEventListener('hashchange', () => this.resolve());
  }
  start() { if (!location.hash) location.replace('#/'); this.resolve(); }
  go(path, { replace = false } = {}) {
    const target = path.startsWith('#') ? path : `#${path}`;
    if (replace) location.replace(target); else location.hash = target;
  }
  resolve() {
    const hash = location.hash.replace(/^#/, '') || '/';
    const [pathPart, queryPart] = hash.split('?');
    const query = Object.fromEntries(new URLSearchParams(queryPart || ''));
    for (const route of this.routes) {
      const m = route.re.exec(pathPart);
      if (m) {
        const params = {};
        route.re.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
        this.current = { route, params, query, path: pathPart };
        this.onChange(this.current);
        return;
      }
    }
    this.current = { route: this.notFound, params: {}, query, path: pathPart };
    this.onChange(this.current);
  }
}

function compile(path) {
  const keys = [];
  const src = path.replace(/\/:([\w]+)/g, (_, k) => { keys.push(k); return '/([^/]+)'; });
  return Object.assign(new RegExp(`^${src}/?$`), { keys });
}
