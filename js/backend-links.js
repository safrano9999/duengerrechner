// Only public URLs are loaded here, never API credentials.
window.addEventListener('DOMContentLoaded', async () => {
  try {
    let response = await fetch('backend.json');
    if (!response.ok) response = await fetch('backend.example.json');
    if (!response.ok) return;
    const config = await response.json();
    for (const [key, id] of [['api_url', 'api-link'], ['mcp_url', 'mcp-link']]) {
      const url = new URL(config[key], location.href);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) continue;
      const a = document.getElementById(id);
      a.href = url.href;
      a.title = url.href;
      a.textContent = `${id === 'api-link' ? 'API' : 'MCP'}: ${url.href}`;
    }
  } catch (_) { /* The original browser calculator remains usable offline. */ }
});
