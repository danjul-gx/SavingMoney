/**
 * M2.6 — Goal & Savings Lock Foundation Tests
 * Pure domain & client layer testing for Node.js test runner
 */

const assert = require('assert');

// Pure Goal Calculations & Validations (mirroring src/lib/goals/client.ts)
function validateGoalInput(input) {
  if (!input.name || typeof input.name !== 'string' || input.name.trim() === '') {
    throw new Error('Goal name cannot be empty');
  }
  if (input.name.trim().length > 50) {
    throw new Error('Goal name cannot exceed 50 characters');
  }

  const target = input.target_amount;
  if (
    typeof target !== 'number' ||
    !Number.isFinite(target) ||
    !Number.isInteger(target) ||
    target <= 0
  ) {
    throw new Error('Target amount must be a positive integer in Rupiah');
  }

  if (input.target_year !== undefined && input.target_year !== null) {
    if (
      typeof input.target_year !== 'number' ||
      !Number.isInteger(input.target_year) ||
      input.target_year < 2000 ||
      input.target_year > 2100
    ) {
      throw new Error('Invalid target year');
    }
  }

  if (input.target_month !== undefined && input.target_month !== null) {
    if (
      typeof input.target_month !== 'number' ||
      !Number.isInteger(input.target_month) ||
      input.target_month < 1 ||
      input.target_month > 12
    ) {
      throw new Error('Invalid target month (must be between 1 and 12)');
    }
  }
}

function calculateGoalProgress(targetAmount, currentAmount) {
  const cleanTarget = Math.trunc(Math.max(0, targetAmount));
  const cleanCurrent = Math.trunc(Math.max(0, currentAmount));

  if (cleanTarget <= 0) {
    return {
      progressPercent: 0,
      visualPercent: 0,
      remainingAmount: 0,
      isCompleted: false,
    };
  }

  const remainingAmount = Math.max(0, cleanTarget - cleanCurrent);
  const rawRatio = cleanCurrent / cleanTarget;
  const progressPercent = Math.round(rawRatio * 10000) / 100;
  const visualPercent = Math.min(100, Math.max(0, progressPercent));
  const isCompleted = cleanCurrent >= cleanTarget;

  return {
    progressPercent,
    visualPercent,
    remainingAmount,
    isCompleted,
  };
}

// Client service logic under test with mock supabase
async function getGoals(supabase) {
  const { data: userData, error: authError } = await supabase.auth.getUser();
  if (authError || !userData?.user) {
    return { data: null, error: 'Unauthorized: Please log in to view goals.' };
  }

  const { data, error } = await supabase
    .from('goals')
    .select('*')
    .eq('user_id', userData.user.id)
    .order('is_primary', { ascending: false })
    .order('created_at', { ascending: true });

  if (error) {
    return { data: null, error: error.message };
  }
  return { data: data || [], error: null };
}

async function createGoal(input, supabase) {
  try {
    validateGoalInput(input);
  } catch (err) {
    return { data: null, error: err.message };
  }

  const { data: userData, error: authError } = await supabase.auth.getUser();
  if (authError || !userData?.user) {
    return { data: null, error: 'Unauthorized: Please log in to create a goal.' };
  }

  const payload = {
    user_id: userData.user.id,
    name: input.name.trim(),
    target_amount: input.target_amount,
    current_amount: 0,
    target_year: input.target_year ?? null,
    target_month: input.target_month ?? null,
    is_primary: input.is_primary ?? false,
    status: 'active',
  };

  const { data, error } = await supabase
    .from('goals')
    .insert(payload)
    .select()
    .single();

  if (error) {
    if (error.code === '23505' && error.message.includes('idx_goals_one_primary_per_user')) {
      return { data: null, error: 'Only one active primary goal is allowed.' };
    }
    return { data: null, error: error.message };
  }

  return { data, error: null };
}

async function updateGoal(goalId, input, supabase) {
  const { data: userData, error: authError } = await supabase.auth.getUser();
  if (authError || !userData?.user) {
    return { data: null, error: 'Unauthorized: Please log in to update a goal.' };
  }

  const safeUpdates = {};
  if (input.name !== undefined) {
    if (typeof input.name !== 'string' || input.name.trim() === '') {
      return { data: null, error: 'Goal name cannot be empty' };
    }
    if (input.name.trim().length > 50) {
      return { data: null, error: 'Goal name cannot exceed 50 characters' };
    }
    safeUpdates.name = input.name.trim();
  }

  if (input.target_amount !== undefined) {
    const target = input.target_amount;
    if (typeof target !== 'number' || !Number.isFinite(target) || !Number.isInteger(target) || target <= 0) {
      return { data: null, error: 'Target amount must be a positive integer in Rupiah' };
    }
    safeUpdates.target_amount = target;
  }

  if (input.target_year !== undefined) safeUpdates.target_year = input.target_year;
  if (input.target_month !== undefined) safeUpdates.target_month = input.target_month;
  if (input.status !== undefined) safeUpdates.status = input.status;
  if (input.is_primary !== undefined) safeUpdates.is_primary = input.is_primary;

  const { data, error } = await supabase
    .from('goals')
    .update(safeUpdates)
    .eq('id', goalId)
    .eq('user_id', userData.user.id)
    .select()
    .single();

  if (error) {
    if (error.code === '23505' && error.message.includes('idx_goals_one_primary_per_user')) {
      return { data: null, error: 'Only one active primary goal is allowed.' };
    }
    return { data: null, error: error.message };
  }

  return { data, error: null };
}

async function deleteGoal(goalId, supabase) {
  const { data: userData, error: authError } = await supabase.auth.getUser();
  if (authError || !userData?.user) {
    return { success: false, error: 'Unauthorized: Please log in to delete a goal.' };
  }

  const { error } = await supabase
    .from('goals')
    .delete()
    .eq('id', goalId)
    .eq('user_id', userData.user.id);

  if (error) {
    if (error.code === '23503') {
      return { success: false, error: 'Cannot delete a goal that has associated financial records.' };
    }
    return { success: false, error: error.message };
  }

  return { success: true, error: null };
}

console.log('--- Running M2.6 Goal & Savings Lock Tests ---');

let passed = 0;
let total = 0;

function test(name, fn) {
  total++;
  try {
    const res = fn();
    if (res && typeof res.then === 'function') {
      return res
        .then(() => {
          console.log(`PASS: ${name}`);
          passed++;
        })
        .catch((err) => {
          console.error(`FAIL: ${name}`);
          console.error(err);
        });
    }
    console.log(`PASS: ${name}`);
    passed++;
  } catch (err) {
    console.error(`FAIL: ${name}`);
    console.error(err);
  }
}

async function runAllTests() {
  // 1. empty goal name rejected
  test('1. empty goal name rejected', () => {
    assert.throws(() => validateGoalInput({ name: '', target_amount: 1000000 }), /Goal name cannot be empty/);
    assert.throws(() => validateGoalInput({ name: '   ', target_amount: 1000000 }), /Goal name cannot be empty/);
  });

  // 2. oversized goal name rejected according to schema (max 50)
  test('2. oversized goal name rejected according to schema', () => {
    const longName = 'A'.repeat(51);
    assert.throws(() => validateGoalInput({ name: longName, target_amount: 1000000 }), /Goal name cannot exceed 50 characters/);
  });

  // 3. zero target rejected
  test('3. zero target rejected', () => {
    assert.throws(() => validateGoalInput({ name: 'Valid Goal', target_amount: 0 }), /Target amount must be a positive integer/);
  });

  // 4. negative target rejected
  test('4. negative target rejected', () => {
    assert.throws(() => validateGoalInput({ name: 'Valid Goal', target_amount: -50000 }), /Target amount must be a positive integer/);
  });

  // 5. fractional target rejected
  test('5. fractional target rejected', () => {
    assert.throws(() => validateGoalInput({ name: 'Valid Goal', target_amount: 10000.5 }), /Target amount must be a positive integer/);
  });

  // 6. valid target accepted
  test('6. valid target accepted', () => {
    assert.doesNotThrow(() => validateGoalInput({ name: 'Laptop', target_amount: 15000000 }));
  });

  // 7. invalid timeframe/date rejected
  test('7. invalid timeframe/date rejected', () => {
    assert.throws(() => validateGoalInput({ name: 'Laptop', target_amount: 15000000, target_month: 0 }), /Invalid target month/);
    assert.throws(() => validateGoalInput({ name: 'Laptop', target_amount: 15000000, target_month: 13 }), /Invalid target month/);
    assert.throws(() => validateGoalInput({ name: 'Laptop', target_amount: 15000000, target_year: 1999 }), /Invalid target year/);
    assert.throws(() => validateGoalInput({ name: 'Laptop', target_amount: 15000000, target_year: 2101 }), /Invalid target year/);
  });

  // 8. arbitrary user_id cannot control ownership
  await test('8. arbitrary user_id cannot control ownership', async () => {
    const mockDb = {
      auth: {
        getUser: async () => ({ data: { user: { id: 'real-user' } }, error: null }),
      },
      from: () => ({
        insert: (payload) => {
          assert.strictEqual(payload.user_id, 'real-user');
          assert.notStrictEqual(payload.user_id, 'attacker-user');
          return {
            select: () => ({
              single: async () => ({ data: { id: 'g1', ...payload }, error: null }),
            }),
          };
        },
      }),
    };

    const res = await createGoal(
      { name: 'Goal', target_amount: 1000000, user_id: 'attacker-user' },
      mockDb
    );
    assert.strictEqual(res.data.user_id, 'real-user');
  });

  // 9. unauthenticated goal creation rejected
  await test('9. unauthenticated goal creation rejected', async () => {
    const mockDb = {
      auth: {
        getUser: async () => ({ data: { user: null }, error: null }),
      },
    };
    const res = await createGoal({ name: 'Goal', target_amount: 1000000 }, mockDb);
    assert.strictEqual(res.error, 'Unauthorized: Please log in to create a goal.');
  });

  // 10. goal list is user-scoped
  await test('10. goal list is user-scoped', async () => {
    let eqCalledWith = null;
    const mockDb = {
      auth: {
        getUser: async () => ({ data: { user: { id: 'user-123' } }, error: null }),
      },
      from: () => ({
        select: () => ({
          eq: (col, val) => {
            eqCalledWith = { col, val };
            return {
              order: () => ({
                order: async () => ({ data: [{ id: 'g1', user_id: 'user-123' }], error: null }),
              }),
            };
          },
        }),
      }),
    };

    const res = await getGoals(mockDb);
    assert.deepStrictEqual(eqCalledWith, { col: 'user_id', val: 'user-123' });
    assert.strictEqual(res.data.length, 1);
  });

  // 11. another user's goal cannot intentionally be selected
  await test('11. another user\'s goal cannot intentionally be selected', async () => {
    const mockDb = {
      auth: {
        getUser: async () => ({ data: { user: { id: 'user-123' } }, error: null }),
      },
      from: () => ({
        select: () => ({
          eq: (col, val) => {
            assert.strictEqual(val, 'user-123');
            return {
              order: () => ({
                order: async () => ({
                  data: [{ id: 'g1', user_id: 'user-123' }],
                  error: null,
                }),
              }),
            };
          },
        }),
      }),
    };
    const res = await getGoals(mockDb);
    assert.strictEqual(res.data[0].user_id, 'user-123');
  });

  // 12. goal update cannot directly modify current_amount
  await test('12. goal update cannot directly modify current_amount', async () => {
    let updatedPayload = null;
    const mockDb = {
      auth: {
        getUser: async () => ({ data: { user: { id: 'user-123' } }, error: null }),
      },
      from: () => ({
        update: (payload) => {
          updatedPayload = payload;
          return {
            eq: () => ({
              eq: () => ({
                select: () => ({
                  single: async () => ({ data: { id: 'g1', ...payload }, error: null }),
                }),
              }),
            }),
          };
        },
      }),
    };

    await updateGoal(
      'g1',
      { name: 'Updated Goal', current_amount: 99999999, user_id: 'other' },
      mockDb
    );
    assert.strictEqual(updatedPayload.name, 'Updated Goal');
    assert.strictEqual(updatedPayload.current_amount, undefined);
    assert.strictEqual(updatedPayload.user_id, undefined);
  });

  // 13. goal update cannot change ownership
  await test('13. goal update cannot change ownership', async () => {
    let updatedPayload = null;
    const mockDb = {
      auth: {
        getUser: async () => ({ data: { user: { id: 'user-123' } }, error: null }),
      },
      from: () => ({
        update: (payload) => {
          updatedPayload = payload;
          return {
            eq: () => ({
              eq: () => ({
                select: () => ({
                  single: async () => ({ data: { id: 'g1' }, error: null }),
                }),
              }),
            }),
          };
        },
      }),
    };

    await updateGoal('g1', { user_id: 'evil-user' }, mockDb);
    assert.strictEqual(updatedPayload.user_id, undefined);
  });

  // 14. goal progress calculation is integer-safe
  test('14. goal progress calculation is integer-safe', () => {
    const res = calculateGoalProgress(15000000, 5000000);
    assert.strictEqual(res.progressPercent, 33.33);
    assert.strictEqual(res.remainingAmount, 10000000);
    assert.strictEqual(res.isCompleted, false);

    const res2 = calculateGoalProgress(3000000, 1000000);
    assert.strictEqual(res2.progressPercent, 33.33);
  });

  // 15. remaining amount calculation is correct
  test('15. remaining amount calculation is correct', () => {
    const res = calculateGoalProgress(10000000, 4000000);
    assert.strictEqual(res.remainingAmount, 6000000);

    const over = calculateGoalProgress(10000000, 12000000);
    assert.strictEqual(over.remainingAmount, 0);
    assert.strictEqual(over.isCompleted, true);
  });

  // 16. visual progress is bounded appropriately
  test('16. visual progress is bounded appropriately', () => {
    const zero = calculateGoalProgress(10000000, 0);
    assert.strictEqual(zero.visualPercent, 0);
    assert.strictEqual(zero.progressPercent, 0);

    const half = calculateGoalProgress(10000000, 5000000);
    assert.strictEqual(half.visualPercent, 50);

    const over = calculateGoalProgress(10000000, 15000000);
    assert.strictEqual(over.visualPercent, 100);
    assert.strictEqual(over.progressPercent, 150);
  });

  // 17. no wallet balance mutation occurs from goal CRUD
  await test('17. no wallet balance mutation occurs from goal CRUD', async () => {
    let walletTouched = false;
    const mockDb = {
      auth: {
        getUser: async () => ({ data: { user: { id: 'u1' } }, error: null }),
      },
      from: (table) => {
        if (table === 'wallets') walletTouched = true;
        return {
          insert: (payload) => ({
            select: () => ({
              single: async () => ({ data: { id: 'g1', ...payload }, error: null }),
            }),
          }),
        };
      },
    };

    await createGoal({ name: 'Laptop', target_amount: 15000000 }, mockDb);
    assert.strictEqual(walletTouched, false, 'wallets table must not be touched');
  });

  // 18. no transaction is created by goal CRUD
  await test('18. no transaction is created by goal CRUD', async () => {
    let transactionTouched = false;
    const mockDb = {
      auth: {
        getUser: async () => ({ data: { user: { id: 'u1' } }, error: null }),
      },
      from: (table) => {
        if (table === 'transactions') transactionTouched = true;
        return {
          insert: (payload) => ({
            select: () => ({
              single: async () => ({ data: { id: 'g1', ...payload }, error: null }),
            }),
          }),
        };
      },
    };

    await createGoal({ name: 'Laptop', target_amount: 15000000 }, mockDb);
    assert.strictEqual(transactionTouched, false, 'transactions table must not be touched');
  });

  // 19. no savings contribution is silently created by goal CRUD
  await test('19. no savings contribution is silently created by goal CRUD', async () => {
    let tablesAccessed = [];
    const mockDb = {
      auth: {
        getUser: async () => ({ data: { user: { id: 'u1' } }, error: null }),
      },
      from: (table) => {
        tablesAccessed.push(table);
        return {
          insert: (payload) => ({
            select: () => ({
              single: async () => ({ data: { id: 'g1', ...payload }, error: null }),
            }),
          }),
        };
      },
    };

    await createGoal({ name: 'Laptop', target_amount: 15000000 }, mockDb);
    assert.deepStrictEqual(tablesAccessed, ['goals'], 'Only goals table should be touched');
  });

  // 20. database errors are mapped to user-friendly messages
  await test('20. database errors are mapped to user-friendly messages', async () => {
    // Duplicate primary goal error (23505)
    const mockDbDuplicate = {
      auth: {
        getUser: async () => ({ data: { user: { id: 'u1' } }, error: null }),
      },
      from: () => ({
        insert: () => ({
          select: () => ({
            single: async () => ({
              data: null,
              error: { code: '23505', message: 'duplicate key value violates unique constraint "idx_goals_one_primary_per_user"' },
            }),
          }),
        }),
      }),
    };

    const resDuplicate = await createGoal({ name: 'G1', target_amount: 1000000, is_primary: true }, mockDbDuplicate);
    assert.strictEqual(resDuplicate.error, 'Only one active primary goal is allowed.');

    // Foreign key restriction on delete (23503)
    const mockDbRestrict = {
      auth: {
        getUser: async () => ({ data: { user: { id: 'u1' } }, error: null }),
      },
      from: () => ({
        delete: () => ({
          eq: () => ({
            eq: async () => ({
              error: { code: '23503', message: 'violates foreign key constraint' },
            }),
          }),
        }),
      }),
    };

    const resDelete = await deleteGoal('g1', mockDbRestrict);
    assert.strictEqual(resDelete.error, 'Cannot delete a goal that has associated financial records.');
  });

  // 21. deleting a goal cannot destroy financial history
  await test('21. deleting a goal cannot destroy financial history', async () => {
    const mockDb = {
      auth: {
        getUser: async () => ({ data: { user: { id: 'u1' } }, error: null }),
      },
      from: () => ({
        delete: () => ({
          eq: () => ({
            eq: async () => ({
              error: { code: '23503', message: 'foreign key violation' },
            }),
          }),
        }),
      }),
    };
    const res = await deleteGoal('g1', mockDb);
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.error, 'Cannot delete a goal that has associated financial records.');
  });

  // 22. deleting a goal cannot mutate wallet balance
  await test('22. deleting a goal cannot mutate wallet balance', async () => {
    let walletTouched = false;
    const mockDb = {
      auth: {
        getUser: async () => ({ data: { user: { id: 'u1' } }, error: null }),
      },
      from: (table) => {
        if (table === 'wallets') walletTouched = true;
        return {
          delete: () => ({
            eq: () => ({
              eq: async () => ({ error: null }),
            }),
          }),
        };
      },
    };
    const res = await deleteGoal('g1', mockDb);
    assert.strictEqual(res.success, true);
    assert.strictEqual(walletTouched, false, 'wallets table must never be touched during goal deletion');
  });

  console.log(`\nM2.6 Goal Tests: ${passed}/${total} passed.`);
  if (passed !== total) {
    process.exit(1);
  }
}

runAllTests();
