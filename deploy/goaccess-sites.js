// Site switcher inside GoAccess' burger menu, on desktop and mobile.
(() => {
  function install() {
    if (!window.GoAccess?.Nav || window.GoAccess.Nav.siteMenuInstalled) return;
    window.GoAccess.Nav.siteMenuInstalled = true;
    for (const name of ['renderMenu', 'renderOpts']) {
      const render = window.GoAccess.Nav[name];
      window.GoAccess.Nav[name] = function (...args) {
        const result = render.apply(this, args);
        const list = document.querySelector('.nav-list');
        if (!list || list.querySelector('[data-site-menu]')) return result;
        const section = document.createElement('section');
        section.dataset.siteMenu = 'true';
        const title = document.createElement('h3');
        title.textContent = 'Websites';
        const sites = document.createElement('ul');
        for (const [label, href] of [['F24 SALES', '/'], ['Düngerrechner · MCP/API', '/duengerrechner/']]) {
          const item = document.createElement('li');
          const active = location.pathname.startsWith('/duengerrechner/') === (href !== '/');
          if (active) item.className = 'active';
          const link = document.createElement('a');
          link.href = href;
          link.textContent = label;
          if (active) link.setAttribute('aria-current', 'page');
          item.append(link);
          sites.append(item);
        }
        section.append(title, sites);
        list.prepend(section);
        return result;
      };
    }
  }
  if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', install, {once:true});
  else install();
})();
