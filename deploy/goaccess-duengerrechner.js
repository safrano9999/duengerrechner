(() => {
  const menu = document.createElement('script');
  menu.src = '/goaccess-sites.js';
  document.head.append(menu);
  window.addEventListener('load', () => {
    const root = document.getElementById('panels');
    if (!root) return;
    const row = document.createElement('div');
    row.className = 'row';
    row.id = 'duengerrechner-overview';
    const node = (tag, text, cls = '') => {
      const element = document.createElement(tag);
      element.textContent = text;
      element.className = cls;
      return element;
    };
    const sections = {};
    for (const [kind, title, description] of [
      ['api', 'API · REST & GraphQL', '/api und /graphql'],
      ['mcp', 'MCP · Agenten-Anschluss', '/mcp · GET und POST getrennt aufgeführt'],
      ['web', 'Web · Seiten & Assets', 'Weboberfläche, statische Dateien und übrige Pfade'],
    ]) {
      const col = node('div', '', 'col-md-4');
      const article = node('article', '');
      article.id = `duengerrechner-${kind}`;
      const header = node('header', '');
      header.append(node('h2', title, 'gheader'), node('small', description, 'text-muted'));
      const content = node('div', 'Lade Zugriffsstatistik …');
      article.append(header, content);
      col.append(article);
      row.append(col);
      sections[kind] = content;
    }
    const mount = () => { if (root.firstElementChild !== row) root.prepend(row); };
    mount();
    new MutationObserver(mount).observe(root, {childList:true});
    const status = node('p', '', 'text-muted');
    status.style.padding = '12px';
    root.before(status);
    const refresh = async () => {
      try {
        const response = await fetch('/duengerrechner/summary.json', {cache:'no-store', credentials:'same-origin'});
        if (!response.ok) throw new Error('Unavailable');
        const feed = await response.json();
        status.textContent = `Stand: ${new Date(feed.generated_at).toLocaleString()}. Log-Abruf täglich 01:10 und 13:10 UTC, jeweils die letzten 24 Stunden. Die Standardauswertungen darunter zeigen alle bisher importierten Zugriffe.`;
        for (const [kind, content] of Object.entries(sections)) {
          content.replaceChildren();
          const counts = node('p', `${feed.last_24h?.[kind] || 0} Requests in den letzten 24 Stunden zum Abrufzeitpunkt · ${feed.total?.[kind] || 0} insgesamt`);
          const wrap = node('div', '', 'table-responsive');
          const table = node('table', '', 'table table-borderless table-hover');
          const head = node('thead', '');
          const headRow = node('tr', '');
          for (const title of ['Methode', 'Pfad', 'Status', 'Gesamt']) headRow.append(node('th', title));
          head.append(headRow);
          const body = node('tbody', '');
          for (const entry of feed.routes || []) {
            if (entry.kind !== kind) continue;
            const tr = node('tr', '');
            for (const value of [entry.method, entry.path, entry.status, entry.requests]) tr.append(node('td', String(value)));
            body.append(tr);
          }
          table.append(head, body);
          wrap.append(table);
          content.append(counts, wrap);
        }
      } catch (_) {
        status.textContent = 'Die Übersicht ist gerade nicht erreichbar. Die zuletzt erzeugten GoAccess-Auswertungen stehen darunter.';
      }
    };
    refresh();
    window.setInterval(refresh, 30000);
  }, {once:true});
})();
