// Reference values from index.html#opt-ranges; a regression test checks parity.
const common = { n: [160, 230], k: [60, 200], mg: [35, 75], b: [0.1, 0.5], cu: [0.02, 0.19], fe: [1.2, 4], mn: [0.6, 1], mo: [0.01, 0.03], zn: [0.12, 0.4] };
export const targetRanges = {
  veg: { ...common, p: [15, 40], ca: [45, 180], s: [47, 89] },
  gen: { ...common, p: [25, 90], ca: [45, 190], s: [47, 180] },
};
const round = v => Number(v.toFixed(6));
function check(nutrient, unit, actual, min, max, minInclusive = true, maxInclusive = true) {
  const status = actual === null ? 'not_assessable'
    : min !== null && (actual < min || (!minInclusive && actual === min)) ? 'below'
    : max !== null && (actual > max || (!maxInclusive && actual === max)) ? 'above' : 'within_range';
  return {
    nutrient, unit, actual: actual === null ? null : round(actual), min, max, min_inclusive: minInclusive, max_inclusive: maxInclusive, status,
    // At a strict boundary the distance is zero but a further change is required.
    distance_to_range: status === 'not_assessable' ? null : round(status === 'below' ? min - actual : status === 'above' ? actual - max : 0),
    adjustment: status === 'below' ? 'increase' : status === 'above' ? 'decrease' : status === 'not_assessable' ? 'provide_data' : 'keep_in_range',
  };
}
export function assessTargets(totals, stage = 'veg', stageDefaulted = false) {
  const checks = Object.entries(targetRanges[stage]).map(([k, [min, max]]) => check(k, 'mg/l', totals[k], min, max));
  checks.push(check('n-no3', '% of total N', totals.n > 0 ? totals['n-no3'] / totals.n * 100 : null, 70, null, false));
  checks.push(check('n-nh4', '% of total N', totals.n > 0 ? totals['n-nh4'] / totals.n * 100 : null, null, 30, true, false));
  const deviations = checks.filter(c => c.status === 'below' || c.status === 'above');
  return {
    source: 'Optimale Bereiche für mineralische Düngung in der ' + (stage === 'veg' ? 'vegetativen' : 'generativen') + ' Phase',
    stage, stage_defaulted: stageDefaulted,
    objective: 'Priorität: alle bewertbaren Werte in den Sollbereich bringen. Dosierungen anhand der Abweichungen anpassen und erneut berechnen; Werte im Sollbereich dort halten. Erst danach innerhalb des Sollbereichs ein gewünschtes Referenzverhältnis annähern.',
    all_in_range: checks.every(c => c.status === 'within_range'),
    out_of_range_count: deviations.length, checks, deviations,
    unassessable: checks.filter(c => c.status === 'not_assessable').map(c => c.nutrient),
    unassessed_nutrients: ['n-nu', 'n-org', 'na', 'cl'],
    notes: [
      'Bewertet werden die berechneten Gesamtwerte inklusive des angewendeten Wassers. Fehlende Wasser- oder Katalogwerte sind nicht automatisch als tatsächlich null bekannt; warnings und water.unknown_nutrients beachten.',
      'Die Tabellenbereiche sind Referenzwerte, kein Nachweis eines insgesamt optimalen Düngeschemas. Calcium und Magnesium hängen laut WebUI auch von den anderen Kationen ab; die Tabelle definiert dafür kein festes Verhältnis.',
      'Nitrat muss strikt über 70 %, Ammonium strikt unter 30 % des Gesamtstickstoffs liegen. distance_to_range ist bei Prozentwerten in Prozentpunkten; an einer strikten Grenze ist trotz Abstand 0 eine weitere Anpassung erforderlich.',
    ],
  };
}
