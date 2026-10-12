// Supergateway 4.1.0 has no bind-host option. Applied only to its child process.
// Keep the unauthenticated gateway private behind the authenticated MCP listener.
import { Server } from 'node:net';
const listen = Server.prototype.listen;
Server.prototype.listen = function (...args) {
  if (typeof args[0] === 'number' || /^\d+$/.test(String(args[0]))) {
    const callback = args.find(arg => typeof arg === 'function');
    return listen.call(this, { port: Number(args[0]), host: '127.0.0.1' }, ...(callback ? [callback] : []));
  }
  if (args[0] && typeof args[0] === 'object' && 'port' in args[0]) {
    args[0] = { ...args[0], host: '127.0.0.1' };
    return listen.apply(this, args);
  }
  throw new Error('Unsupported Supergateway listen signature');
};
