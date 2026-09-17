import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  CycleDetectedError,
  InvalidRecipeItemError,
  RecipeNotFoundError,
  ZeroDivisorError,
  RecipeEngine,
  explodeIngredients,
  calculateRecipeCost,
  formatDecimal12x4,
  parseDecimal12x4,
  multiplyScale4,
  divideScale4,
  addScale4,
  subtractScale4,
  type Recipe,
  type RecipeItem,
  type ModifierRecipeResolver,
} from './index.js';

describe('@trident/inventory - Numerics (INV-12, INV-13)', () => {
  it('INV-12: parses and formats 4-decimal fixed point numbers without float drift', () => {
    assert.equal(parseDecimal12x4('0.0000'), 0n);
    assert.equal(parseDecimal12x4('1.0000'), 10000n);
    assert.equal(parseDecimal12x4('12.3456'), 123456n);
    assert.equal(parseDecimal12x4('-5.5000'), -55000n);
    assert.equal(formatDecimal12x4(0n), '0.0000');
    assert.equal(formatDecimal12x4(10000n), '1.0000');
    assert.equal(formatDecimal12x4(123456n), '12.3456');
    assert.equal(formatDecimal12x4(-55000n), '-5.5000');
  });

  it('performs scale-4 multiplication with half-away-from-zero rounding', () => {
    // 2.5000 * 3.0000 = 7.5000
    const a = parseDecimal12x4('2.5000');
    const b = parseDecimal12x4('3.0000');
    assert.equal(formatDecimal12x4(multiplyScale4(a, b)), '7.5000');

    // 0.3333 * 3.0000 = 0.9999
    assert.equal(
      formatDecimal12x4(multiplyScale4(parseDecimal12x4('0.3333'), parseDecimal12x4('3.0000'))),
      '0.9999',
    );
  });

  it('performs scale-4 division with half-away-from-zero rounding', () => {
    // 10.0000 / 4.0000 = 2.5000
    const a = parseDecimal12x4('10.0000');
    const b = parseDecimal12x4('4.0000');
    assert.equal(formatDecimal12x4(divideScale4(a, b)), '2.5000');

    // 1.0000 / 3.0000 = 0.3333
    assert.equal(
      formatDecimal12x4(divideScale4(parseDecimal12x4('1.0000'), parseDecimal12x4('3.0000'))),
      '0.3333',
    );

    // Division by zero throws
    assert.throws(() => divideScale4(10000n, 0n), RangeError);
  });

  it('performs scale-4 addition and subtraction with boundary checks', () => {
    const a = parseDecimal12x4('10.5000');
    const b = parseDecimal12x4('4.2500');
    assert.equal(formatDecimal12x4(addScale4(a, b)), '14.7500');
    assert.equal(formatDecimal12x4(subtractScale4(a, b)), '6.2500');
  });

  it('INV-13: enforces fail-closed regex ^-?\\d+\\.\\d{4}$ rejecting non-4-decimal strings', () => {
    // Non-canonical scale inputs strictly rejected
    assert.throws(() => parseDecimal12x4('1'), RangeError);
    assert.throws(() => parseDecimal12x4('1.2'), RangeError);
    assert.throws(() => parseDecimal12x4('1.23'), RangeError);
    assert.throws(() => parseDecimal12x4('1.234'), RangeError);
    assert.throws(() => parseDecimal12x4('1.23456'), RangeError);
    assert.throws(() => parseDecimal12x4(''), RangeError);
    assert.throws(() => parseDecimal12x4('   '), RangeError);
    assert.throws(() => parseDecimal12x4('abc'), RangeError);
    assert.throws(() => parseDecimal12x4('.1234'), RangeError);
    assert.throws(() => parseDecimal12x4('1234.'), RangeError);
    assert.throws(() => parseDecimal12x4('NaN'), RangeError);
  });

  it('enforces DECIMAL(12,4) exact boundary limits [-99999999.9999, +99999999.9999]', () => {
    // Maximum valid values
    assert.equal(parseDecimal12x4('99999999.9999'), 999999999999n);
    assert.equal(formatDecimal12x4(999999999999n), '99999999.9999');

    // Minimum valid values
    assert.equal(parseDecimal12x4('-99999999.9999'), -999999999999n);
    assert.equal(formatDecimal12x4(-999999999999n), '-99999999.9999');

    // Values exceeding DECIMAL(12,4) upper bound throw RangeError
    assert.throws(() => parseDecimal12x4('100000000.0000'), RangeError);
    assert.throws(() => formatDecimal12x4(1000000000000n), RangeError);

    // Values exceeding DECIMAL(12,4) lower bound throw RangeError
    assert.throws(() => parseDecimal12x4('-100000000.0000'), RangeError);
    assert.throws(() => formatDecimal12x4(-1000000000000n), RangeError);
  });
});

describe('@trident/inventory - RecipeEngine.explodeIngredients (INV-01 .. INV-08)', () => {
  const orgId = '00000000-0000-0000-0000-000000000001';

  it('INV-01: explodes a single-level recipe into raw ingredients', async () => {
    const recipe: Recipe = {
      id: 'rec-burger',
      organizationId: orgId,
      productId: null,
      code: 'REC-001',
      name: 'Burger',
      yieldQuantity: '1.0000',
      yieldUnit: 'PZ',
      totalCost: '0.0000',
      isActive: true,
      items: [
        {
          id: 'item-1',
          organizationId: orgId,
          recipeId: 'rec-burger',
          ingredientId: 'ing-meat',
          subRecipeId: null,
          quantity: '0.2000',
          grossQuantity: '0.2200',
          unitCostSnapshot: '50.0000',
          createdAt: new Date().toISOString(),
        },
        {
          id: 'item-2',
          organizationId: orgId,
          recipeId: 'rec-burger',
          ingredientId: 'ing-bun',
          subRecipeId: null,
          quantity: '1.0000',
          grossQuantity: '1.0000',
          unitCostSnapshot: '5.0000',
          createdAt: new Date().toISOString(),
        },
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const result = await RecipeEngine.explodeIngredients(recipe, () => null);
    const fnResult = await explodeIngredients(recipe, () => null);

    assert.equal(result.length, 2);
    assert.deepEqual(result, [
      {
        ingredientId: 'ing-bun',
        totalQuantity: '1.0000',
        totalGrossQuantity: '1.0000',
      },
      {
        ingredientId: 'ing-meat',
        totalQuantity: '0.2000',
        totalGrossQuantity: '0.2200',
      },
    ]);
    assert.deepEqual(fnResult, result);
  });

  it('INV-02 & INV-07: explodes nested subrecipes with proportional yield scaling', async () => {
    // Subrecipe: Pizza Sauce (Yield = 2.0000 LT)
    // Ingredients: Tomato (1.0000 KG), Oregano (0.0500 KG)
    const sauceSubRecipe: Recipe = {
      id: 'rec-sauce',
      organizationId: orgId,
      productId: null,
      code: 'REC-SAUCE',
      name: 'Pizza Sauce Batch',
      yieldQuantity: '2.0000',
      yieldUnit: 'LT',
      totalCost: '0.0000',
      isActive: true,
      items: [
        {
          id: 's-item-1',
          organizationId: orgId,
          recipeId: 'rec-sauce',
          ingredientId: 'ing-tomato',
          subRecipeId: null,
          quantity: '1.0000',
          grossQuantity: '1.1000',
          unitCostSnapshot: '10.0000',
          createdAt: new Date().toISOString(),
        },
        {
          id: 's-item-2',
          organizationId: orgId,
          recipeId: 'rec-sauce',
          ingredientId: 'ing-oregano',
          subRecipeId: null,
          quantity: '0.0500',
          grossQuantity: '0.0500',
          unitCostSnapshot: '40.0000',
          createdAt: new Date().toISOString(),
        },
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // Parent Recipe: 1 Pizza uses 0.2000 LT of Pizza Sauce, plus Cheese (0.1500 KG)
    // Pizza Sauce yield is 2.0 LT. Consuming 0.2000 LT means multiplier is 0.2000 / 2.0000 = 0.1000 factor.
    // Tomato in Pizza: 0.1000 * 1.0000 = 0.1000 net, 0.1000 * 1.1000 = 0.1100 gross.
    // Oregano in Pizza: 0.1000 * 0.0500 = 0.0050 net, 0.1000 * 0.0500 = 0.0050 gross.
    const pizzaRecipe: Recipe = {
      id: 'rec-pizza',
      organizationId: orgId,
      productId: null,
      code: 'REC-PIZZA',
      name: 'Cheese Pizza',
      yieldQuantity: '1.0000',
      yieldUnit: 'PZ',
      totalCost: '0.0000',
      isActive: true,
      items: [
        {
          id: 'p-item-1',
          organizationId: orgId,
          recipeId: 'rec-pizza',
          ingredientId: null,
          subRecipeId: 'rec-sauce',
          quantity: '0.2000',
          grossQuantity: '0.2000',
          unitCostSnapshot: '0.0000',
          createdAt: new Date().toISOString(),
        },
        {
          id: 'p-item-2',
          organizationId: orgId,
          recipeId: 'rec-pizza',
          ingredientId: 'ing-cheese',
          subRecipeId: null,
          quantity: '0.1500',
          grossQuantity: '0.1500',
          unitCostSnapshot: '30.0000',
          createdAt: new Date().toISOString(),
        },
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const resolver = (id: string) => (id === 'rec-sauce' ? sauceSubRecipe : null);

    const exploded = await RecipeEngine.explodeIngredients(pizzaRecipe, resolver);

    assert.equal(exploded.length, 3);
    assert.deepEqual(exploded, [
      {
        ingredientId: 'ing-cheese',
        totalQuantity: '0.1500',
        totalGrossQuantity: '0.1500',
      },
      {
        ingredientId: 'ing-oregano',
        totalQuantity: '0.0050',
        totalGrossQuantity: '0.0050',
      },
      {
        ingredientId: 'ing-tomato',
        totalQuantity: '0.1000',
        totalGrossQuantity: '0.1100',
      },
    ]);
  });

  it('INV-03: explodes multi-level nested subrecipes (Level 3 -> Level 2 -> Level 1 -> Raw)', async () => {
    // Level 1: Dough (Yield = 10.0000 KG) -> Flour (6.0000 KG), Water (4.0000 LT), Yeast (0.1000 KG)
    const doughRecipe: Recipe = {
      id: 'rec-dough',
      organizationId: orgId,
      productId: null,
      code: 'DOUGH',
      name: 'Dough Batch',
      yieldQuantity: '10.0000',
      yieldUnit: 'KG',
      totalCost: '0.0000',
      isActive: true,
      items: [
        {
          id: 'd1',
          organizationId: orgId,
          recipeId: 'rec-dough',
          ingredientId: 'ing-flour',
          subRecipeId: null,
          quantity: '6.0000',
          grossQuantity: '6.0000',
          unitCostSnapshot: '1.0000',
          createdAt: new Date().toISOString(),
        },
        {
          id: 'd2',
          organizationId: orgId,
          recipeId: 'rec-dough',
          ingredientId: 'ing-water',
          subRecipeId: null,
          quantity: '4.0000',
          grossQuantity: '4.0000',
          unitCostSnapshot: '0.0000',
          createdAt: new Date().toISOString(),
        },
        {
          id: 'd3',
          organizationId: orgId,
          recipeId: 'rec-dough',
          ingredientId: 'ing-yeast',
          subRecipeId: null,
          quantity: '0.1000',
          grossQuantity: '0.1000',
          unitCostSnapshot: '5.0000',
          createdAt: new Date().toISOString(),
        },
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // Level 2: Pizza Base (Yield = 5.0000 PZ) -> Consumes 2.5000 KG Dough (Factor = 2.5/10 = 0.25)
    // 0.25 * Flour(6) = 1.5000 Flour
    // 0.25 * Water(4) = 1.0000 Water
    // 0.25 * Yeast(0.1) = 0.0250 Yeast
    // Plus Olive Oil (0.0500 LT)
    const baseRecipe: Recipe = {
      id: 'rec-base',
      organizationId: orgId,
      productId: null,
      code: 'BASE',
      name: 'Pizza Base Batch',
      yieldQuantity: '5.0000',
      yieldUnit: 'PZ',
      totalCost: '0.0000',
      isActive: true,
      items: [
        {
          id: 'b1',
          organizationId: orgId,
          recipeId: 'rec-base',
          ingredientId: null,
          subRecipeId: 'rec-dough',
          quantity: '2.5000',
          grossQuantity: '2.5000',
          unitCostSnapshot: '0.0000',
          createdAt: new Date().toISOString(),
        },
        {
          id: 'b2',
          organizationId: orgId,
          recipeId: 'rec-base',
          ingredientId: 'ing-oil',
          subRecipeId: null,
          quantity: '0.0500',
          grossQuantity: '0.0500',
          unitCostSnapshot: '10.0000',
          createdAt: new Date().toISOString(),
        },
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // Level 3: Final Pizza (Yield = 1.0000 PZ) -> Consumes 1.0000 PZ Base (Factor = 1/5 = 0.20)
    // 0.20 * Flour(1.5) = 0.3000 Flour
    // 0.20 * Water(1.0) = 0.2000 Water
    // 0.20 * Yeast(0.025) = 0.0050 Yeast
    // 0.20 * Oil(0.05) = 0.0100 Oil
    // Plus Topping Pepperoni (0.0800 KG)
    const finishedPizzaRecipe: Recipe = {
      id: 'rec-finished-pizza',
      organizationId: orgId,
      productId: null,
      code: 'PEP-PIZZA',
      name: 'Pepperoni Pizza',
      yieldQuantity: '1.0000',
      yieldUnit: 'PZ',
      totalCost: '0.0000',
      isActive: true,
      items: [
        {
          id: 'fp1',
          organizationId: orgId,
          recipeId: 'rec-finished-pizza',
          ingredientId: null,
          subRecipeId: 'rec-base',
          quantity: '1.0000',
          grossQuantity: '1.0000',
          unitCostSnapshot: '0.0000',
          createdAt: new Date().toISOString(),
        },
        {
          id: 'fp2',
          organizationId: orgId,
          recipeId: 'rec-finished-pizza',
          ingredientId: 'ing-pepperoni',
          subRecipeId: null,
          quantity: '0.0800',
          grossQuantity: '0.0800',
          unitCostSnapshot: '20.0000',
          createdAt: new Date().toISOString(),
        },
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const resolver = (id: string) => {
      if (id === 'rec-base') return baseRecipe;
      if (id === 'rec-dough') return doughRecipe;
      return null;
    };

    const exploded = await RecipeEngine.explodeIngredients(finishedPizzaRecipe, resolver);

    assert.equal(exploded.length, 5);
    assert.deepEqual(exploded, [
      { ingredientId: 'ing-flour', totalQuantity: '0.3000', totalGrossQuantity: '0.3000' },
      { ingredientId: 'ing-oil', totalQuantity: '0.0100', totalGrossQuantity: '0.0100' },
      { ingredientId: 'ing-pepperoni', totalQuantity: '0.0800', totalGrossQuantity: '0.0800' },
      { ingredientId: 'ing-water', totalQuantity: '0.2000', totalGrossQuantity: '0.2000' },
      { ingredientId: 'ing-yeast', totalQuantity: '0.0050', totalGrossQuantity: '0.0050' },
    ]);
  });

  it('INV-04: deterministically aggregates duplicate ingredients across multiple branches', async () => {
    // Subrecipe A: uses 0.0100 Salt
    const subA: Recipe = {
      id: 'sub-a',
      organizationId: orgId,
      productId: null,
      code: 'SUB-A',
      name: 'Sub A',
      yieldQuantity: '1.0000',
      yieldUnit: 'PZ',
      totalCost: '0.0000',
      isActive: true,
      items: [
        {
          id: 'item-a1',
          organizationId: orgId,
          recipeId: 'sub-a',
          ingredientId: 'ing-salt',
          subRecipeId: null,
          quantity: '0.0100',
          grossQuantity: '0.0100',
          unitCostSnapshot: '1.0000',
          createdAt: new Date().toISOString(),
        },
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // Subrecipe B: uses 0.0200 Salt
    const subB: Recipe = {
      id: 'sub-b',
      organizationId: orgId,
      productId: null,
      code: 'SUB-B',
      name: 'Sub B',
      yieldQuantity: '1.0000',
      yieldUnit: 'PZ',
      totalCost: '0.0000',
      isActive: true,
      items: [
        {
          id: 'item-b1',
          organizationId: orgId,
          recipeId: 'sub-b',
          ingredientId: 'ing-salt',
          subRecipeId: null,
          quantity: '0.0200',
          grossQuantity: '0.0200',
          unitCostSnapshot: '1.0000',
          createdAt: new Date().toISOString(),
        },
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // Root recipe uses Sub A (x1), Sub B (x1), and Salt directly (0.0050)
    const rootRecipe: Recipe = {
      id: 'rec-root',
      organizationId: orgId,
      productId: null,
      code: 'REC-ROOT',
      name: 'Root Recipe',
      yieldQuantity: '1.0000',
      yieldUnit: 'PZ',
      totalCost: '0.0000',
      isActive: true,
      items: [
        {
          id: 'r1',
          organizationId: orgId,
          recipeId: 'rec-root',
          ingredientId: null,
          subRecipeId: 'sub-a',
          quantity: '1.0000',
          grossQuantity: '1.0000',
          unitCostSnapshot: '0.0000',
          createdAt: new Date().toISOString(),
        },
        {
          id: 'r2',
          organizationId: orgId,
          recipeId: 'rec-root',
          ingredientId: null,
          subRecipeId: 'sub-b',
          quantity: '1.0000',
          grossQuantity: '1.0000',
          unitCostSnapshot: '0.0000',
          createdAt: new Date().toISOString(),
        },
        {
          id: 'r3',
          organizationId: orgId,
          recipeId: 'rec-root',
          ingredientId: 'ing-salt',
          subRecipeId: null,
          quantity: '0.0050',
          grossQuantity: '0.0050',
          unitCostSnapshot: '1.0000',
          createdAt: new Date().toISOString(),
        },
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const resolver = (id: string) => {
      if (id === 'sub-a') return subA;
      if (id === 'sub-b') return subB;
      return null;
    };

    const result = await RecipeEngine.explodeIngredients(rootRecipe, resolver);
    assert.equal(result.length, 1);
    // Total Salt = 0.0100 + 0.0200 + 0.0050 = 0.0350
    assert.equal(result[0]!.ingredientId, 'ing-salt');
    assert.equal(result[0]!.totalQuantity, '0.0350');
    assert.equal(result[0]!.totalGrossQuantity, '0.0350');
  });

  it('INV-05: detects direct self-cycles and throws CycleDetectedError', async () => {
    // Recipe A references Recipe A directly
    const cyclicRecipe: Recipe = {
      id: 'rec-self-cycle',
      organizationId: orgId,
      productId: null,
      code: 'SELF-CYCLE',
      name: 'Self Cyclic Recipe',
      yieldQuantity: '1.0000',
      yieldUnit: 'PZ',
      totalCost: '0.0000',
      isActive: true,
      items: [
        {
          id: 'item-sc',
          organizationId: orgId,
          recipeId: 'rec-self-cycle',
          ingredientId: null,
          subRecipeId: 'rec-self-cycle',
          quantity: '1.0000',
          grossQuantity: '1.0000',
          unitCostSnapshot: '0.0000',
          createdAt: new Date().toISOString(),
        },
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await assert.rejects(
      async () => {
        await RecipeEngine.explodeIngredients(cyclicRecipe, () => cyclicRecipe);
      },
      (err: unknown) => {
        assert(err instanceof CycleDetectedError);
        assert.equal(err.code, 'CYCLE_DETECTED');
        assert.deepEqual(err.cyclePath, ['rec-self-cycle', 'rec-self-cycle']);
        return true;
      },
    );
  });

  it('INV-06: detects indirect multi-hop cycles and throws CycleDetectedError', async () => {
    // A -> B -> C -> A
    const recipeA: Recipe = {
      id: 'rec-a',
      organizationId: orgId,
      productId: null,
      code: 'REC-A',
      name: 'Recipe A',
      yieldQuantity: '1.0000',
      yieldUnit: 'PZ',
      totalCost: '0.0000',
      isActive: true,
      items: [
        {
          id: 'item-a',
          organizationId: orgId,
          recipeId: 'rec-a',
          ingredientId: null,
          subRecipeId: 'rec-b',
          quantity: '1.0000',
          grossQuantity: '1.0000',
          unitCostSnapshot: '0.0000',
          createdAt: new Date().toISOString(),
        },
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const recipeB: Recipe = {
      id: 'rec-b',
      organizationId: orgId,
      productId: null,
      code: 'REC-B',
      name: 'Recipe B',
      yieldQuantity: '1.0000',
      yieldUnit: 'PZ',
      totalCost: '0.0000',
      isActive: true,
      items: [
        {
          id: 'item-b',
          organizationId: orgId,
          recipeId: 'rec-b',
          ingredientId: null,
          subRecipeId: 'rec-c',
          quantity: '1.0000',
          grossQuantity: '1.0000',
          unitCostSnapshot: '0.0000',
          createdAt: new Date().toISOString(),
        },
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const recipeC: Recipe = {
      id: 'rec-c',
      organizationId: orgId,
      productId: null,
      code: 'REC-C',
      name: 'Recipe C',
      yieldQuantity: '1.0000',
      yieldUnit: 'PZ',
      totalCost: '0.0000',
      isActive: true,
      items: [
        {
          id: 'item-c',
          organizationId: orgId,
          recipeId: 'rec-c',
          ingredientId: null,
          subRecipeId: 'rec-a',
          quantity: '1.0000',
          grossQuantity: '1.0000',
          unitCostSnapshot: '0.0000',
          createdAt: new Date().toISOString(),
        },
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const resolver = (id: string) => {
      if (id === 'rec-a') return recipeA;
      if (id === 'rec-b') return recipeB;
      if (id === 'rec-c') return recipeC;
      return null;
    };

    await assert.rejects(
      async () => {
        await RecipeEngine.explodeIngredients(recipeA, resolver);
      },
      (err: unknown) => {
        assert(err instanceof CycleDetectedError);
        assert.equal(err.code, 'CYCLE_DETECTED');
        assert.deepEqual(err.cyclePath, ['rec-a', 'rec-b', 'rec-c', 'rec-a']);
        return true;
      },
    );
  });

  it('INV-08: throws ZeroDivisorError when recipe yieldQuantity is zero', async () => {
    const zeroYieldRecipe: Recipe = {
      id: 'rec-zero-yield',
      organizationId: orgId,
      productId: null,
      code: 'ZERO-YIELD',
      name: 'Zero Yield Recipe',
      yieldQuantity: '0.0000',
      yieldUnit: 'PZ',
      totalCost: '0.0000',
      isActive: true,
      items: [
        {
          id: 'item-zy',
          organizationId: orgId,
          recipeId: 'rec-zero-yield',
          ingredientId: 'ing-flour',
          subRecipeId: null,
          quantity: '1.0000',
          grossQuantity: '1.0000',
          unitCostSnapshot: '1.0000',
          createdAt: new Date().toISOString(),
        },
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await assert.rejects(
      async () => {
        await RecipeEngine.explodeIngredients(zeroYieldRecipe, () => null);
      },
      (err: unknown) => {
        assert(err instanceof ZeroDivisorError);
        assert.equal(err.code, 'ZERO_DIVISOR_ERROR');
        return true;
      },
    );
  });

  it('throws RecipeNotFoundError when subrecipe is not found by resolver', async () => {
    const recipe: Recipe = {
      id: 'rec-missing-sub',
      organizationId: orgId,
      productId: null,
      code: 'REC-MISSING',
      name: 'Missing Subrecipe Recipe',
      yieldQuantity: '1.0000',
      yieldUnit: 'PZ',
      totalCost: '0.0000',
      isActive: true,
      items: [
        {
          id: 'item-ms',
          organizationId: orgId,
          recipeId: 'rec-missing-sub',
          ingredientId: null,
          subRecipeId: 'rec-nonexistent',
          quantity: '1.0000',
          grossQuantity: '1.0000',
          unitCostSnapshot: '0.0000',
          createdAt: new Date().toISOString(),
        },
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await assert.rejects(
      async () => {
        await RecipeEngine.explodeIngredients(recipe, () => null);
      },
      (err: unknown) => {
        assert(err instanceof RecipeNotFoundError);
        assert.equal(err.recipeId, 'rec-nonexistent');
        return true;
      },
    );
  });

  it('throws InvalidRecipeItemError when exclusive target constraint is violated', async () => {
    // Both ingredientId and subRecipeId set
    const invalidBoth: RecipeItem = {
      id: 'item-both',
      organizationId: orgId,
      recipeId: 'rec-test',
      ingredientId: 'ing-1',
      subRecipeId: 'sub-1',
      quantity: '1.0000',
      grossQuantity: '1.0000',
      unitCostSnapshot: '1.0000',
      createdAt: new Date().toISOString(),
    };

    // Neither ingredientId nor subRecipeId set
    const invalidNeither: RecipeItem = {
      id: 'item-neither',
      organizationId: orgId,
      recipeId: 'rec-test',
      ingredientId: null,
      subRecipeId: null,
      quantity: '1.0000',
      grossQuantity: '1.0000',
      unitCostSnapshot: '1.0000',
      createdAt: new Date().toISOString(),
    };

    const makeRecipe = (item: RecipeItem): Recipe => ({
      id: 'rec-test',
      organizationId: orgId,
      productId: null,
      code: 'TEST',
      name: 'Test',
      yieldQuantity: '1.0000',
      yieldUnit: 'PZ',
      totalCost: '0.0000',
      isActive: true,
      items: [item],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    await assert.rejects(
      async () => {
        await RecipeEngine.explodeIngredients(makeRecipe(invalidBoth), () => null);
      },
      (err: unknown) => {
        assert(err instanceof InvalidRecipeItemError);
        return true;
      },
    );

    await assert.rejects(
      async () => {
        await RecipeEngine.explodeIngredients(makeRecipe(invalidNeither), () => null);
      },
      (err: unknown) => {
        assert(err instanceof InvalidRecipeItemError);
        return true;
      },
    );
  });
});

describe('@trident/inventory - RecipeEngine.calculateRecipeCost (INV-09 .. INV-11, INV-14)', () => {
  const orgId = '00000000-0000-0000-0000-000000000001';

  it('INV-10 & INV-11: calculates theoretical batch and unit cost for single-level recipe', async () => {
    // Recipe: Yield = 2.0000 PZ
    // Item 1: Meat 0.4000 gross @ 50.0000/KG = 20.0000
    // Item 2: Bun 2.0000 gross @ 5.0000/PZ = 10.0000
    // Total Batch Cost = 30.0000
    // Unit Cost = 30.0000 / 2.0000 = 15.0000
    const recipe: Recipe = {
      id: 'rec-cost-burger',
      organizationId: orgId,
      productId: null,
      code: 'BURGER-2X',
      name: 'Double Burger Batch',
      yieldQuantity: '2.0000',
      yieldUnit: 'PZ',
      totalCost: '0.0000',
      isActive: true,
      items: [
        {
          id: 'item-1',
          organizationId: orgId,
          recipeId: 'rec-cost-burger',
          ingredientId: 'ing-meat',
          subRecipeId: null,
          quantity: '0.4000',
          grossQuantity: '0.4000',
          unitCostSnapshot: '0.0000',
          createdAt: new Date().toISOString(),
        },
        {
          id: 'item-2',
          organizationId: orgId,
          recipeId: 'rec-cost-burger',
          ingredientId: 'ing-bun',
          subRecipeId: null,
          quantity: '2.0000',
          grossQuantity: '2.0000',
          unitCostSnapshot: '0.0000',
          createdAt: new Date().toISOString(),
        },
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const resolver = {
      getIngredientCost: (id: string) => {
        if (id === 'ing-meat') return '50.0000';
        if (id === 'ing-bun') return '5.0000';
        return '0.0000';
      },
      getSubRecipe: () => null,
    };

    const costResult = await RecipeEngine.calculateRecipeCost(recipe, resolver);
    const fnCostResult = await calculateRecipeCost(recipe, resolver);

    assert.equal(costResult.recipeId, 'rec-cost-burger');
    assert.equal(costResult.totalCost, '30.0000');
    assert.equal(costResult.unitCost, '15.0000');
    assert.equal(costResult.yieldQuantity, '2.0000');
    assert.equal(costResult.lineItems.length, 2);
    assert.deepEqual(costResult.lineItems[0], {
      id: 'item-1',
      targetType: 'INGREDIENT',
      targetId: 'ing-meat',
      grossQuantity: '0.4000',
      unitCost: '50.0000',
      totalLineCost: '20.0000',
    });
    assert.deepEqual(costResult.lineItems[1], {
      id: 'item-2',
      targetType: 'INGREDIENT',
      targetId: 'ing-bun',
      grossQuantity: '2.0000',
      unitCost: '5.0000',
      totalLineCost: '10.0000',
    });
    assert.deepEqual(fnCostResult, costResult);
  });

  it('INV-09: supports zero-cost ingredients (e.g. tap water) as valid 0.0000 without falsy bugs', async () => {
    const soupRecipe: Recipe = {
      id: 'rec-soup',
      organizationId: orgId,
      productId: null,
      code: 'SOUP',
      name: 'Soup',
      yieldQuantity: '1.0000',
      yieldUnit: 'LT',
      totalCost: '0.0000',
      isActive: true,
      items: [
        {
          id: 'item-water',
          organizationId: orgId,
          recipeId: 'rec-soup',
          ingredientId: 'ing-tap-water',
          subRecipeId: null,
          quantity: '1.0000',
          grossQuantity: '1.0000',
          unitCostSnapshot: '0.0000',
          createdAt: new Date().toISOString(),
        },
        {
          id: 'item-chicken',
          organizationId: orgId,
          recipeId: 'rec-soup',
          ingredientId: 'ing-chicken',
          subRecipeId: null,
          quantity: '0.2000',
          grossQuantity: '0.2000',
          unitCostSnapshot: '60.0000',
          createdAt: new Date().toISOString(),
        },
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const resolver = {
      getIngredientCost: (id: string) => (id === 'ing-tap-water' ? '0.0000' : '60.0000'),
      getSubRecipe: () => null,
    };

    const costResult = await RecipeEngine.calculateRecipeCost(soupRecipe, resolver);
    assert.equal(costResult.totalCost, '12.0000');
    assert.equal(costResult.unitCost, '12.0000');
    assert.equal(costResult.lineItems[0]!.unitCost, '0.0000');
    assert.equal(costResult.lineItems[0]!.totalLineCost, '0.0000');
    assert.equal(costResult.lineItems[1]!.totalLineCost, '12.0000');
  });

  it('calculates cost recursively for nested subrecipes', async () => {
    // Subrecipe: Tomato Sauce (Yield = 4.0000 LT)
    // Tomato: 4.0000 gross @ 10.0000 = 40.0000
    // Total Sauce Batch = 40.0000, Unit Cost = 40.0000 / 4.0000 = 10.0000/LT
    const sauceSubRecipe: Recipe = {
      id: 'rec-cost-sauce',
      organizationId: orgId,
      productId: null,
      code: 'SAUCE',
      name: 'Sauce',
      yieldQuantity: '4.0000',
      yieldUnit: 'LT',
      totalCost: '0.0000',
      isActive: true,
      items: [
        {
          id: 'item-s1',
          organizationId: orgId,
          recipeId: 'rec-cost-sauce',
          ingredientId: 'ing-tomato',
          subRecipeId: null,
          quantity: '4.0000',
          grossQuantity: '4.0000',
          unitCostSnapshot: '0.0000',
          createdAt: new Date().toISOString(),
        },
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // Pizza Recipe: Yield = 1.0000 PZ
    // Consumes 0.2500 LT Sauce @ 10.0000 = 2.5000
    // Cheese: 0.1000 KG @ 30.0000 = 3.0000
    // Total Batch = 5.5000, Unit Cost = 5.5000
    const pizzaRecipe: Recipe = {
      id: 'rec-cost-pizza',
      organizationId: orgId,
      productId: null,
      code: 'PIZZA',
      name: 'Pizza',
      yieldQuantity: '1.0000',
      yieldUnit: 'PZ',
      totalCost: '0.0000',
      isActive: true,
      items: [
        {
          id: 'item-p1',
          organizationId: orgId,
          recipeId: 'rec-cost-pizza',
          ingredientId: null,
          subRecipeId: 'rec-cost-sauce',
          quantity: '0.2500',
          grossQuantity: '0.2500',
          unitCostSnapshot: '0.0000',
          createdAt: new Date().toISOString(),
        },
        {
          id: 'item-p2',
          organizationId: orgId,
          recipeId: 'rec-cost-pizza',
          ingredientId: 'ing-cheese',
          subRecipeId: null,
          quantity: '0.1000',
          grossQuantity: '0.1000',
          unitCostSnapshot: '0.0000',
          createdAt: new Date().toISOString(),
        },
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const resolver = {
      getIngredientCost: (id: string) => {
        if (id === 'ing-tomato') return '10.0000';
        if (id === 'ing-cheese') return '30.0000';
        return '0.0000';
      },
      getSubRecipe: (id: string) => (id === 'rec-cost-sauce' ? sauceSubRecipe : null),
    };

    const costResult = await RecipeEngine.calculateRecipeCost(pizzaRecipe, resolver);
    assert.equal(costResult.totalCost, '5.5000');
    assert.equal(costResult.unitCost, '5.5000');
    assert.equal(costResult.lineItems[0]!.targetType, 'SUB_RECIPE');
    assert.equal(costResult.lineItems[0]!.unitCost, '10.0000');
    assert.equal(costResult.lineItems[0]!.totalLineCost, '2.5000');
    assert.equal(costResult.lineItems[1]!.totalLineCost, '3.0000');
  });

  it('detects cycles during cost calculation and throws CycleDetectedError', async () => {
    const cyclicRecipe: Recipe = {
      id: 'rec-cost-cycle',
      organizationId: orgId,
      productId: null,
      code: 'COST-CYCLE',
      name: 'Cost Cycle',
      yieldQuantity: '1.0000',
      yieldUnit: 'PZ',
      totalCost: '0.0000',
      isActive: true,
      items: [
        {
          id: 'item-cc',
          organizationId: orgId,
          recipeId: 'rec-cost-cycle',
          ingredientId: null,
          subRecipeId: 'rec-cost-cycle',
          quantity: '1.0000',
          grossQuantity: '1.0000',
          unitCostSnapshot: '0.0000',
          createdAt: new Date().toISOString(),
        },
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await assert.rejects(
      async () => {
        await RecipeEngine.calculateRecipeCost(cyclicRecipe, {
          getIngredientCost: () => '1.0000',
          getSubRecipe: () => cyclicRecipe,
        });
      },
      (err: unknown) => {
        assert(err instanceof CycleDetectedError);
        return true;
      },
    );
  });

  it('INV-14: throws InvalidRecipeItemError when ingredient cost is missing or undefined (no silent defaulting to 0.0000)', async () => {
    const recipeWithMissingCost: Recipe = {
      id: 'rec-missing-cost',
      organizationId: orgId,
      productId: null,
      code: 'REC-MISS-COST',
      name: 'Missing Cost Recipe',
      yieldQuantity: '1.0000',
      yieldUnit: 'PZ',
      totalCost: '0.0000',
      isActive: true,
      items: [
        {
          id: 'item-mc-1',
          organizationId: orgId,
          recipeId: 'rec-missing-cost',
          ingredientId: 'ing-no-cost',
          subRecipeId: null,
          quantity: '1.0000',
          grossQuantity: '1.0000',
          unitCostSnapshot: '0.0000',
          createdAt: new Date().toISOString(),
        },
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await assert.rejects(
      async () => {
        await RecipeEngine.calculateRecipeCost(recipeWithMissingCost, {
          getIngredientCost: () => '' as unknown as string, // Empty / missing cost
          getSubRecipe: () => null,
        });
      },
      (err: unknown) => {
        assert(err instanceof InvalidRecipeItemError);
        assert.match(err.message, /Missing cost for ingredient 'ing-no-cost'/);
        return true;
      },
    );
  });

  it('throws ZeroDivisorError when recipe yieldQuantity is missing or empty (no silent defaulting to 1.0000)', async () => {
    const recipeEmptyYield: Recipe = {
      id: 'rec-empty-yield',
      organizationId: orgId,
      productId: null,
      code: 'REC-EMPTY-YIELD',
      name: 'Empty Yield Recipe',
      yieldQuantity: '' as unknown as string,
      yieldUnit: 'PZ',
      totalCost: '0.0000',
      isActive: true,
      items: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await assert.rejects(
      async () => {
        await RecipeEngine.calculateRecipeCost(recipeEmptyYield, {
          getIngredientCost: () => '1.0000',
          getSubRecipe: () => null,
        });
      },
      (err: unknown) => {
        assert(err instanceof ZeroDivisorError);
        return true;
      },
    );

    await assert.rejects(
      async () => {
        await RecipeEngine.explodeIngredients(recipeEmptyYield, () => null);
      },
      (err: unknown) => {
        assert(err instanceof ZeroDivisorError);
        return true;
      },
    );
  });
});

describe('@trident/inventory - ModifierRecipeResolver contract (INV-15, OQ-SSOT-07)', () => {
  it('INV-15: allows injecting custom pluggable resolver conforming to neutral contract without concrete business logic', async () => {
    // Proves that external plugins can implement ModifierRecipeResolver
    const mockResolver: ModifierRecipeResolver = {
      async resolveModifierImpact(ctx) {
        if (ctx.modifierId === 'mod-extra-cheese') {
          return {
            modifierId: ctx.modifierId,
            additionalIngredients: [
              {
                ingredientId: 'ing-cheese',
                quantity: '0.0500',
                grossQuantity: '0.0500',
              },
            ],
            removedIngredients: [],
          };
        }
        return null;
      },
    };

    const impact = await mockResolver.resolveModifierImpact({
      organizationId: '00000000-0000-0000-0000-000000000001',
      recipeId: 'rec-pizza',
      modifierId: 'mod-extra-cheese',
      quantity: '1.0000',
    });

    assert.notEqual(impact, null);
    assert.equal(impact!.additionalIngredients[0]!.ingredientId, 'ing-cheese');
    assert.equal(impact!.additionalIngredients[0]!.quantity, '0.0500');
  });
});
