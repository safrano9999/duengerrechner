import { createSchema, createYoga } from 'graphql-yoga';
import { GraphQLScalarType, valueFromASTUntyped, GraphQLError } from 'graphql';
import { core } from './domain.mjs';
const names = core.nutrients.map(k => k.replaceAll('-', '_'));
const nutrientResolvers = Object.fromEntries(core.nutrients.map(k => [k.replaceAll('-', '_'), obj => obj[k] ?? null]));
const schema = createSchema({
  typeDefs: `
    scalar JSON
    type Nutrients { ${names.map(k => `${k}: Float`).join('\n')} }
    type Fertilizer { id: Int!, name: String!, unit: String!, nutrients: Nutrients! }
    type Profile { id: ID!, name: String!, water: JSON!, is_default: Boolean! }
    input ProfileInput { name: String!, water: JSON!, is_default: Boolean }
    input CustomFertilizer { name: String!, unit: String!, nutrients: JSON! }
    input Dose { id: Int, custom: CustomFertilizer, dose: Float!, unit: String }
    enum GrowthStage { veg gen }
    input Mixture { stage: GrowthStage, fertilizers: [Dose!]!, profile_id: ID, use_default_profile: Boolean,
      water: JSON, dilution_percent: Float, volume_l: Float }
    type Contribution { id: Int, name: String!, dose: Float!, unit: String!, amount: Float!, nutrients_mg_l: Nutrients! }
    type Hardness { gh: Float, kh: Float }
    type WaterResult { source: String!, profile_id: ID, name: String, dilution_percent: Float!,
      nutrients_mg_l: Nutrients!, hardness_dh: Hardness!, unknown_nutrients: [String!]! }
    type TargetCheck { nutrient: String!, unit: String!, actual: Float, min: Float, max: Float,
      min_inclusive: Boolean!, max_inclusive: Boolean!, status: String!, distance_to_range: Float, adjustment: String! }
    type TargetAssessment { source: String!, stage: GrowthStage!, stage_defaulted: Boolean!, objective: String!,
      all_in_range: Boolean!, out_of_range_count: Int!, checks: [TargetCheck!]!, deviations: [TargetCheck!]!,
      unassessable: [String!]!, unassessed_nutrients: [String!]!, notes: [String!]! }
    type Calculation { target_assessment: TargetAssessment!, volume_l: Float!, fertilizers: [Contribution!]!, totals_mg_l: Nutrients!,
      nitrogen_percent: Nutrients!, water: WaterResult!, warnings: [String!]! }
    type Query {
      fertilizers(search: String): [Fertilizer!]!
      fertilizer(id: Int!): Fertilizer!
      profiles: [Profile!]!
      profile(id: ID!): Profile!
      calculate(input: Mixture!): Calculation!
      calculateBatch(mixtures: [Mixture!]!): [Calculation!]!
    }
    type Mutation {
      createProfile(input: ProfileInput!): Profile!
      updateProfile(id: ID!, input: ProfileInput!): Profile!
      deleteProfile(id: ID!): Boolean!
    }
  `,
  resolvers: {
    JSON: new GraphQLScalarType({ name: 'JSON', serialize: v => v, parseValue: v => v, parseLiteral: valueFromASTUntyped }),
    Nutrients: nutrientResolvers,
    Fertilizer: { nutrients: v => v },
    Query: {
      fertilizers: (_, { search }, { svc }) => svc.fertilizers(search),
      fertilizer: (_, { id }, { svc }) => svc.fertilizer(id),
      profiles: (_, __, { svc }) => svc.profiles(),
      profile: (_, { id }, { svc }) => svc.profile(id),
      calculate: (_, { input }, { svc }) => svc.calculate(clean(input)),
      calculateBatch: (_, { mixtures }, { svc }) => svc.batch({ mixtures: clean(mixtures) }),
    },
    Mutation: {
      createProfile: (_, { input }, { svc }) => svc.saveProfile(clean(input)),
      updateProfile: (_, { id, input }, { svc }) => svc.saveProfile(clean(input), id),
      deleteProfile: (_, { id }, { svc }) => svc.deleteProfile(id),
    },
  },
});
// GraphQL nullable optional fields map to absent REST fields.
function clean(v) {
  if (Array.isArray(v)) return v.map(clean);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).filter(([, x]) => x !== null).map(([k, x]) => [k, clean(x)]));
  return v;
}
function boundedQuery(context) {
  let fields = 0, depth = 0;
  return { Field: { enter() { fields++; depth++; if (fields > 300 || depth > 12) context.reportError(new GraphQLError('Query exceeds field/depth limit')); }, leave() { depth--; } } };
}
export const yoga = createYoga({
  schema, graphqlEndpoint: '/graphql', graphiql: true,
  context: ({ svc }) => ({ svc }),
  plugins: [{ onValidate({ addValidationRule }) { addValidationRule(boundedQuery); } }],
  maskedErrors: { maskError(error) {
    const e = error.originalError;
    if (e?.status || e?.name === 'ZodError') return new GraphQLError(e.message, { extensions: { code: 'BAD_USER_INPUT' } });
    return e ? new GraphQLError('Internal server error') : error;
  } },
});
