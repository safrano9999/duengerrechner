import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { startApi } from '../src/node-api.mjs';
import { mcpApp } from '../src/mcp-http.mjs';
import { serve } from '@hono/node-server';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { settings } from '../src/settings.mjs';

async function port() { const s=createServer(); await new Promise(r=>s.listen(0,'127.0.0.1',r)); const p=s.address().port; await new Promise(r=>s.close(r)); return p; }
async function ready(url, child) { for(let i=0;i<150;i++){ if(child.exitCode!==null) throw Error('Child exited: '+child.exitCode); try {if((await fetch(url)).ok)return;}catch{} await delay(100); } throw Error('Startup timeout'); }
async function stop(child) { if(child.exitCode!==null)return; const done=new Promise(r=>child.once('exit',r)); child.kill('SIGTERM'); const timer=setTimeout(()=>child.kill('SIGKILL'),5000); await done;clearTimeout(timer); }
async function mcpCheck(url, token) {
  const client=new Client({name:'integration',version:'1'});
  await client.connect(new StreamableHTTPClientTransport(new URL(url),{requestInit:{headers:{Authorization:`Bearer ${token}`}}}));
  try { const r=await client.callTool({name:'calculate_mixture',arguments:{fertilizers:[{id:27,dose:1}],use_default_profile:false}}); assert.equal(r.isError,undefined,JSON.stringify(r)); assert.equal(r.structuredContent.result.totals_mg_l.n,200); } finally {await client.close();}
}

test('container settings ignore bare-metal ports and use loopback REST',()=>{
  const c=settings({CONTAINER_MODE:'1',API_PORT:'9001',MCP_PORT:'9002',API_HOST:'example.invalid',CONFIG_FILE:'/nonexistent',ENV_FILE:'/nonexistent'});
  assert.equal(c.apiPort,8080);assert.equal(c.mcpPort,8000);assert.equal(c.apiUrl,'http://127.0.0.1:8080/api');
});

test('FastAPI bare-metal launch serves UI, REST and MCP with optional bearer', {timeout:30000},async t=>{
  const dir=mkdtempSync(join(tmpdir(),'duenger-runtime-')); t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const apiPort=await port(), mcpPort=await port();
  const child=spawn(process.env.PYTHON || '.venv/bin/python',['scripts/start-baremetal.py'],{env:{...process.env,API_PORT:String(apiPort),MCP_PORT:String(mcpPort),API_BEARER_TOKEN:'apitest',MCP_BEARER_TOKEN:'mcptest',PROFILES_DB:join(dir,'profiles.sqlite'),CONFIG_FILE:join(dir,'missing'),ENV_FILE:join(dir,'missing')},stdio:['ignore','ignore','pipe']});
  let logs='';child.stderr.on('data',d=>logs+=d);t.after(()=>stop(child));
  try {
    await ready(`http://127.0.0.1:${apiPort}/health`,child);
    assert.equal((await fetch(`http://127.0.0.1:${apiPort}/api/fertilizers`)).status,401);
    const html=await (await fetch(`http://127.0.0.1:${apiPort}/`)).text();
    assert.equal((html.match(/id="api-link"/g)||[]).length,1);
    assert.ok(html.indexOf('id="api-link"')>html.lastIndexOf('</dialog>'));
    assert.equal((await fetch(`http://127.0.0.1:${apiPort}/.env`)).status,404);
    await mcpCheck(`http://127.0.0.1:${mcpPort}/mcp`,'mcptest');
  }catch(e){e.message+='\n'+logs;throw e;}
});

test('exact Supergateway 4.1.0 stays on loopback and passes authenticated MCP to REST', {timeout:30000},async t=>{
  const apiPort=await port(), gatewayPort=await port();
  const {server,store}=startApi({apiHost:'127.0.0.1',apiPort,mcpPort:0,database:':memory:',API_BEARER_TOKEN:'apitest'});
  t.after(()=>new Promise(r=>server.close(()=>{store.close();r();})));
  const cmd=`${JSON.stringify(process.execPath)} ${JSON.stringify(resolve('src/mcp-stdio.mjs'))}`;
  const child=spawn('node_modules/.bin/supergateway',['--stdio',cmd,'--outputTransport','streamableHttp','--port',String(gatewayPort),'--streamableHttpPath','/mcp','--healthEndpoint','/health','--logLevel','none'],{env:{...process.env,NODE_OPTIONS:`--import=${resolve('scripts/gateway-loopback.mjs')}`,API_URL:`http://127.0.0.1:${apiPort}/api`,API_BEARER_TOKEN:'apitest',CONFIG_FILE:'/nonexistent',ENV_FILE:'/nonexistent'},stdio:['ignore','ignore','pipe']});
  let logs='';child.stderr.on('data',d=>logs+=d);t.after(()=>stop(child));
  await ready(`http://127.0.0.1:${gatewayPort}/health`,child);
  // Linux socket table: gateway must bind specifically to 127.0.0.1, never 0.0.0.0.
  const sockets=readFileSync('/proc/net/tcp','utf8').split('\n').filter(l=>l.trim().split(/\s+/)[1]?.endsWith(':'+gatewayPort.toString(16).toUpperCase().padStart(4,'0')));
  assert.ok(sockets.some(l=>l.includes('0100007F:')));
  assert.ok(!sockets.some(l=>l.trim().split(/\s+/)[1].startsWith('00000000:')));
  const proxy=serve({fetch:mcpApp(null,{MCP_BEARER_TOKEN:'mcptest'},`http://127.0.0.1:${gatewayPort}/mcp`).fetch,hostname:'127.0.0.1',port:0});
  await new Promise(r=>proxy.once('listening',r));t.after(()=>new Promise(r=>proxy.close(r)));
  const url=`http://127.0.0.1:${proxy.address().port}/mcp`;
  assert.equal((await fetch(url,{method:'POST'})).status,401);
  try{await mcpCheck(url,'mcptest');}catch(e){e.message+='\n'+logs;throw e;}
});
