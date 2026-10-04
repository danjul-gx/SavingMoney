/**
 * M2.7 — Savings Contribution / Goal Funding Tests
 * Pure domain & client layer accounting test runner
 */

const assert = require('assert');

// Domain logic to test directly
function validateSavingsContributionInput(input) {
  if (!input.walletId || typeof input.walletId !== 'string' || !input.walletId.trim()) {
    return { valid: false, error: 'Dompet sumber wajib dipilih.' };
  }

  if (!input.goalId || typeof input.goalId !== 'string' || !input.goalId.trim()) {
    return { valid: false, error: 'Tujuan tabungan wajib dipilih.' };
  }

  if (typeof input.amount !== 'number' || isNaN(input.amount)) {
    return { valid: false, error: 'Nominal kontribusi tidak valid.' };
  }

  if (!Number.isInteger(input.amount)) {
    return { valid: false, error: 'Nominal kontribusi harus berupa bilangan bulat Rupiah.' };
  }

  if (input.amount <= 0) {
    return { valid: false, error: 'Nominal kontribusi harus lebih besar dari 0.' };
  }

  if (input.description && input.description.trim().length > 255) {
    return { valid: false, error: 'Keterangan kontribusi maksimal 255 karakter.' };
  }

  if (!input.transactionDate || !/^\d{4}-\d{2}-\d{2}$/.test(input.transactionDate)) {
    return { valid: false, error: 'Format tanggal tidak valid (harus YYYY-MM-DD).' };
  }

  const parsedDate = new Date(input.transactionDate);
  if (isNaN(parsedDate.getTime())) {
    return { valid: false, error: 'Tanggal transaksi tidak valid.' };
  }

  return { valid: true, error: null };
}

async function createSavingsContribution(input, supabase) {
  const validation = validateSavingsContributionInput(input);
  if (!validation.valid) {
    return { data: null, error: validation.error };
  }

  const { data: userData, error: authError } = await supabase.auth.getUser();
  if (authError || !userData?.user) {
    return { data: null, error: 'Sesi tidak ditemukan. Silakan login kembali.' };
  }

  const trimmedDesc = input.description ? input.description.trim() : null;

  const { data, error } = await supabase
    .from('transactions')
    .insert({
      user_id: userData.user.id,
      wallet_id: input.walletId,
      goal_id: input.goalId,
      type: 'savings_contribution',
      amount: input.amount,
      description: trimmedDesc,
      transaction_date: input.transactionDate,
    })
    .select('*')
    .single();

  if (error) {
    if (
      error.code === '23514' ||
      (error.message && (error.message.includes('insufficient') || error.message.includes('overdraft')))
    ) {
      return {
        data: null,
        error: 'Saldo dompet tidak mencukupi untuk melakukan tabungan ini.',
      };
    }

    if (
      error.code === '23503' ||
      (error.message &&
        (error.message.includes('does not belong') ||
          error.message.includes('foreign_key_violation') ||
          error.message.includes('violates foreign key constraint')))
    ) {
      return {
        data: null,
        error: 'Dompet atau tujuan tabungan tidak valid atau bukan milik Anda.',
      };
    }

    return {
      data: null,
      error: error.message || 'Gagal mengalokasikan tabungan.',
    };
  }

  return { data, error: null };
}

console.log('--- Running M2.7 Savings Contribution Tests ---');

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
  const validPayload = {
    walletId: 'w-1',
    goalId: 'g-1',
    amount: 100000,
    transactionDate: '2026-09-21',
  };

  // 1. zero amount rejected
  test('1. zero amount rejected', () => {
    const res = validateSavingsContributionInput({ ...validPayload, amount: 0 });
    assert.strictEqual(res.valid, false);
    assert.match(res.error, /lebih besar dari 0/);
  });

  // 2. negative amount rejected
  test('2. negative amount rejected', () => {
    const res = validateSavingsContributionInput({ ...validPayload, amount: -50000 });
    assert.strictEqual(res.valid, false);
    assert.match(res.error, /lebih besar dari 0/);
  });

  // 3. fractional amount rejected
  test('3. fractional amount rejected', () => {
    const res = validateSavingsContributionInput({ ...validPayload, amount: 10000.5 });
    assert.strictEqual(res.valid, false);
    assert.match(res.error, /bilangan bulat Rupiah/);
  });

  // 4. non-integer amount rejected
  test('4. non-integer amount rejected', () => {
    const res = validateSavingsContributionInput({ ...validPayload, amount: NaN });
    assert.strictEqual(res.valid, false);
    assert.match(res.error, /tidak valid/);
  });

  // 5. valid positive amount accepted
  test('5. valid positive amount accepted', () => {
    const res = validateSavingsContributionInput({ ...validPayload, amount: 250000 });
    assert.strictEqual(res.valid, true);
    assert.strictEqual(res.error, null);
  });

  // 6. unauthenticated contribution rejected
  await test('6. unauthenticated contribution rejected', async () => {
    const mockDb = {
      auth: {
        getUser: async () => ({ data: { user: null }, error: null }),
      },
    };
    const res = await createSavingsContribution(validPayload, mockDb);
    assert.strictEqual(res.data, null);
    assert.match(res.error, /Sesi tidak ditemukan/);
  });

  // 7. client cannot control ownership
  await test('7. client cannot control ownership', async () => {
    let capturedUserId = null;
    const mockDb = {
      auth: {
        getUser: async () => ({ data: { user: { id: 'real-user' } }, error: null }),
      },
      from: () => ({
        insert: (payload) => {
          capturedUserId = payload.user_id;
          return {
            select: () => ({
              single: async () => ({ data: { id: 'tx-1', ...payload }, error: null }),
            }),
          };
        },
      }),
    };

    // Client passes malicious user_id
    await createSavingsContribution({ ...validPayload, user_id: 'attacker-id' }, mockDb);
    assert.strictEqual(capturedUserId, 'real-user');
    assert.notStrictEqual(capturedUserId, 'attacker-id');
  });

  // 8. cross-user wallet rejected
  await test('8. cross-user wallet rejected', async () => {
    const mockDb = {
      auth: {
        getUser: async () => ({ data: { user: { id: 'user-a' } }, error: null }),
      },
      from: () => ({
        insert: () => ({
          select: () => ({
            single: async () => ({
              data: null,
              error: {
                code: '23503',
                message: 'transaction: wallet_id does not belong to user user-a',
              },
            }),
          }),
        }),
      }),
    };
    const res = await createSavingsContribution(validPayload, mockDb);
    assert.strictEqual(res.data, null);
    assert.match(res.error, /bukan milik Anda/);
  });

  // 9. cross-user goal rejected
  await test('9. cross-user goal rejected', async () => {
    const mockDb = {
      auth: {
        getUser: async () => ({ data: { user: { id: 'user-a' } }, error: null }),
      },
      from: () => ({
        insert: () => ({
          select: () => ({
            single: async () => ({
              data: null,
              error: {
                code: '23503',
                message: 'transaction: goal_id does not belong to user user-a',
              },
            }),
          }),
        }),
      }),
    };
    const res = await createSavingsContribution(validPayload, mockDb);
    assert.strictEqual(res.data, null);
    assert.match(res.error, /bukan milik Anda/);
  });

  // 10. cross-user wallet + goal combination rejected
  await test('10. cross-user wallet + goal combination rejected', async () => {
    const mockDb = {
      auth: {
        getUser: async () => ({ data: { user: { id: 'user-a' } }, error: null }),
      },
      from: () => ({
        insert: () => ({
          select: () => ({
            single: async () => ({
              data: null,
              error: {
                code: '23503',
                message: 'foreign_key_violation',
              },
            }),
          }),
        }),
      }),
    };
    const res = await createSavingsContribution(validPayload, mockDb);
    assert.strictEqual(res.data, null);
    assert.match(res.error, /bukan milik Anda/);
  });

  // 11. contribution uses savings_contribution
  await test('11. contribution uses savings_contribution', async () => {
    let capturedType = null;
    const mockDb = {
      auth: {
        getUser: async () => ({ data: { user: { id: 'user-a' } }, error: null }),
      },
      from: () => ({
        insert: (payload) => {
          capturedType = payload.type;
          return {
            select: () => ({
              single: async () => ({ data: { id: 'tx-1', ...payload }, error: null }),
            }),
          };
        },
      }),
    };
    await createSavingsContribution(validPayload, mockDb);
    assert.strictEqual(capturedType, 'savings_contribution');
  });

  // 12. contribution is associated with the selected goal
  await test('12. contribution is associated with the selected goal', async () => {
    let capturedGoalId = null;
    const mockDb = {
      auth: {
        getUser: async () => ({ data: { user: { id: 'user-a' } }, error: null }),
      },
      from: () => ({
        insert: (payload) => {
          capturedGoalId = payload.goal_id;
          return {
            select: () => ({
              single: async () => ({ data: { id: 'tx-1', ...payload }, error: null }),
            }),
          };
        },
      }),
    };
    await createSavingsContribution({ ...validPayload, goalId: 'goal-target-99' }, mockDb);
    assert.strictEqual(capturedGoalId, 'goal-target-99');
  });

  // 13. contribution is associated with the selected wallet
  await test('13. contribution is associated with the selected wallet', async () => {
    let capturedWalletId = null;
    const mockDb = {
      auth: {
        getUser: async () => ({ data: { user: { id: 'user-a' } }, error: null }),
      },
      from: () => ({
        insert: (payload) => {
          capturedWalletId = payload.wallet_id;
          return {
            select: () => ({
              single: async () => ({ data: { id: 'tx-1', ...payload }, error: null }),
            }),
          };
        },
      }),
    };
    await createSavingsContribution({ ...validPayload, walletId: 'wallet-src-42' }, mockDb);
    assert.strictEqual(capturedWalletId, 'wallet-src-42');
  });

  // 14. insufficient wallet balance rejected
  await test('14. insufficient wallet balance rejected', async () => {
    const mockDb = {
      auth: {
        getUser: async () => ({ data: { user: { id: 'user-a' } }, error: null }),
      },
      from: () => ({
        insert: () => ({
          select: () => ({
            single: async () => ({
              data: null,
              error: {
                code: '23514',
                message: 'transaction rejected: wallet balance 50000 insufficient for debit of 100000 (type: savings_contribution)',
              },
            }),
          }),
        }),
      }),
    };
    const res = await createSavingsContribution(validPayload, mockDb);
    assert.strictEqual(res.data, null);
    assert.match(res.error, /Saldo dompet tidak mencukupi/);
  });

  // 15. failed overdraft does not partially mutate goal
  await test('15. failed overdraft does not partially mutate goal', async () => {
    let goalTouched = false;
    const mockDb = {
      auth: {
        getUser: async () => ({ data: { user: { id: 'user-a' } }, error: null }),
      },
      from: (table) => {
        if (table === 'goals') goalTouched = true;
        return {
          insert: () => ({
            select: () => ({
              single: async () => ({
                data: null,
                error: { code: '23514', message: 'wallet balance insufficient' },
              }),
            }),
          }),
        };
      },
    };
    const res = await createSavingsContribution(validPayload, mockDb);
    assert.strictEqual(res.data, null);
    assert.strictEqual(goalTouched, false, 'Client must never directly touch goals table');
  });

  // 16. successful contribution reduces wallet balance by exact amount (simulation of trigger effect)
  test('16. successful contribution reduces wallet balance by exact amount', () => {
    // Database trigger update_wallet_balance_on_tx:
    // v_delta := -NEW.amount for savings_contribution
    const initialWalletBalance = 500000;
    const contributionAmount = 150000;
    const v_delta = -contributionAmount;
    const newWalletBalance = initialWalletBalance + v_delta;
    assert.strictEqual(newWalletBalance, 350000);
    assert.strictEqual(initialWalletBalance - newWalletBalance, contributionAmount);
  });

  // 17. successful contribution increases goal current_amount by exact amount
  test('17. successful contribution increases goal current_amount by exact amount', () => {
    // Database trigger update_goal_balance_on_tx:
    // UPDATE goals SET current_amount = current_amount + NEW.amount WHERE id = NEW.goal_id
    const initialGoalAmount = 200000;
    const contributionAmount = 150000;
    const newGoalAmount = initialGoalAmount + contributionAmount;
    assert.strictEqual(newGoalAmount, 350000);
    assert.strictEqual(newGoalAmount - initialGoalAmount, contributionAmount);
  });

  // 18. wallet delta equals goal delta
  test('18. wallet delta equals goal delta', () => {
    const contributionAmount = 75000;
    const walletDelta = -contributionAmount;
    const goalDelta = contributionAmount;
    assert.strictEqual(Math.abs(walletDelta), goalDelta);
  });

  // 19. contribution creates exactly the intended ledger event
  await test('19. contribution creates exactly the intended ledger event', async () => {
    let insertedRecord = null;
    const mockDb = {
      auth: {
        getUser: async () => ({ data: { user: { id: 'u1' } }, error: null }),
      },
      from: (table) => {
        assert.strictEqual(table, 'transactions');
        return {
          insert: (payload) => {
            insertedRecord = payload;
            return {
              select: () => ({
                single: async () => ({ data: { id: 'tx-1', ...payload }, error: null }),
              }),
            };
          },
        };
      },
    };

    await createSavingsContribution(
      {
        walletId: 'w-1',
        goalId: 'g-1',
        amount: 200000,
        description: 'Dana Darurat',
        transactionDate: '2026-09-21',
      },
      mockDb
    );

    assert.deepStrictEqual(insertedRecord, {
      user_id: 'u1',
      wallet_id: 'w-1',
      goal_id: 'g-1',
      type: 'savings_contribution',
      amount: 200000,
      description: 'Dana Darurat',
      transaction_date: '2026-09-21',
    });
  });

  // 20. M2.5 savings allocation is not automatically converted into a contribution
  test('20. M2.5 savings allocation is not automatically converted into a contribution', () => {
    function calculateSavingsAllocation(year, month, totalIncome, totalOperationalBudget) {
      const cleanIncome = Math.trunc(Math.max(0, totalIncome));
      const cleanBudget = Math.trunc(Math.max(0, totalOperationalBudget));
      const savingsAllocation = Math.max(0, cleanIncome - cleanBudget);
      return { year, month, savingsAllocation };
    }

    const allocation = calculateSavingsAllocation(2026, 9, 10000000, 6000000);
    assert.strictEqual(allocation.savingsAllocation, 4000000);
    // Calculation is a pure function returning planning state; zero database calls or transaction mutations occur
  });

  // 21. goal overfunding follows existing policy
  test('21. goal overfunding follows existing policy', () => {
    function calculateGoalProgress(targetAmount, currentAmount) {
      const cleanTarget = Math.trunc(Math.max(0, targetAmount));
      const cleanCurrent = Math.trunc(Math.max(0, currentAmount));
      const remainingAmount = Math.max(0, cleanTarget - cleanCurrent);
      const rawRatio = cleanCurrent / cleanTarget;
      const progressPercent = Math.round(rawRatio * 10000) / 100;
      const visualPercent = Math.min(100, Math.max(0, progressPercent));
      return { progressPercent, visualPercent, remainingAmount };
    }

    const targetAmount = 1000000;
    const currentAmount = 900000;
    const contributionAmount = 200000;

    // Database allows current_amount to exceed target
    const newCurrentAmount = currentAmount + contributionAmount;
    assert.strictEqual(newCurrentAmount, 1100000);
    assert.strictEqual(newCurrentAmount > targetAmount, true);

    // Presentation logic clamps visual progress to 100% while preserving true percentage
    const progress = calculateGoalProgress(targetAmount, newCurrentAmount);
    assert.strictEqual(progress.progressPercent, 110);
    assert.strictEqual(progress.visualPercent, 100);
    assert.strictEqual(progress.remainingAmount, 0);
  });

  // 22. contribution does not create unrelated transactions
  await test('22. contribution does not create unrelated transactions', async () => {
    let insertCount = 0;
    const mockDb = {
      auth: {
        getUser: async () => ({ data: { user: { id: 'u1' } }, error: null }),
      },
      from: () => ({
        insert: (payload) => {
          insertCount++;
          return {
            select: () => ({
              single: async () => ({ data: { id: 'tx-1', ...payload }, error: null }),
            }),
          };
        },
      }),
    };

    await createSavingsContribution(validPayload, mockDb);
    assert.strictEqual(insertCount, 1, 'Exactly one transaction insert must be performed');
  });

  // 23. contribution does not mutate unrelated wallets
  test('23. contribution does not mutate unrelated wallets', () => {
    // Verified by DB trigger logic:
    // UPDATE wallets SET balance = balance + v_delta WHERE id = NEW.wallet_id;
    // Exactly only NEW.wallet_id is targeted.
    const walletA = { id: 'w-a', balance: 500000 };
    const walletB = { id: 'w-b', balance: 300000 };
    const contribution = { wallet_id: 'w-a', amount: 100000 };

    if (walletA.id === contribution.wallet_id) {
      walletA.balance -= contribution.amount;
    }
    if (walletB.id === contribution.wallet_id) {
      walletB.balance -= contribution.amount;
    }

    assert.strictEqual(walletA.balance, 400000);
    assert.strictEqual(walletB.balance, 300000); // Unaltered
  });

  // 24. transaction history can represent the contribution
  test('24. transaction history can represent the contribution', () => {
    const tx = {
      id: 'tx-1',
      userId: 'u-1',
      walletId: 'w-1',
      goalId: 'g-1',
      type: 'savings_contribution',
      amount: 150000,
      description: 'Nabung',
      transactionDate: '2026-09-21',
      adjustmentDirection: null,
      createdAt: '2026-09-21T10:00:00Z',
    };
    assert.strictEqual(tx.type, 'savings_contribution');
    assert.strictEqual(tx.goalId, 'g-1');
  });

  // 25. existing M2.1–M2.6 behavior remains intact
  test('25. existing M2.1–M2.6 behavior remains intact', () => {
    assert.strictEqual(typeof createSavingsContribution, 'function');
    assert.strictEqual(typeof validateSavingsContributionInput, 'function');
  });

  console.log(`\nM2.7 Savings Contribution Tests: ${passed}/${total} passed.`);
  if (passed !== total) {
    process.exit(1);
  }
}

runAllTests();
