/**
 * R03 — Behavior / Journey Domain Model Tests
 *
 * Covers all 14 required test areas:
 *  1.  Journey creation/validation
 *  2.  JourneyStep validation
 *  3.  ProtectedBehavior creation/validation
 *  4.  Provenance/confidence validation
 *  5.  Duplicate ID detection
 *  6.  Journey registry operations
 *  7.  Protected behavior registry operations
 *  8.  Journey → behavior relationships
 *  9.  Behavior → journey relationships
 * 10.  Invalid references
 * 11.  Deterministic IDs
 * 12.  Deterministic serialization
 * 13.  Serialization round trip
 * 14.  Invalid serialized input
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { BehaviorJourney, BehaviorProtectedBehavior, BehaviorJourneyStep } from '../../engine/behavior/model.js';
import {
  journeyId,
  journeyStepId,
  protectedBehaviorId,
  deterministicId,
} from '../../engine/behavior/ids.js';
import {
  validateJourney,
  validateJourneyStep,
  validateProtectedBehavior,
  validateProvenance,
  VALID_CONFIDENCE_LEVELS,
  VALID_STEP_KINDS,
} from '../../engine/behavior/validation.js';
import { BehaviorRegistry } from '../../engine/behavior/registry.js';
import {
  serializeJourney,
  deserializeJourney,
  serializeProtectedBehavior,
  deserializeProtectedBehavior,
  serializeRegistry,
  deserializeRegistry,
  BEHAVIOR_SCHEMA_VERSION,
} from '../../engine/behavior/serialization.js';
import { EngineError, isEngineError } from '../../engine/errors.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeStep(overrides: Partial<BehaviorJourneyStep> = {}): BehaviorJourneyStep {
  const sequence = overrides.sequence ?? 1;
  const kind = overrides.kind ?? 'http';
  const description = overrides.description ?? 'GET /products';
  return {
    id: journeyStepId('journey-parent', sequence, kind, description),
    sequence,
    kind,
    description,
    ...overrides,
  };
}

function makeJourney(overrides: Partial<BehaviorJourney> = {}): BehaviorJourney {
  const name = overrides.name ?? 'checkout-flow';
  const description = overrides.description ?? 'User adds item to cart and checks out';
  const step = makeStep();
  return {
    id: journeyId(name, description),
    name,
    description,
    steps: [step],
    provenance: { confidence: 'test_derived', sourceKind: 'test', sourceRef: 'test/checkout.test.ts' },
    confidence: 'test_derived',
    ...overrides,
  };
}

function makeBehavior(overrides: Partial<BehaviorProtectedBehavior> = {}): BehaviorProtectedBehavior {
  const description = overrides.description ?? 'Cart total must be correct after discount';
  const observable = overrides.observable ?? 'POST /cart/checkout response body';
  const expectedOutcome = overrides.expectedOutcome ?? 'total equals sum of items minus discount';
  return {
    id: protectedBehaviorId(description, observable, expectedOutcome),
    description,
    observable,
    expectedOutcome,
    provenance: { confidence: 'confirmed', sourceKind: 'developer_declaration' },
    confidence: 'confirmed',
    relatedJourneyIds: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. Journey creation / validation
// ---------------------------------------------------------------------------

describe('Journey creation and validation', () => {
  it('accepts a valid journey', () => {
    const j = makeJourney();
    const result = validateJourney(j);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('rejects a journey with no id', () => {
    const j = makeJourney({ id: '' });
    const result = validateJourney(j);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('.id'))).toBe(true);
  });

  it('rejects a journey with no name', () => {
    const result = validateJourney(makeJourney({ name: '' }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('.name'))).toBe(true);
  });

  it('rejects a journey with no description', () => {
    const result = validateJourney(makeJourney({ description: '' }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('.description'))).toBe(true);
  });

  it('rejects a journey with empty steps array', () => {
    const result = validateJourney(makeJourney({ steps: [] }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('.steps'))).toBe(true);
  });

  it('rejects a journey with non-array steps', () => {
    const result = validateJourney({ ...makeJourney(), steps: 'not-an-array' });
    expect(result.valid).toBe(false);
  });

  it('rejects a journey with non-object input', () => {
    const result = validateJourney('not-an-object');
    expect(result.valid).toBe(false);
  });

  it('rejects a journey with non-contiguous step sequences', () => {
    const s1 = makeStep({ sequence: 1 });
    const s3 = makeStep({ sequence: 3, description: 'skip-seq' });
    const result = validateJourney(makeJourney({ steps: [s1, s3] }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('contiguous'))).toBe(true);
  });

  it('rejects a journey with duplicate step ids', () => {
    const s1 = makeStep({ sequence: 1 });
    const s2: BehaviorJourneyStep = { ...makeStep({ sequence: 2, description: 'other' }), id: s1.id };
    const result = validateJourney(makeJourney({ steps: [s1, s2] }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('duplicate step id'))).toBe(true);
  });

  it('accepts a journey with optional entryPoint, tags, and affectedAreas', () => {
    const j = makeJourney({
      entryPoint: 'POST /checkout',
      tags: ['checkout', 'payment'],
      affectedAreas: ['cart', 'billing'],
    });
    expect(validateJourney(j).valid).toBe(true);
  });

  it('rejects a journey with blank entryPoint', () => {
    const result = validateJourney(makeJourney({ entryPoint: '   ' }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('entryPoint'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. JourneyStep validation
// ---------------------------------------------------------------------------

describe('JourneyStep validation', () => {
  it('accepts a valid step', () => {
    const result = validateJourneyStep(makeStep(), 'step');
    expect(result.valid).toBe(true);
  });

  it('rejects a step with sequence < 1', () => {
    const result = validateJourneyStep(makeStep({ sequence: 0 }), 'step');
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('sequence'))).toBe(true);
  });

  it('rejects a step with non-integer sequence', () => {
    const result = validateJourneyStep(makeStep({ sequence: 1.5 }), 'step');
    expect(result.valid).toBe(false);
  });

  it('rejects a step with an invalid kind', () => {
    const result = validateJourneyStep({ ...makeStep(), kind: 'browser' }, 'step');
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('kind'))).toBe(true);
  });

  it('accepts all valid step kinds', () => {
    for (const kind of VALID_STEP_KINDS) {
      const s = makeStep({ kind });
      expect(validateJourneyStep(s, 'step').valid).toBe(true);
    }
  });

  it('rejects a step with empty description', () => {
    const result = validateJourneyStep(makeStep({ description: '' }), 'step');
    expect(result.valid).toBe(false);
  });

  it('rejects a step with array as input (must be plain object)', () => {
    const result = validateJourneyStep({ ...makeStep(), input: [1, 2] }, 'step');
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('input'))).toBe(true);
  });

  it('accepts a step with no input field', () => {
    const s = makeStep();
    const { input: _removed, ...rest } = s;
    expect(validateJourneyStep(rest, 'step').valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. ProtectedBehavior creation / validation
// ---------------------------------------------------------------------------

describe('ProtectedBehavior creation and validation', () => {
  it('accepts a valid protected behavior', () => {
    const result = validateProtectedBehavior(makeBehavior());
    expect(result.valid).toBe(true);
  });

  it('rejects a behavior with empty id', () => {
    const result = validateProtectedBehavior(makeBehavior({ id: '' }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('.id'))).toBe(true);
  });

  it('rejects a behavior with empty description', () => {
    const result = validateProtectedBehavior(makeBehavior({ description: '' }));
    expect(result.valid).toBe(false);
  });

  it('rejects a behavior with empty observable', () => {
    const result = validateProtectedBehavior(makeBehavior({ observable: '' }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('observable'))).toBe(true);
  });

  it('rejects a behavior with empty expectedOutcome', () => {
    const result = validateProtectedBehavior(makeBehavior({ expectedOutcome: '' }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('expectedOutcome'))).toBe(true);
  });

  it('rejects a behavior with invalid severity', () => {
    const result = validateProtectedBehavior(makeBehavior({ severity: 'extreme' as never }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('severity'))).toBe(true);
  });

  it('accepts all valid severities', () => {
    for (const severity of ['critical', 'high', 'medium', 'low'] as const) {
      expect(validateProtectedBehavior(makeBehavior({ severity })).valid).toBe(true);
    }
  });

  it('rejects a behavior with non-array relatedJourneyIds', () => {
    const result = validateProtectedBehavior({ ...makeBehavior(), relatedJourneyIds: 'bad' });
    expect(result.valid).toBe(false);
  });

  it('accepts a behavior with empty relatedJourneyIds', () => {
    expect(validateProtectedBehavior(makeBehavior({ relatedJourneyIds: [] })).valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4. Provenance / confidence validation
// ---------------------------------------------------------------------------

describe('Provenance and confidence validation', () => {
  it('accepts all valid confidence levels', () => {
    for (const confidence of VALID_CONFIDENCE_LEVELS) {
      const result = validateProvenance({ confidence }, 'ctx');
      expect(result.valid).toBe(true);
    }
  });

  it('rejects an invalid confidence level', () => {
    const result = validateProvenance({ confidence: 'trusted' }, 'ctx');
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('confidence'))).toBe(true);
  });

  it('rejects a missing confidence level', () => {
    const result = validateProvenance({ sourceRef: 'test.ts' }, 'ctx');
    expect(result.valid).toBe(false);
  });

  it('rejects an invalid sourceKind', () => {
    const result = validateProvenance({ confidence: 'inferred', sourceKind: 'magic' }, 'ctx');
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('sourceKind'))).toBe(true);
  });

  it('accepts all valid sourceKinds', () => {
    const validKinds = ['test', 'contract', 'requirement', 'developer_declaration', 'inference'] as const;
    for (const sourceKind of validKinds) {
      const result = validateProvenance({ confidence: 'confirmed', sourceKind }, 'ctx');
      expect(result.valid).toBe(true);
    }
  });

  it('rejects a blank sourceRef string', () => {
    const result = validateProvenance({ confidence: 'inferred', sourceRef: '   ' }, 'ctx');
    expect(result.valid).toBe(false);
  });

  it('accepts provenance with no sourceRef or sourceKind', () => {
    const result = validateProvenance({ confidence: 'inferred' }, 'ctx');
    expect(result.valid).toBe(true);
  });

  it('does not treat inferred as confirmed', () => {
    // The model preserves confidence as-is — no silent upgrade
    const b = makeBehavior({ confidence: 'inferred', provenance: { confidence: 'inferred' } });
    expect(b.confidence).toBe('inferred');
    expect(b.provenance.confidence).toBe('inferred');
  });
});

// ---------------------------------------------------------------------------
// 5. Duplicate ID detection
// ---------------------------------------------------------------------------

describe('Duplicate ID detection', () => {
  it('throws BEHAVIOR_DUPLICATE_ID when registering a journey with an existing id', () => {
    const registry = new BehaviorRegistry();
    const j = makeJourney();
    registry.registerJourney(j);
    expect(() => registry.registerJourney(j)).toThrow(EngineError);
    try {
      registry.registerJourney(j);
    } catch (e) {
      expect(isEngineError(e, 'BEHAVIOR_DUPLICATE_ID')).toBe(true);
    }
  });

  it('throws BEHAVIOR_DUPLICATE_ID when registering a protected behavior with an existing id', () => {
    const registry = new BehaviorRegistry();
    const b = makeBehavior();
    registry.registerProtectedBehavior(b);
    expect(() => registry.registerProtectedBehavior(b)).toThrow(EngineError);
    try {
      registry.registerProtectedBehavior(b);
    } catch (e) {
      expect(isEngineError(e, 'BEHAVIOR_DUPLICATE_ID')).toBe(true);
    }
  });

  it('allows two journeys with different ids (same name, different description)', () => {
    const registry = new BehaviorRegistry();
    const j1 = makeJourney({ description: 'version one' });
    const j2 = makeJourney({ description: 'version two' });
    expect(j1.id).not.toBe(j2.id);
    expect(() => {
      registry.registerJourney(j1);
      registry.registerJourney(j2);
    }).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 6. Journey registry operations
// ---------------------------------------------------------------------------

describe('Journey registry operations', () => {
  let registry: BehaviorRegistry;

  beforeEach(() => {
    registry = new BehaviorRegistry();
  });

  it('registers and retrieves a journey by id', () => {
    const j = makeJourney();
    registry.registerJourney(j);
    expect(registry.getJourney(j.id)).toEqual(j);
  });

  it('returns undefined for an unknown journey id', () => {
    expect(registry.getJourney('nonexistent')).toBeUndefined();
  });

  it('lists all journeys sorted by id', () => {
    const j1 = makeJourney({ name: 'alpha', description: 'a' });
    const j2 = makeJourney({ name: 'beta', description: 'b' });
    const j3 = makeJourney({ name: 'gamma', description: 'c' });
    registry.registerJourney(j3);
    registry.registerJourney(j1);
    registry.registerJourney(j2);
    const listed = registry.listJourneys();
    expect(listed).toHaveLength(3);
    const ids = listed.map((j) => j.id);
    expect(ids).toEqual([...ids].sort());
  });

  it('returns an empty list when no journeys are registered', () => {
    expect(registry.listJourneys()).toHaveLength(0);
  });

  it('finds journeys by affected area', () => {
    const j1 = makeJourney({ name: 'cart-flow', description: 'd1', affectedAreas: ['cart', 'billing'] });
    const j2 = makeJourney({ name: 'login-flow', description: 'd2', affectedAreas: ['auth'] });
    registry.registerJourney(j1);
    registry.registerJourney(j2);
    const cartJourneys = registry.findJourneysForArea('cart');
    expect(cartJourneys).toHaveLength(1);
    expect(cartJourneys[0].id).toBe(j1.id);
  });

  it('returns empty array when no journeys match the area', () => {
    registry.registerJourney(makeJourney({ affectedAreas: ['cart'] }));
    expect(registry.findJourneysForArea('payments')).toHaveLength(0);
  });

  it('throws BEHAVIOR_INVALID when registering an invalid journey', () => {
    const bad = makeJourney({ steps: [] });
    expect(() => registry.registerJourney(bad)).toThrow(EngineError);
    try {
      registry.registerJourney(bad);
    } catch (e) {
      expect(isEngineError(e, 'BEHAVIOR_INVALID')).toBe(true);
    }
  });

  it('journeyCount reflects registrations', () => {
    expect(registry.journeyCount()).toBe(0);
    registry.registerJourney(makeJourney({ name: 'a', description: 'x' }));
    expect(registry.journeyCount()).toBe(1);
    registry.registerJourney(makeJourney({ name: 'b', description: 'y' }));
    expect(registry.journeyCount()).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 7. Protected behavior registry operations
// ---------------------------------------------------------------------------

describe('Protected behavior registry operations', () => {
  let registry: BehaviorRegistry;

  beforeEach(() => {
    registry = new BehaviorRegistry();
  });

  it('registers and retrieves a behavior by id', () => {
    const b = makeBehavior();
    registry.registerProtectedBehavior(b);
    expect(registry.getProtectedBehavior(b.id)).toEqual(b);
  });

  it('returns undefined for an unknown behavior id', () => {
    expect(registry.getProtectedBehavior('nonexistent')).toBeUndefined();
  });

  it('lists all behaviors sorted by id', () => {
    const b1 = makeBehavior({ description: 'a', observable: 'o1', expectedOutcome: 'e1' });
    const b2 = makeBehavior({ description: 'b', observable: 'o2', expectedOutcome: 'e2' });
    const b3 = makeBehavior({ description: 'c', observable: 'o3', expectedOutcome: 'e3' });
    registry.registerProtectedBehavior(b3);
    registry.registerProtectedBehavior(b1);
    registry.registerProtectedBehavior(b2);
    const listed = registry.listProtectedBehaviors();
    expect(listed).toHaveLength(3);
    const ids = listed.map((b) => b.id);
    expect(ids).toEqual([...ids].sort());
  });

  it('throws BEHAVIOR_INVALID when registering an invalid behavior', () => {
    const bad = makeBehavior({ observable: '' });
    expect(() => registry.registerProtectedBehavior(bad)).toThrow(EngineError);
    try {
      registry.registerProtectedBehavior(bad);
    } catch (e) {
      expect(isEngineError(e, 'BEHAVIOR_INVALID')).toBe(true);
    }
  });

  it('behaviorCount reflects registrations', () => {
    expect(registry.behaviorCount()).toBe(0);
    registry.registerProtectedBehavior(makeBehavior());
    expect(registry.behaviorCount()).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 8. Journey → behavior relationships
// ---------------------------------------------------------------------------

describe('Journey to behavior relationships', () => {
  let registry: BehaviorRegistry;
  let journey: BehaviorJourney;
  let behavior: BehaviorProtectedBehavior;

  beforeEach(() => {
    registry = new BehaviorRegistry();
    journey = makeJourney({ name: 'checkout', description: 'checkout journey' });
    behavior = makeBehavior({ relatedJourneyIds: [journey.id] });
    registry.registerJourney(journey);
    registry.registerProtectedBehavior(behavior);
  });

  it('findBehaviorsForJourney returns behaviors that reference the journey', () => {
    const found = registry.findBehaviorsForJourney(journey.id);
    expect(found).toHaveLength(1);
    expect(found[0].id).toBe(behavior.id);
  });

  it('findBehaviorsForJourney returns empty array for a journey with no behaviors', () => {
    const unrelatedJourney = makeJourney({ name: 'other', description: 'unrelated' });
    registry.registerJourney(unrelatedJourney);
    expect(registry.findBehaviorsForJourney(unrelatedJourney.id)).toHaveLength(0);
  });

  it('findBehaviorsForJourney works even if the journey is not in the registry', () => {
    // The registry does not require the journey to be registered for this direction
    const found = registry.findBehaviorsForJourney('phantom-journey-id');
    expect(found).toHaveLength(0);
  });

  it('a behavior can relate to multiple journeys', () => {
    const j2 = makeJourney({ name: 'repurchase', description: 'repeat purchase' });
    registry.registerJourney(j2);
    const multiB = makeBehavior({
      description: 'multi-journey behavior',
      observable: 'response',
      expectedOutcome: 'success',
      relatedJourneyIds: [journey.id, j2.id],
    });
    registry.registerProtectedBehavior(multiB);
    expect(registry.findBehaviorsForJourney(journey.id).some((b) => b.id === multiB.id)).toBe(true);
    expect(registry.findBehaviorsForJourney(j2.id).some((b) => b.id === multiB.id)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 9. Behavior → journey relationships
// ---------------------------------------------------------------------------

describe('Behavior to journey relationships', () => {
  let registry: BehaviorRegistry;
  let journey: BehaviorJourney;
  let behavior: BehaviorProtectedBehavior;

  beforeEach(() => {
    registry = new BehaviorRegistry();
    journey = makeJourney({ name: 'checkout', description: 'checkout journey' });
    behavior = makeBehavior({ relatedJourneyIds: [journey.id] });
    registry.registerJourney(journey);
    registry.registerProtectedBehavior(behavior);
  });

  it('findJourneysForBehavior returns the related journeys', () => {
    const found = registry.findJourneysForBehavior(behavior.id);
    expect(found).toHaveLength(1);
    expect(found[0].id).toBe(journey.id);
  });

  it('findJourneysForBehavior returns empty for a behavior with no relatedJourneyIds', () => {
    const isolatedB = makeBehavior({
      description: 'isolated',
      observable: 'nothing',
      expectedOutcome: 'nothing changes',
      relatedJourneyIds: [],
    });
    registry.registerProtectedBehavior(isolatedB);
    expect(registry.findJourneysForBehavior(isolatedB.id)).toHaveLength(0);
  });

  it('findJourneysForBehavior result is sorted by id', () => {
    const j2 = makeJourney({ name: 'billing', description: 'billing journey' });
    registry.registerJourney(j2);
    const multiB = makeBehavior({
      description: 'billing and checkout',
      observable: 'both endpoints',
      expectedOutcome: '200',
      relatedJourneyIds: [journey.id, j2.id],
    });
    registry.registerProtectedBehavior(multiB);
    const found = registry.findJourneysForBehavior(multiB.id);
    const ids = found.map((j) => j.id);
    expect(ids).toEqual([...ids].sort());
  });
});

// ---------------------------------------------------------------------------
// 10. Invalid references
// ---------------------------------------------------------------------------

describe('Invalid references', () => {
  let registry: BehaviorRegistry;

  beforeEach(() => {
    registry = new BehaviorRegistry();
  });

  it('findJourneysForBehavior throws BEHAVIOR_UNKNOWN_REFERENCE for an unregistered behavior id', () => {
    expect(() => registry.findJourneysForBehavior('nonexistent')).toThrow(EngineError);
    try {
      registry.findJourneysForBehavior('nonexistent');
    } catch (e) {
      expect(isEngineError(e, 'BEHAVIOR_UNKNOWN_REFERENCE')).toBe(true);
    }
  });

  it('findJourneysForBehavior throws BEHAVIOR_UNKNOWN_REFERENCE when relatedJourneyIds references an unregistered journey', () => {
    const b = makeBehavior({ relatedJourneyIds: ['journey-does-not-exist'] });
    registry.registerProtectedBehavior(b);
    expect(() => registry.findJourneysForBehavior(b.id)).toThrow(EngineError);
    try {
      registry.findJourneysForBehavior(b.id);
    } catch (e) {
      expect(isEngineError(e, 'BEHAVIOR_UNKNOWN_REFERENCE')).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// 11. Deterministic IDs
// ---------------------------------------------------------------------------

describe('Deterministic IDs', () => {
  it('journeyId produces the same id for identical inputs', () => {
    const id1 = journeyId('checkout', 'user checks out cart');
    const id2 = journeyId('checkout', 'user checks out cart');
    expect(id1).toBe(id2);
  });

  it('journeyId produces a different id when name differs', () => {
    const id1 = journeyId('checkout', 'user checks out cart');
    const id2 = journeyId('checkout-v2', 'user checks out cart');
    expect(id1).not.toBe(id2);
  });

  it('journeyId produces a different id when description differs', () => {
    const id1 = journeyId('checkout', 'user checks out cart');
    const id2 = journeyId('checkout', 'user completes purchase');
    expect(id1).not.toBe(id2);
  });

  it('journeyId includes entryPoint in hash when provided', () => {
    const withEP = journeyId('checkout', 'user checks out cart', 'POST /checkout');
    const withoutEP = journeyId('checkout', 'user checks out cart');
    expect(withEP).not.toBe(withoutEP);
  });

  it('journeyId is stable across calls (prefix is "journey-")', () => {
    expect(journeyId('a', 'b')).toMatch(/^journey-[0-9a-f]{16}$/);
  });

  it('journeyStepId produces the same id for identical inputs', () => {
    const id1 = journeyStepId('journey-abc', 1, 'http', 'GET /products');
    const id2 = journeyStepId('journey-abc', 1, 'http', 'GET /products');
    expect(id1).toBe(id2);
  });

  it('journeyStepId distinguishes same description at different sequences', () => {
    const id1 = journeyStepId('journey-abc', 1, 'http', 'GET /products');
    const id2 = journeyStepId('journey-abc', 2, 'http', 'GET /products');
    expect(id1).not.toBe(id2);
  });

  it('protectedBehaviorId produces the same id for identical inputs', () => {
    const id1 = protectedBehaviorId('cart total must be correct', 'POST /checkout body', 'total is correct');
    const id2 = protectedBehaviorId('cart total must be correct', 'POST /checkout body', 'total is correct');
    expect(id1).toBe(id2);
  });

  it('protectedBehaviorId is stable (prefix is "behavior-")', () => {
    expect(protectedBehaviorId('a', 'b', 'c')).toMatch(/^behavior-[0-9a-f]{16}$/);
  });

  it('deterministicId is case-insensitive and trims whitespace', () => {
    const id1 = deterministicId(['Hello', 'World']);
    const id2 = deterministicId(['hello', 'world']);
    const id3 = deterministicId(['  hello  ', ' world ']);
    expect(id1).toBe(id2);
    expect(id1).toBe(id3);
  });
});

// ---------------------------------------------------------------------------
// 12. Deterministic serialization
// ---------------------------------------------------------------------------

describe('Deterministic serialization', () => {
  it('serializeJourney produces identical output for identical input', () => {
    const j = makeJourney();
    expect(serializeJourney(j)).toBe(serializeJourney(j));
  });

  it('serializeJourney includes the schema version', () => {
    const j = makeJourney();
    const out = JSON.parse(serializeJourney(j)) as Record<string, unknown>;
    expect(out['schemaVersion']).toBe(BEHAVIOR_SCHEMA_VERSION);
  });

  it('serializeJourney sorts steps by sequence', () => {
    const s1 = makeStep({ sequence: 1, description: 'first' });
    const s2 = makeStep({ sequence: 2, description: 'second' });
    // Register in reverse order
    const j = makeJourney({ steps: [s2, s1] });
    const out = JSON.parse(serializeJourney(j)) as { journey: BehaviorJourney };
    expect(out.journey.steps[0].sequence).toBe(1);
    expect(out.journey.steps[1].sequence).toBe(2);
  });

  it('serializeJourney sorts tags alphabetically', () => {
    const j = makeJourney({ tags: ['z-tag', 'a-tag', 'm-tag'] });
    const out = JSON.parse(serializeJourney(j)) as { journey: BehaviorJourney };
    expect(out.journey.tags).toEqual(['a-tag', 'm-tag', 'z-tag']);
  });

  it('serializeProtectedBehavior sorts relatedJourneyIds', () => {
    const b = makeBehavior({ relatedJourneyIds: ['journey-z', 'journey-a', 'journey-m'] });
    const out = JSON.parse(serializeProtectedBehavior(b)) as { behavior: BehaviorProtectedBehavior };
    expect(out.behavior.relatedJourneyIds).toEqual(['journey-a', 'journey-m', 'journey-z']);
  });

  it('serializeRegistry produces identical output for identical snapshots', () => {
    const j = makeJourney();
    const b = makeBehavior({ relatedJourneyIds: [j.id] });
    const snap = { journeys: [j], behaviors: [b] };
    expect(serializeRegistry(snap)).toBe(serializeRegistry(snap));
  });

  it('serializeRegistry sorts journeys by id', () => {
    const j1 = makeJourney({ name: 'alpha', description: 'a' });
    const j2 = makeJourney({ name: 'beta', description: 'b' });
    // Register in reverse id order (ids are content-hashes, unpredictable, so sort and pick)
    const allJ = [j1, j2].sort((a, b) => b.id.localeCompare(a.id)); // reverse sort
    const snap = { journeys: allJ, behaviors: [] };
    const out = JSON.parse(serializeRegistry(snap)) as { journeys: BehaviorJourney[] };
    const ids = out.journeys.map((j) => j.id);
    expect(ids).toEqual([...ids].sort());
  });
});

// ---------------------------------------------------------------------------
// 13. Serialization round trip
// ---------------------------------------------------------------------------

describe('Serialization round trip', () => {
  it('journey round trips through serialize/deserialize', () => {
    const j = makeJourney({
      entryPoint: 'POST /checkout',
      tags: ['checkout'],
      affectedAreas: ['cart'],
    });
    const serialized = serializeJourney(j);
    const deserialized = deserializeJourney(serialized);
    // Semantically equivalent (field order may differ in JSON objects, deep equal checks values)
    expect(deserialized.id).toBe(j.id);
    expect(deserialized.name).toBe(j.name);
    expect(deserialized.description).toBe(j.description);
    expect(deserialized.steps).toHaveLength(j.steps.length);
    expect(deserialized.confidence).toBe(j.confidence);
  });

  it('protectedBehavior round trips through serialize/deserialize', () => {
    const b = makeBehavior({ relatedJourneyIds: ['journey-abc'], severity: 'high' });
    const serialized = serializeProtectedBehavior(b);
    const deserialized = deserializeProtectedBehavior(serialized);
    expect(deserialized.id).toBe(b.id);
    expect(deserialized.description).toBe(b.description);
    expect(deserialized.observable).toBe(b.observable);
    expect(deserialized.expectedOutcome).toBe(b.expectedOutcome);
    expect(deserialized.severity).toBe('high');
    expect(deserialized.relatedJourneyIds).toEqual(['journey-abc']);
  });

  it('registry round trips through serializeRegistry/deserializeRegistry', () => {
    const j = makeJourney();
    const b = makeBehavior({ relatedJourneyIds: [j.id] });
    const snap = { journeys: [j], behaviors: [b] };
    const serialized = serializeRegistry(snap);
    const deserialized = deserializeRegistry(serialized);
    expect(deserialized.journeys).toHaveLength(1);
    expect(deserialized.journeys[0].id).toBe(j.id);
    expect(deserialized.behaviors).toHaveLength(1);
    expect(deserialized.behaviors[0].id).toBe(b.id);
  });

  it('registry snapshot from registry instance round trips', () => {
    const registry = new BehaviorRegistry();
    const j = makeJourney();
    const b = makeBehavior({ relatedJourneyIds: [j.id] });
    registry.registerJourney(j);
    registry.registerProtectedBehavior(b);

    const snap = registry.snapshot();
    const serialized = serializeRegistry(snap);
    const { journeys, behaviors } = deserializeRegistry(serialized);

    const restoredRegistry = new BehaviorRegistry();
    for (const journey of journeys) restoredRegistry.registerJourney(journey);
    for (const behavior of behaviors) restoredRegistry.registerProtectedBehavior(behavior);

    expect(restoredRegistry.journeyCount()).toBe(1);
    expect(restoredRegistry.behaviorCount()).toBe(1);
    expect(restoredRegistry.getJourney(j.id)?.id).toBe(j.id);
  });
});

// ---------------------------------------------------------------------------
// 14. Invalid serialized input
// ---------------------------------------------------------------------------

describe('Invalid serialized input', () => {
  it('deserializeJourney throws BEHAVIOR_DESERIALIZATION_FAILED for invalid JSON', () => {
    expect(() => deserializeJourney('not-json{')).toThrow(EngineError);
    try {
      deserializeJourney('not-json{');
    } catch (e) {
      expect(isEngineError(e, 'BEHAVIOR_DESERIALIZATION_FAILED')).toBe(true);
    }
  });

  it('deserializeJourney throws BEHAVIOR_DESERIALIZATION_FAILED for wrong schema version', () => {
    const j = makeJourney();
    const raw = JSON.stringify({ schemaVersion: '99.0', journey: j });
    expect(() => deserializeJourney(raw)).toThrow(EngineError);
    try {
      deserializeJourney(raw);
    } catch (e) {
      expect(isEngineError(e, 'BEHAVIOR_DESERIALIZATION_FAILED')).toBe(true);
    }
  });

  it('deserializeJourney throws BEHAVIOR_DESERIALIZATION_FAILED for a journey that fails validation', () => {
    const j = makeJourney();
    const raw = JSON.stringify({
      schemaVersion: BEHAVIOR_SCHEMA_VERSION,
      journey: { ...j, steps: [] }, // invalid: empty steps
    });
    expect(() => deserializeJourney(raw)).toThrow(EngineError);
    try {
      deserializeJourney(raw);
    } catch (e) {
      expect(isEngineError(e, 'BEHAVIOR_DESERIALIZATION_FAILED')).toBe(true);
    }
  });

  it('deserializeJourney throws BEHAVIOR_DESERIALIZATION_FAILED when input is an array', () => {
    expect(() => deserializeJourney('[]')).toThrow(EngineError);
    try {
      deserializeJourney('[]');
    } catch (e) {
      expect(isEngineError(e, 'BEHAVIOR_DESERIALIZATION_FAILED')).toBe(true);
    }
  });

  it('deserializeProtectedBehavior throws BEHAVIOR_DESERIALIZATION_FAILED for invalid JSON', () => {
    expect(() => deserializeProtectedBehavior('{bad json')).toThrow(EngineError);
    try {
      deserializeProtectedBehavior('{bad json');
    } catch (e) {
      expect(isEngineError(e, 'BEHAVIOR_DESERIALIZATION_FAILED')).toBe(true);
    }
  });

  it('deserializeProtectedBehavior throws BEHAVIOR_DESERIALIZATION_FAILED for wrong schema version', () => {
    const b = makeBehavior();
    const raw = JSON.stringify({ schemaVersion: '0.1', behavior: b });
    expect(() => deserializeProtectedBehavior(raw)).toThrow(EngineError);
  });

  it('deserializeProtectedBehavior throws BEHAVIOR_DESERIALIZATION_FAILED for a behavior that fails validation', () => {
    const b = makeBehavior();
    const raw = JSON.stringify({
      schemaVersion: BEHAVIOR_SCHEMA_VERSION,
      behavior: { ...b, observable: '' }, // invalid
    });
    expect(() => deserializeProtectedBehavior(raw)).toThrow(EngineError);
    try {
      deserializeProtectedBehavior(raw);
    } catch (e) {
      expect(isEngineError(e, 'BEHAVIOR_DESERIALIZATION_FAILED')).toBe(true);
    }
  });

  it('deserializeRegistry throws BEHAVIOR_DESERIALIZATION_FAILED for missing journeys array', () => {
    const raw = JSON.stringify({ schemaVersion: BEHAVIOR_SCHEMA_VERSION, behaviors: [] });
    expect(() => deserializeRegistry(raw)).toThrow(EngineError);
    try {
      deserializeRegistry(raw);
    } catch (e) {
      expect(isEngineError(e, 'BEHAVIOR_DESERIALIZATION_FAILED')).toBe(true);
    }
  });

  it('deserializeRegistry throws BEHAVIOR_DESERIALIZATION_FAILED for invalid journey in array', () => {
    const j = makeJourney();
    const raw = JSON.stringify({
      schemaVersion: BEHAVIOR_SCHEMA_VERSION,
      journeys: [{ ...j, name: '' }], // invalid name
      behaviors: [],
    });
    expect(() => deserializeRegistry(raw)).toThrow(EngineError);
    try {
      deserializeRegistry(raw);
    } catch (e) {
      expect(isEngineError(e, 'BEHAVIOR_DESERIALIZATION_FAILED')).toBe(true);
    }
  });

  it('deserializeRegistry throws BEHAVIOR_DESERIALIZATION_FAILED for invalid behavior in array', () => {
    const j = makeJourney();
    const b = makeBehavior();
    const raw = JSON.stringify({
      schemaVersion: BEHAVIOR_SCHEMA_VERSION,
      journeys: [j],
      behaviors: [{ ...b, confidence: 'very_sure' }], // invalid confidence
    });
    expect(() => deserializeRegistry(raw)).toThrow(EngineError);
    try {
      deserializeRegistry(raw);
    } catch (e) {
      expect(isEngineError(e, 'BEHAVIOR_DESERIALIZATION_FAILED')).toBe(true);
    }
  });
});
