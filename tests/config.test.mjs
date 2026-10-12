import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, cpSync, writeFileSync, readFileSync, readdirSync, rmSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
function fixture(t) {
  const temp=mkdtempSync(join(tmpdir(),'duenger-config-')); const dir=join(temp,'duengerrechner');mkdirSync(dir);
  t.after(()=>rmSync(temp,{recursive:true,force:true}));
  for(const f of ['scripts','src','config.sh','setup.sh','config.conf_example','container.example','env.example','package.json'])cpSync(f,join(dir,f),{recursive:true});
  return dir;
}
function run(dir,args=[]) {const r=spawnSync('bash',['setup.sh',...args],{cwd:dir,input:'\n'.repeat(100),encoding:'utf8',timeout:20000});assert.equal(r.status,0,r.stdout+'\n'+r.stderr);return r.stdout;}
test('container config omits bare-metal prompts, preserves secrets and publishes only selected fixed ports',t=>{
  const dir=fixture(t);
  const output=run(dir);
  assert.doesNotMatch(output,/(?:API_PORT|MCP_PORT|PROFILES_DB)\s*[\[:]/);
  const quadlet=join(dir,'duengerrechner.container');
  let q=readFileSync(quadlet,'utf8');
  assert.match(q,/Image=ghcr.io\/safrano9999\/duengerrechner:latest/);
  assert.match(q,/Pull=never/); assert.doesNotMatch(q,/PublishPort=/);
  writeFileSync(join(dir,'.env'),'API_BEARER_TOKEN=retained-test-token\nMCP_BEARER_TOKEN=retained-mcp-token\n');
  writeFileSync(join(dir,'container.conf'),'API_PUBLISH_HOST=127.0.0.1\nAPI_PUBLISH_PORT=9090\nMCP_PUBLISH_PORT=9999\nMCP_PUBLISH_HOST=127.0.0.1\nDATA_VOLUMES=duengerrechner-data:/data:Z\nADDITIONAL_LINE=Pull=never\nADDITIONAL_LINE_02=Network=my-podman-network\n');
  run(dir,['--render-container']);q=readFileSync(quadlet,'utf8');
  assert.match(q,/PublishPort=127.0.0.1:9090:8080/);assert.match(q,/PublishPort=127.0.0.1:9999:8000/);
  assert.match(q,/Network=my-podman-network/);assert.match(q,/EnvironmentFile=.*\.env/);
  assert.equal(readFileSync(join(dir,'.env'),'utf8'),'API_BEARER_TOKEN=retained-test-token\nMCP_BEARER_TOKEN=retained-mcp-token\n');
  assert.match(readFileSync(join(dir,'docker-compose.yml'),'utf8'),/pull_policy: never/);
});
test('bare-metal config generates FastAPI systemd service with selected listener ports',t=>{
  const dir=fixture(t);run(dir,['--no-container']);
  assert.match(readFileSync(join(dir,'config.conf'),'utf8'),/API_PORT=8080/);
  assert.match(readFileSync(join(dir,'duengerrechner.service'),'utf8'),/ExecStart=.*\.venv\/bin\/python.*start-baremetal.py/);
  assert.ok(!readdirSync(dir).some(f=>f.endsWith('.container')));
});

test('setup prints symlink instructions after generating both container files',t=>{
  const dir=fixture(t);
  const result=spawnSync('bash',['setup.sh'],{cwd:dir,input:'\n'.repeat(100),encoding:'utf8',timeout:20000});
  assert.equal(result.status,0,result.stdout+'\n'+result.stderr);
  assert.match(result.stdout,/ln -s .*duengerrechner.container/);
  assert.ok(readFileSync(join(dir,'docker-compose.yml'),'utf8').includes('8080') === false);
  assert.ok(readFileSync(join(dir,'duengerrechner.container'),'utf8').includes('Pull=never'));
});
