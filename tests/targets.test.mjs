import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sqliteStore } from '../src/node-store.mjs';
import { service } from '../src/domain.mjs';
import { targetRanges } from '../src/targets.mjs';
import { createApi } from '../src/api.mjs';
const balanced = { n: 200, 'n-no3': 180, 'n-nh4': 20, p: 30, k: 120, ca: 100, mg: 50, s: 60, b: 0.2, cu: 0.05, fe: 2, mn: 0.8, mo: 0.02, zn: 0.2 };
const mixture = (nutrients = balanced, extra = {}) => ({ fertilizers: [{ custom: { name: 'Reference', unit: 'g', nutrients }, dose: 1 }], use_default_profile: false, ...extra });
function setup(t) { const store = sqliteStore(':memory:'); t.after(() => store.close()); return { svc: service(store), api: createApi(store) }; }

test('target ranges match the original WebUI table for both phases', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8').split('<tr id="opt-ranges">')[1].split('</tr>')[0];
  const cells = [...html.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map(m => m[1]);
  for (const stage of ['veg', 'gen']) {
    for (const [nutrient, index] of Object.entries({ n: 0, p: 4, k: 5, ca: 6, mg: 7, s: 8, b: 9, cu: 10, fe: 11, mn: 12, mo: 13, zn: 14 })) {
      const text = cells[index].match(new RegExp(`<em[^>]*data-stage="${stage}"[^>]*>([\\s\\S]*?)<\\/em>`))?.[1] ?? cells[index];
      const values = text.replaceAll('&nbsp;', ' ').replaceAll(',', '.').match(/\d+(?:\.\d+)?/g).map(Number);
      assert.deepEqual(targetRanges[stage][nutrient], values, `${stage}: ${nutrient}`);
    }
  }
  assert.match(cells[1], /&gt; 70 %/); assert.match(cells[2], /&lt; 30 %/);
});

test('default phase reports precise deviations and generative phase changes the phosphorus target', async t => {
  const { svc } = setup(t);
  const input = { fertilizers: [{ id: 27, dose: 0.5 }, { id: 28, dose: 0.75 }], use_default_profile: false };
  const veg = (await svc.calculate(input)).target_assessment;
  assert.equal(veg.stage, 'veg'); assert.equal(veg.stage_defaulted, true); assert.equal(veg.all_in_range, false);
  const p = veg.deviations.find(c => c.nutrient === 'p');
  assert.equal(p.actual, 50.186); assert.equal(p.status, 'above'); assert.equal(p.distance_to_range, 10.186); assert.equal(p.adjustment, 'decrease');
  assert.equal(veg.checks.length, 14); assert.equal(veg.out_of_range_count, veg.deviations.length);
  const gen = (await svc.calculate({ ...input, stage: 'gen' })).target_assessment;
  assert.equal(gen.stage_defaulted, false); assert.equal(gen.checks.find(c => c.nutrient === 'p').status, 'within_range');
  const batch = await svc.batch({ mixtures: [input, { ...input, stage: 'gen' }] });
  assert.deepEqual(batch.map(r => r.target_assessment.stage), ['veg', 'gen']);
  await assert.rejects(svc.calculate({ ...input, stage: 'unknown' }));
});

test('in-range mixtures, inclusive concentration bounds and strict nitrogen percentages', async t => {
  const { svc } = setup(t);
  const ok = (await svc.calculate(mixture())).target_assessment;
  assert.equal(ok.all_in_range, true); assert.equal(ok.out_of_range_count, 0); assert.deepEqual(ok.unassessable, []);
  for (const stage of ['veg', 'gen']) for (const edge of [0, 1]) {
    const nutrients = Object.fromEntries(Object.entries(targetRanges[stage]).map(([k, v]) => [k, v[edge]]));
    nutrients['n-no3'] = nutrients.n * 0.9; nutrients['n-nh4'] = nutrients.n * 0.1;
    assert.equal((await svc.calculate(mixture(nutrients, { stage }))).target_assessment.all_in_range, true);
  }
  const strict = (await svc.calculate(mixture({ ...balanced, 'n-no3': 140, 'n-nh4': 60 }))).target_assessment;
  assert.equal(strict.all_in_range, false);
  assert.deepEqual(strict.deviations.map(c => [c.nutrient, c.status, c.distance_to_range]), [['n-no3', 'below', 0], ['n-nh4', 'above', 0]]);
  assert.equal(strict.deviations[0].min_inclusive, false); assert.equal(strict.deviations[1].max_inclusive, false);
  const zero = (await svc.calculate({ fertilizers: [] })).target_assessment;
  assert.equal(zero.all_in_range, false); assert.deepEqual(zero.unassessable, ['n-no3', 'n-nh4']);
  assert.equal(zero.checks.find(c => c.nutrient === 'n-no3').actual, null);
});

test('water contribution is assessed and REST/GraphQL expose the same target feedback', async t => {
  const { svc, api } = setup(t);
  const profile = await svc.saveProfile({ name: 'Water', water: { ca: 100, mg: 50 } });
  const input = mixture({ ...balanced, ca: 0, mg: 0 }, { profile_id: profile.id, stage: 'gen' });
  const without = await svc.calculate(mixture({ ...balanced, ca: 0, mg: 0 }));
  assert.equal(without.target_assessment.checks.find(c => c.nutrient === 'ca').status, 'below');
  const post = async (path, body) => (await api.request(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();
  const rest = await post('/api/calculate', input);
  assert.equal(rest.target_assessment.all_in_range, true);
  assert.equal(rest.target_assessment.checks.find(c => c.nutrient === 'ca').actual, 100);
  const gql = await post('/graphql', { query: 'query($input: Mixture!){calculate(input:$input){target_assessment{stage all_in_range out_of_range_count checks{nutrient actual status}}}}', variables: { input } });
  assert.equal(gql.errors, undefined, JSON.stringify(gql));
  assert.deepEqual(gql.data.calculate.target_assessment, {
    stage: 'gen', all_in_range: true, out_of_range_count: 0,
    checks: rest.target_assessment.checks.map(({ nutrient, actual, status }) => ({ nutrient, actual, status })),
  });
});
