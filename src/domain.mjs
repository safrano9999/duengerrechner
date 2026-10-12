import '../js/nutrients.js';
import '../js/fertilizers.js';
import { z } from 'zod';
import { assessTargets } from './targets.mjs';

export const core = globalThis.DuengerCore;
export const catalog = globalThis.DuengerFertilizers.map(({ u, ...f }) => ({ ...f, unit: u }));
const nonnegative = z.number().finite().min(0).max(1e9);
const nutrientFields = Object.fromEntries(core.nutrients.map(k => [k, nonnegative.optional()]));
export const nutrientSchema = z.object(nutrientFields).strict();
export const waterSchema = z.object({
  ...nutrientFields, no3: nonnegative.optional(), so4: nonnegative.optional(), po4: nonnegative.optional(),
  gh: nonnegative.optional(), kh: nonnegative.optional(), ks: nonnegative.optional(),
  dilution_percent: z.number().min(0).max(100).default(0),
}).strict().superRefine((v, ctx) => {
  for (const [ion, element] of [['no3', 'n'], ['so4', 's'], ['po4', 'p']]) {
    if (v[ion] !== undefined && v[element] !== undefined)
      ctx.addIssue({ code: 'custom', path: [ion], message: `Specify ${ion} or ${element}, not both` });
  }
});
export const profileSchema = z.object({
  name: z.string().trim().min(1).max(200), water: waterSchema,
  is_default: z.boolean().default(false),
}).strict();
const customSchema = z.object({ name: z.string().min(1).max(200), unit: z.enum(['g', 'ml']), nutrients: nutrientSchema }).strict();
export const mixtureSchema = z.object({
  stage: z.enum(['veg', 'gen']).optional().describe('Growth phase: veg = vegetative (default, as in WebUI), gen = generative. Determines target ranges.'),
  fertilizers: z.array(z.object({
    id: z.number().int().nonnegative().optional(), custom: customSchema.optional(),
    dose: nonnegative, unit: z.enum(['g', 'ml']).optional(),
  }).strict().refine(v => (v.id !== undefined) !== (v.custom !== undefined), 'Specify exactly one of id or custom')).max(100),
  profile_id: z.string().min(1).max(100).optional(),
  use_default_profile: z.boolean().default(true),
  water: waterSchema.optional(),
  dilution_percent: z.number().min(0).max(100).optional(),
  volume_l: z.number().finite().positive().max(1e9).default(1),
}).strict().refine(v => !(v.profile_id && v.water), 'Specify profile_id or inline water, not both');
export const batchSchema = z.object({ mixtures: z.array(mixtureSchema).min(1).max(50) }).strict();
export class AppError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export function fertilizer(id) {
  const f = catalog.find(f => f.id === Number(id));
  if (!f) throw new AppError(404, `Unknown fertilizer: ${id}`);
  return f;
}
export function fertilizers(search = '') {
  return catalog.filter(f => f.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
}
export function calculate(input, selected = null) {
  const empty = () => Object.fromEntries(core.nutrients.map(k => [k, 0]));
  const totals = empty();
  const rows = input.fertilizers.map(row => {
    const f = row.custom ? { ...row.custom.nutrients, name: row.custom.name, unit: row.custom.unit } : fertilizer(row.id);
    if (row.unit && row.unit !== f.unit) throw new AppError(422, `Expected ${f.unit}/l for ${f.name}`);
    const values = Object.fromEntries(core.nutrients.map(k => [k, core.scale(f[k] ?? 0, row.dose)]));
    for (const k of core.nutrients) totals[k] += values[k];
    return { id: f.id ?? null, name: f.name, dose: row.dose, unit: f.unit, amount: core.round(row.dose * input.volume_l, 6), nutrients_mg_l: values };
  });
  const w = input.water ?? selected?.water;
  const contribution = empty();
  let hardness = { gh: null, kh: null };
  const warnings = [];
  if (w) {
    const normalized = { ...w };
    for (const k of ['no3', 'po4', 'so4']) if (w[k] !== undefined) {
      const c = core.conversions[k]; normalized[c.to] = core.round(w[k] * c.factor, 3);
    }
    // The browser adds water nitrate to total N; expose its known nitrate fraction too.
    if (w.no3 !== undefined && w['n-no3'] === undefined) normalized['n-no3'] = normalized.n;
    const fraction = 1 - (input.dilution_percent ?? w.dilution_percent ?? 0) / 100;
    for (const k of core.nutrients) contribution[k] = core.scale(normalized[k] ?? 0, fraction);
    const gh = w.gh ?? (w.ca !== undefined && w.mg !== undefined ? core.calcGH(w.ca, w.mg) : null);
    const kh = w.kh ?? (w.ks !== undefined ? core.calcKH(w.ks) : null);
    hardness = { gh: gh === null ? null : core.scale(gh, fraction), kh: kh === null ? null : core.scale(kh, fraction) };
    if (w.ca === undefined || w.mg === undefined) warnings.push('Water calcium/magnesium incomplete; hardness alone cannot determine their individual concentrations.');
  } else warnings.push('No water profile applied; totals contain fertilizer contributions only.');
  for (const k of core.nutrients) totals[k] = core.round(totals[k] + contribution[k], 6);
  return {
    volume_l: input.volume_l, fertilizers: rows, totals_mg_l: totals,
    target_assessment: assessTargets(totals, input.stage ?? 'veg', input.stage === undefined),
    nitrogen_percent: Object.fromEntries(['n-no3', 'n-nh4', 'n-nu', 'n-org'].map(k => [k, totals.n ? core.round(totals[k] / totals.n * 100, 3) : 0])),
    water: { source: input.water ? 'inline' : selected ? 'profile' : 'none', profile_id: selected?.id ?? null, name: selected?.name ?? null,
      dilution_percent: input.dilution_percent ?? w?.dilution_percent ?? 0, nutrients_mg_l: contribution, hardness_dh: hardness,
      unknown_nutrients: w ? core.nutrients.filter(k => w[k] === undefined && !({ n: 'no3', p: 'po4', s: 'so4', 'n-no3': 'no3' }[k] in w)) : core.nutrients },
    warnings,
  };
}
export function service(store) {
  return {
    fertilizers, fertilizer,
    profiles: () => store.list(),
    async profile(id) { const p = (await store.list()).find(p => p.id === id); if (!p) throw new AppError(404, 'Unknown water profile'); return p; },
    saveProfile: (data, id) => store.save(profileSchema.parse(data), id),
    deleteProfile: id => store.delete(id),
    async calculate(data) {
      const v = mixtureSchema.parse(data);
      let profile = null;
      if (v.profile_id) profile = await this.profile(v.profile_id);
      else if (!v.water && v.use_default_profile) profile = (await store.list()).find(p => p.is_default) ?? null;
      return calculate(v, profile);
    },
    async batch(data) { const v = batchSchema.parse(data); return Promise.all(v.mixtures.map(m => this.calculate(m))); },
  };
}
