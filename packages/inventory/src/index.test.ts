import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  CycleDetectedError,
  InvalidRecipeItemError,
  RecipeNotFoundError,
  ZeroDivisorError,
  RecipeEngine,
  formatDecimal12x4,
  parseDecimal12x4,
  multiplyScale4,
  divideScale4,
  type Recipe,
  type RecipeItem,
  type ModifierRecipeResolver,
} from './index.js';

describe('@trident/inventory - Numerics', () => {
  it('parses and formats 4-decimal fixed point numbers without float drift', () => {
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
});

describe('@trident/inventory - RecipeEngine.explodeIngredients', () => {
  const orgId = '00000000-0000-0000-0000-000000000001';

  it('explodes a single-level recipe into raw ingredients', async () => {
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
  });

  it('explodes nested subrecipes with proportional yield scaling', async () => {
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

  it('deterministically aggregates duplicate ingredients across multiple branches', async () => {
    // Subrecipe A: uses 0.5000 Salt
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

    const exploded = await RecipeEngine.explodeIngredients(rootRecipe, resolver);

    assert.equal(exploded.length, 1);
    // 0.0100 + 0.0200 + 0.0050 = 0.0350
    assert.deepEqual(exploded[0], {
      ingredientId: 'ing-salt',
      totalQuantity: '0.0350',
      totalGrossQuantity: '0.0350',
    });
  });

  it('detects direct cycles and throws CycleDetectedError', async () => {
    // Recipe A references Recipe A as subrecipe
    const cyclicRecipe: Recipe = {
      id: 'rec-cyclic-direct',
      organizationId: orgId,
      productId: null,
      code: 'REC-DIR-CYCLE',
      name: 'Direct Cycle',
      yieldQuantity: '1.0000',
      yieldUnit: 'PZ',
      totalCost: '0.0000',
      isActive: true,
      items: [
        {
          id: 'item-cycle',
          organizationId: orgId,
          recipeId: 'rec-cyclic-direct',
          ingredientId: null,
          subRecipeId: 'rec-cyclic-direct',
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
        assert.deepEqual(err.cyclePath, ['rec-cyclic-direct', 'rec-cyclic-direct']);
        return true;
      },
    );
  });

  it('detects indirect cycles across multi-tier hierarchy and throws CycleDetectedError', async () => {
    // A -> B -> C -> A
    const recipeA: Recipe = {
      id: 'node-a',
      organizationId: orgId,
      productId: null,
      code: 'REC-A',
      name: 'A',
      yieldQuantity: '1.0000',
      yieldUnit: 'PZ',
      totalCost: '0.0000',
      isActive: true,
      items: [
        {
          id: 'item-ab',
          organizationId: orgId,
          recipeId: 'node-a',
          ingredientId: null,
          subRecipeId: 'node-b',
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
      id: 'node-b',
      organizationId: orgId,
      productId: null,
      code: 'REC-B',
      name: 'B',
      yieldQuantity: '1.0000',
      yieldUnit: 'PZ',
      totalCost: '0.0000',
      isActive: true,
      items: [
        {
          id: 'item-bc',
          organizationId: orgId,
          recipeId: 'node-b',
          ingredientId: null,
          subRecipeId: 'node-c',
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
      id: 'node-c',
      organizationId: orgId,
      productId: null,
      code: 'REC-C',
      name: 'C',
      yieldQuantity: '1.0000',
      yieldUnit: 'PZ',
      totalCost: '0.0000',
      isActive: true,
      items: [
        {
          id: 'item-ca',
          organizationId: orgId,
          recipeId: 'node-c',
          ingredientId: null,
          subRecipeId: 'node-a', // Cycle back to A!
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
      if (id === 'node-a') return recipeA;
      if (id === 'node-b') return recipeB;
      if (id === 'node-c') return recipeC;
      return null;
    };

    await assert.rejects(
      async () => {
        await RecipeEngine.explodeIngredients(recipeA, resolver);
      },
      (err: unknown) => {
        assert(err instanceof CycleDetectedError);
        assert.deepEqual(err.cyclePath, ['node-a', 'node-b', 'node-c', 'node-a']);
        return true;
      },
    );
  });

  it('throws ZeroDivisorError when recipe yieldQuantity is zero or negative', async () => {
    const zeroYieldRecipe: Recipe = {
      id: 'zero-yield',
      organizationId: orgId,
      productId: null,
      code: 'ZERO',
      name: 'Zero Yield',
      yieldQuantity: '0.0000',
      yieldUnit: 'PZ',
      totalCost: '0.0000',
      isActive: true,
      items: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await assert.rejects(
      async () => {
        await RecipeEngine.explodeIngredients(zeroYieldRecipe, () => null);
      },
      (err: unknown) => {
        assert(err instanceof ZeroDivisorError);
        return true;
      },
    );
  });

  it('throws InvalidRecipeItemError when recipe item violates XOR exclusivity', async () => {
    const invalidItemBoth: RecipeItem = {
      id: 'item-invalid-1',
      organizationId: orgId,
      recipeId: 'rec-inv',
      ingredientId: 'ing-1',
      subRecipeId: 'sub-1', // Both set!
      quantity: '1.0000',
      grossQuantity: '1.0000',
      unitCostSnapshot: '0.0000',
      createdAt: new Date().toISOString(),
    };

    const recipe: Recipe = {
      id: 'rec-inv',
      organizationId: orgId,
      productId: null,
      code: 'INV',
      name: 'Invalid Item Recipe',
      yieldQuantity: '1.0000',
      yieldUnit: 'PZ',
      totalCost: '0.0000',
      isActive: true,
      items: [invalidItemBoth],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await assert.rejects(
      async () => {
        await RecipeEngine.explodeIngredients(recipe, () => null);
      },
      (err: unknown) => {
        assert(err instanceof InvalidRecipeItemError);
        return true;
      },
    );
  });

  it('throws RecipeNotFoundError when subrecipe is missing', async () => {
    const recipe: Recipe = {
      id: 'rec-missing',
      organizationId: orgId,
      productId: null,
      code: 'MISS',
      name: 'Missing Subrecipe',
      yieldQuantity: '1.0000',
      yieldUnit: 'PZ',
      totalCost: '0.0000',
      isActive: true,
      items: [
        {
          id: 'item-miss',
          organizationId: orgId,
          recipeId: 'rec-missing',
          ingredientId: null,
          subRecipeId: 'non-existent-sub',
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
        assert.equal(err.recipeId, 'non-existent-sub');
        return true;
      },
    );
  });
});

describe('@trident/inventory - RecipeEngine.calculateRecipeCost', () => {
  const orgId = '00000000-0000-0000-0000-000000000001';

  it('calculates single-level recipe cost with current average costs', async () => {
    // Recipe: 2 Burgers (Yield = 2.0000)
    // Meat: 0.4400 gross @ 50.0000/kg = 22.0000
    // Bun: 2.0000 gross @ 4.5000/pz = 9.0000
    // Total Batch = 31.0000
    // Unit Cost = 31.0000 / 2.0000 = 15.5000
    const burgerRecipe: Recipe = {
      id: 'rec-cost-burger',
      organizationId: orgId,
      productId: null,
      code: 'BURGER-BATCH',
      name: 'Double Burger Batch',
      yieldQuantity: '2.0000',
      yieldUnit: 'PZ',
      totalCost: '0.0000',
      isActive: true,
      items: [
        {
          id: 'item-c1',
          organizationId: orgId,
          recipeId: 'rec-cost-burger',
          ingredientId: 'ing-meat',
          subRecipeId: null,
          quantity: '0.4000',
          grossQuantity: '0.4400',
          unitCostSnapshot: '0.0000',
          createdAt: new Date().toISOString(),
        },
        {
          id: 'item-c2',
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
        if (id === 'ing-bun') return '4.5000';
        return '0.0000';
      },
      getSubRecipe: () => null,
    };

    const costResult = await RecipeEngine.calculateRecipeCost(burgerRecipe, resolver);

    assert.equal(costResult.recipeId, 'rec-cost-burger');
    assert.equal(costResult.yieldQuantity, '2.0000');
    assert.equal(costResult.totalCost, '31.0000');
    assert.equal(costResult.unitCost, '15.5000');
    assert.equal(costResult.lineItems.length, 2);
    assert.deepEqual(costResult.lineItems[0], {
      id: 'item-c1',
      targetType: 'INGREDIENT',
      targetId: 'ing-meat',
      grossQuantity: '0.4400',
      unitCost: '50.0000',
      totalLineCost: '22.0000',
    });
    assert.deepEqual(costResult.lineItems[1], {
      id: 'item-c2',
      targetType: 'INGREDIENT',
      targetId: 'ing-bun',
      grossQuantity: '2.0000',
      unitCost: '4.5000',
      totalLineCost: '9.0000',
    });
  });

  it('handles zero-cost ingredients correctly without failures', async () => {
    // Water: 0.5000 gross @ 0.0000/lt = 0.0000
    // Flour: 1.0000 gross @ 12.0000/kg = 12.0000
    // Batch Cost = 12.0000, Yield = 1.0000 -> Unit = 12.0000
    const doughRecipe: Recipe = {
      id: 'rec-dough',
      organizationId: orgId,
      productId: null,
      code: 'DOUGH',
      name: 'Dough',
      yieldQuantity: '1.0000',
      yieldUnit: 'KG',
      totalCost: '0.0000',
      isActive: true,
      items: [
        {
          id: 'item-water',
          organizationId: orgId,
          recipeId: 'rec-dough',
          ingredientId: 'ing-water',
          subRecipeId: null,
          quantity: '0.5000',
          grossQuantity: '0.5000',
          unitCostSnapshot: '0.0000',
          createdAt: new Date().toISOString(),
        },
        {
          id: 'item-flour',
          organizationId: orgId,
          recipeId: 'rec-dough',
          ingredientId: 'ing-flour',
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

    const resolver = {
      getIngredientCost: (id: string) => {
        if (id === 'ing-water') return '0.0000';
        if (id === 'ing-flour') return '12.0000';
        return '0.0000';
      },
      getSubRecipe: () => null,
    };

    const costResult = await RecipeEngine.calculateRecipeCost(doughRecipe, resolver);
    assert.equal(costResult.totalCost, '12.0000');
    assert.equal(costResult.unitCost, '12.0000');
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
});

describe('@trident/inventory - ModifierRecipeResolver contract (OQ-SSOT-07)', () => {
  it('allows injecting custom pluggable resolver conforming to neutral contract', async () => {
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
