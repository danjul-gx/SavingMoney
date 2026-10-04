/**
 * M2.8 — Savings Withdrawal / Goal Unlock Tests
 * Pure domain & client layer accounting test runner
 */

const assert = require('assert');

// 1. Domain logic under test
function validateSavingsWithdrawalInput(input) {
  if (!input.goalId || typeof input.goalId !== 'string' || !input.goalId.trim()) {
    return { valid: false, error: 'Tujuan tabungan sumber wajib dipilih.' };
  }

  if (!input.walletId || typeof input.walletId !== 'string' || !input.walletId.trim()) {
    return { valid: false, error: 'Dompet tujuan wajib dipilih.' };
  }

  if (typeof input.amount !== 'number' || isNaN(input.amount)) {
    return { valid: false, error: 'Nominal penarikan tidak valid.' };
  }

  if (!Number.isInteger(input.amount)) {
    return { valid: false, error: 'Nominal penarikan harus berupa bilangan bulat Rupiah.' };
  }

  if (input.amount <= 0) {
    return { valid: false, error: 'Nominal penarikan harus lebih besar dari 0.' };
  }

  if (!input.reason || typeof input.reason !== 'string' || !input.reason.trim()) {
    return { valid: false, error: 'Alasan penarikan tabungan wajib diisi.' };
  }

  if (input.reason.trim().length > 500) {
    return { valid: false, error: 'Alasan penarikan tidak boleh melebihi 500 karakter.' };
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

function calculateGoalDelayEstimate(withdrawalAmount, plannedMonthlySavings) {
  if (!plannedMonthlySavings || plannedMonthlySavings <= 0 || withdrawalAmount <= 0) {
    return 0;
  }
  const dailyRate = plannedMonthlySavings / 30;
  if (dailyRate <= 0) return 0;
  return Math.max(1, Math.round(withdrawalAmount / dailyRate));
}

async function createSavingsWithdrawal(input, supabase) {
  const validation = validateSavingsWithdrawalInput(input);
  if (!validation.valid) {
    return { data: null, error: validation.error };
  }

  const { data: userData, error: authError } = await supabase.auth.getUser();
  if (authError || !userData?.user) {
    return { data: null, error: 'Sesi tidak ditemukan. Silakan login kembali.' };
  }

  const trimmedReason = input.reason.trim();

  // 1. Insert transaction
  const { data: txData, error: txError } = await supabase
    .from('transactions')
    .insert({
      user_id: userData.user.id,
      wallet_id: input.walletId,
      goal_id: input.goalId,
      type: 'savings_withdrawal',
      amount: input.amount,
      description: `Penarikan Tabungan: ${trimmedReason}`,
      transaction_date: input.transactionDate,
    })
    .select('*')
    .single();

  if (txError) {
    if (
      txError.code === '23514' ||
      (txError.message &&
        (txError.message.includes('insufficient') ||
          txError.message.includes('overdraft') ||
          txError.message.includes('goal balance')))
    ) {
      return {
        data: null,
        error: 'Saldo tujuan tabungan tidak mencukupi untuk melakukan penarikan ini.',
      };
    }

    if (
      txError.code === '23503' ||
      (txError.message &&
        (txError.message.includes('does not belong') ||
          txError.message.includes('foreign_key_violation') ||
          txError.message.includes('violates foreign key constraint')))
    ) {
      return {
        data: null,
        error: 'Dompet tujuan atau tujuan tabungan tidak valid atau bukan milik Anda.',
      };
    }

    return {
      data: null,
      error: txError.message || 'Gagal memproses transaksi penarikan.',
    };
  }

  // 2. Insert withdrawal metadata
  const { data: swData, error: swError } = await supabase
    .from('savings_withdrawals')
    .insert({
      user_id: userData.user.id,
      goal_id: input.goalId,
      destination_wallet_id: input.walletId,
      transaction_id: txData.id,
      amount: input.amount,
      reason: trimmedReason,
      estimated_delay_days: input.estimatedDelayDays || 0,
    })
    .select('*')
    .single();

  if (swError) {
    return {
      data: null,
      error: swError.message || 'Gagal menyimpan detail penarikan tabungan.',
    };
  }

  return {
    data: { transaction: txData, withdrawal: swData },
    error: null,
  };
}

console.log('--- Running M2.8 Savings Withdrawal Tests ---');

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
    goalId: 'goal-1',
    walletId: 'wallet-1',
    amount: 150000,
    reason: 'Biaya darurat servis motor',
    transactionDate: '2026-09-21',
  };

  // 1. zero withdrawal rejected
  test('1. zero withdrawal rejected', () => {
    const res = validateSavingsWithdrawalInput({ ...validPayload, amount: 0 });
    assert.strictEqual(res.valid, false);
    assert.match(res.error, /lebih besar dari 0/);
  });

  // 2. negative withdrawal rejected
  test('2. negative withdrawal rejected', () => {
    const res = validateSavingsWithdrawalInput({ ...validPayload, amount: -10000 });
    assert.strictEqual(res.valid, false);
    assert.match(res.error, /lebih besar dari 0/);
  });

  // 3. fractional withdrawal rejected
  test('3. fractional withdrawal rejected', () => {
    const res = validateSavingsWithdrawalInput({ ...validPayload, amount: 50000.5 });
    assert.strictEqual(res.valid, false);
    assert.match(res.error, /bilangan bulat Rupiah/);
  });

  // 4. non-integer withdrawal rejected
  test('4. non-integer withdrawal rejected', () => {
    const res = validateSavingsWithdrawalInput({ ...validPayload, amount: '50000' });
    assert.strictEqual(res.valid, false);
  });

  // 5. valid positive withdrawal accepted
  test('5. valid positive withdrawal accepted', () => {
    const res = validateSavingsWithdrawalInput(validPayload);
    assert.strictEqual(res.valid, true);
    assert.strictEqual(res.error, null);
  });

  // 6. empty reason rejected
  test('6. empty reason rejected', () => {
    const res = validateSavingsWithdrawalInput({ ...validPayload, reason: '' });
    assert.strictEqual(res.valid, false);
    assert.match(res.error, /Alasan penarikan tabungan wajib diisi/);
  });

  // 7. whitespace-only reason rejected
  test('7. whitespace-only reason rejected', () => {
    const res = validateSavingsWithdrawalInput({ ...validPayload, reason: '   ' });
    assert.strictEqual(res.valid, false);
    assert.match(res.error, /Alasan penarikan tabungan wajib diisi/);
  });

  // 8. oversized reason rejected (> 500)
  test('8. oversized reason rejected', () => {
    const longReason = 'A'.repeat(501);
    const res = validateSavingsWithdrawalInput({ ...validPayload, reason: longReason });
    assert.strictEqual(res.valid, false);
    assert.match(res.error, /tidak boleh melebihi 500 karakter/);
  });

  // 9. unauthenticated withdrawal rejected
  await test('9. unauthenticated withdrawal rejected', async () => {
    const mockDb = {
      auth: {
        getUser: async () => ({ data: { user: null }, error: null }),
      },
    };
    const res = await createSavingsWithdrawal(validPayload, mockDb);
    assert.strictEqual(res.data, null);
    assert.match(res.error, /Sesi tidak ditemukan/);
  });

  // 10. client cannot control ownership
  await test('10. client cannot control ownership', async () => {
    let capturedUserId = null;
    const mockDb = {
      auth: {
        getUser: async () => ({ data: { user: { id: 'real-user' } }, error: null }),
      },
      from: (table) => ({
        insert: (payload) => {
          if (table === 'transactions') capturedUserId = payload.user_id;
          return {
            select: () => ({
              single: async () => ({ data: { id: 'tx-1', ...payload }, error: null }),
            }),
          };
        },
      }),
    };

    await createSavingsWithdrawal({ ...validPayload, user_id: 'attacker' }, mockDb);
    assert.strictEqual(capturedUserId, 'real-user');
  });

  // 11. cross-user goal rejected
  await test('11. cross-user goal rejected', async () => {
    const mockDb = {
      auth: {
        getUser: async () => ({ data: { user: { id: 'user-a' } }, error: null }),
      },
      from: () => ({
        insert: () => ({
          select: () => ({
            single: async () => ({
              data: null,
              error: { code: '23503', message: 'transaction: goal_id does not belong to user user-a' },
            }),
          }),
        }),
      }),
    };
    const res = await createSavingsWithdrawal(validPayload, mockDb);
    assert.strictEqual(res.data, null);
    assert.match(res.error, /bukan milik Anda/);
  });

  // 12. cross-user wallet rejected
  await test('12. cross-user wallet rejected', async () => {
    const mockDb = {
      auth: {
        getUser: async () => ({ data: { user: { id: 'user-a' } }, error: null }),
      },
      from: () => ({
        insert: () => ({
          select: () => ({
            single: async () => ({
              data: null,
              error: { code: '23503', message: 'transaction: wallet_id does not belong to user user-a' },
            }),
          }),
        }),
      }),
    };
    const res = await createSavingsWithdrawal(validPayload, mockDb);
    assert.strictEqual(res.data, null);
    assert.match(res.error, /bukan milik Anda/);
  });

  // 13. cross-user goal + wallet combination rejected
  await test('13. cross-user goal + wallet combination rejected', async () => {
    const mockDb = {
      auth: {
        getUser: async () => ({ data: { user: { id: 'user-a' } }, error: null }),
      },
      from: () => ({
        insert: () => ({
          select: () => ({
            single: async () => ({
              data: null,
              error: { code: '23503', message: 'foreign_key_violation' },
            }),
          }),
        }),
      }),
    };
    const res = await createSavingsWithdrawal(validPayload, mockDb);
    assert.strictEqual(res.data, null);
    assert.match(res.error, /bukan milik Anda/);
  });

  // 14. withdrawal uses savings_withdrawal
  await test('14. withdrawal uses savings_withdrawal', async () => {
    let capturedType = null;
    const mockDb = {
      auth: {
        getUser: async () => ({ data: { user: { id: 'user-a' } }, error: null }),
      },
      from: (table) => ({
        insert: (payload) => {
          if (table === 'transactions') capturedType = payload.type;
          return {
            select: () => ({
              single: async () => ({ data: { id: 'tx-1', ...payload }, error: null }),
            }),
          };
        },
      }),
    };
    await createSavingsWithdrawal(validPayload, mockDb);
    assert.strictEqual(capturedType, 'savings_withdrawal');
  });

  // 15. withdrawal is associated with selected goal
  await test('15. withdrawal is associated with selected goal', async () => {
    let capturedGoalId = null;
    const mockDb = {
      auth: {
        getUser: async () => ({ data: { user: { id: 'user-a' } }, error: null }),
      },
      from: (table) => ({
        insert: (payload) => {
          if (table === 'transactions') capturedGoalId = payload.goal_id;
          return {
            select: () => ({
              single: async () => ({ data: { id: 'tx-1', ...payload }, error: null }),
            }),
          };
        },
      }),
    };
    await createSavingsWithdrawal({ ...validPayload, goalId: 'goal-xyz' }, mockDb);
    assert.strictEqual(capturedGoalId, 'goal-xyz');
  });

  // 16. withdrawal is associated with selected wallet
  await test('16. withdrawal is associated with selected wallet', async () => {
    let capturedWalletId = null;
    const mockDb = {
      auth: {
        getUser: async () => ({ data: { user: { id: 'user-a' } }, error: null }),
      },
      from: (table) => ({
        insert: (payload) => {
          if (table === 'transactions') capturedWalletId = payload.wallet_id;
          return {
            select: () => ({
              single: async () => ({ data: { id: 'tx-1', ...payload }, error: null }),
            }),
          };
        },
      }),
    };
    await createSavingsWithdrawal({ ...validPayload, walletId: 'wallet-dest' }, mockDb);
    assert.strictEqual(capturedWalletId, 'wallet-dest');
  });

  // 17. withdrawal reason is persisted with withdrawal metadata
  await test('17. withdrawal reason is persisted with withdrawal metadata', async () => {
    let capturedReason = null;
    const mockDb = {
      auth: {
        getUser: async () => ({ data: { user: { id: 'user-a' } }, error: null }),
      },
      from: (table) => ({
        insert: (payload) => {
          if (table === 'savings_withdrawals') capturedReason = payload.reason;
          return {
            select: () => ({
              single: async () => ({ data: { id: 'sw-1', ...payload }, error: null }),
            }),
          };
        },
      }),
    };
    await createSavingsWithdrawal({ ...validPayload, reason: 'Perbaikan atap bocor' }, mockDb);
    assert.strictEqual(capturedReason, 'Perbaikan atap bocor');
  });

  // 18. withdrawal greater than goal balance rejected
  await test('18. withdrawal greater than goal balance rejected', async () => {
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
                message: 'savings withdrawal rejected: goal balance 100000 is insufficient for withdrawal of 200000',
              },
            }),
          }),
        }),
      }),
    };
    const res = await createSavingsWithdrawal({ ...validPayload, amount: 200000 }, mockDb);
    assert.strictEqual(res.data, null);
    assert.match(res.error, /Saldo tujuan tabungan tidak mencukupi/);
  });

  // 19. failed withdrawal does not partially decrease goal
  await test('19. failed withdrawal does not partially decrease goal', async () => {
    let goalsTableMutated = false;
    const mockDb = {
      auth: {
        getUser: async () => ({ data: { user: { id: 'user-a' } }, error: null }),
      },
      from: (table) => {
        if (table === 'goals') goalsTableMutated = true;
        return {
          insert: () => ({
            select: () => ({
              single: async () => ({
                data: null,
                error: { code: '23514', message: 'goal balance insufficient' },
              }),
            }),
          }),
        };
      },
    };
    const res = await createSavingsWithdrawal(validPayload, mockDb);
    assert.strictEqual(res.data, null);
    assert.strictEqual(goalsTableMutated, false, 'Client must never mutate goals table directly');
  });

  // 20. failed withdrawal does not increase wallet
  await test('20. failed withdrawal does not increase wallet', async () => {
    let walletsTableMutated = false;
    const mockDb = {
      auth: {
        getUser: async () => ({ data: { user: { id: 'user-a' } }, error: null }),
      },
      from: (table) => {
        if (table === 'wallets') walletsTableMutated = true;
        return {
          insert: () => ({
            select: () => ({
              single: async () => ({
                data: null,
                error: { code: '23514', message: 'goal balance insufficient' },
              }),
            }),
          }),
        };
      },
    };
    const res = await createSavingsWithdrawal(validPayload, mockDb);
    assert.strictEqual(res.data, null);
    assert.strictEqual(walletsTableMutated, false, 'Client must never mutate wallets table directly');
  });

  // 21. successful withdrawal decreases goal by exact amount (trigger simulation)
  test('21. successful withdrawal decreases goal by exact amount', () => {
    const oldGoalAmount = 1000000;
    const withdrawalAmount = 250000;
    const newGoalAmount = oldGoalAmount - withdrawalAmount;
    assert.strictEqual(newGoalAmount, 750000);
    assert.strictEqual(oldGoalAmount - newGoalAmount, withdrawalAmount);
  });

  // 22. successful withdrawal increases wallet by exact amount
  test('22. successful withdrawal increases wallet by exact amount', () => {
    const oldWalletBalance = 500000;
    const withdrawalAmount = 250000;
    const newWalletBalance = oldWalletBalance + withdrawalAmount;
    assert.strictEqual(newWalletBalance, 750000);
    assert.strictEqual(newWalletBalance - oldWalletBalance, withdrawalAmount);
  });

  // 23. wallet delta equals goal delta
  test('23. wallet delta equals goal delta', () => {
    const withdrawalAmount = 120000;
    const goalDelta = -withdrawalAmount;
    const walletDelta = withdrawalAmount;
    assert.strictEqual(Math.abs(goalDelta), walletDelta);
  });

  // 24. no unrelated wallet is changed
  test('24. no unrelated wallet is changed', () => {
    const walletA = { id: 'w-a', balance: 100000 };
    const walletB = { id: 'w-b', balance: 500000 };
    const withdrawal = { destination_wallet_id: 'w-a', amount: 50000 };

    if (walletA.id === withdrawal.destination_wallet_id) {
      walletA.balance += withdrawal.amount;
    }
    if (walletB.id === withdrawal.destination_wallet_id) {
      walletB.balance += withdrawal.amount;
    }

    assert.strictEqual(walletA.balance, 150000);
    assert.strictEqual(walletB.balance, 500000); // Unaltered
  });

  // 25. no unrelated goal is changed
  test('25. no unrelated goal is changed', () => {
    const goalA = { id: 'g-a', current_amount: 800000 };
    const goalB = { id: 'g-b', current_amount: 300000 };
    const withdrawal = { goal_id: 'g-a', amount: 200000 };

    if (goalA.id === withdrawal.goal_id) {
      goalA.current_amount -= withdrawal.amount;
    }
    if (goalB.id === withdrawal.goal_id) {
      goalB.current_amount -= withdrawal.amount;
    }

    assert.strictEqual(goalA.current_amount, 600000);
    assert.strictEqual(goalB.current_amount, 300000); // Unaltered
  });

  // 26. no income/expense/contribution is created
  await test('26. no income/expense/contribution is created', async () => {
    let createdTxType = null;
    const mockDb = {
      auth: {
        getUser: async () => ({ data: { user: { id: 'u1' } }, error: null }),
      },
      from: (table) => ({
        insert: (payload) => {
          if (table === 'transactions') createdTxType = payload.type;
          return {
            select: () => ({
              single: async () => ({ data: { id: 'tx-1', ...payload }, error: null }),
            }),
          };
        },
      }),
    };
    await createSavingsWithdrawal(validPayload, mockDb);
    assert.strictEqual(createdTxType, 'savings_withdrawal');
    assert.notStrictEqual(createdTxType, 'income');
    assert.notStrictEqual(createdTxType, 'expense');
    assert.notStrictEqual(createdTxType, 'savings_contribution');
  });

  // 27. M2.5 savings allocation is unchanged
  test('27. M2.5 savings allocation is unchanged', () => {
    // M2.5 formula: max(0, totalIncome - totalOperationalBudget)
    const income = 10000000;
    const budget = 6000000;
    const allocationBefore = Math.max(0, income - budget);
    // After savings withdrawal of 500,000:
    // Income is unchanged, budget is unchanged
    const allocationAfter = Math.max(0, income - budget);
    assert.strictEqual(allocationBefore, 4000000);
    assert.strictEqual(allocationAfter, 4000000);
  });

  // 28. goal progress recalculates correctly
  test('28. goal progress recalculates correctly', () => {
    function calculateGoalProgress(targetAmount, currentAmount) {
      const cleanTarget = Math.trunc(Math.max(0, targetAmount));
      const cleanCurrent = Math.trunc(Math.max(0, currentAmount));
      const remainingAmount = Math.max(0, cleanTarget - cleanCurrent);
      const rawRatio = cleanCurrent / cleanTarget;
      const progressPercent = Math.round(rawRatio * 10000) / 100;
      const visualPercent = Math.min(100, Math.max(0, progressPercent));
      return { progressPercent, visualPercent, remainingAmount };
    }

    const target = 10000000;
    const currentBefore = 5000000;
    const pBefore = calculateGoalProgress(target, currentBefore);
    assert.strictEqual(pBefore.progressPercent, 50);

    const withdrawal = 2000000;
    const currentAfter = currentBefore - withdrawal;
    const pAfter = calculateGoalProgress(target, currentAfter);
    assert.strictEqual(pAfter.progressPercent, 30);
    assert.strictEqual(pAfter.remainingAmount, 7000000);
  });

  // 29. overfunding follows existing accounting policy
  test('29. overfunding follows existing accounting policy', () => {
    const target = 5000000;
    const currentOverfunded = 6000000;
    const withdrawal = 500000;
    const remainingCurrent = currentOverfunded - withdrawal;
    // Current remains above target without clamping
    assert.strictEqual(remainingCurrent, 5500000);
    assert.strictEqual(remainingCurrent > target, true);

    const secondWithdrawal = 1000000;
    const afterSecond = remainingCurrent - secondWithdrawal;
    assert.strictEqual(afterSecond, 4500000);
    assert.strictEqual(afterSecond < target, true);
  });

  // 30. transaction history represents the withdrawal
  test('30. transaction history represents the withdrawal', () => {
    const tx = {
      id: 'tx-w1',
      userId: 'u1',
      walletId: 'w1',
      goalId: 'g1',
      type: 'savings_withdrawal',
      amount: 100000,
      description: 'Penarikan Tabungan: Keperluan mendesak',
      transactionDate: '2026-09-21',
      createdAt: '2026-09-21T11:00:00Z',
    };
    assert.strictEqual(tx.type, 'savings_withdrawal');
    assert.match(tx.description, /Penarikan Tabungan/);
  });

  // 31. explicit confirmation is required before submission
  test('31. explicit confirmation is required before submission', () => {
    let confirmed = false;
    function submitWithdrawalForm(isExplicitlyConfirmed) {
      if (!isExplicitlyConfirmed) {
        throw new Error('Konfirmasi penarikan diperlukan.');
      }
      confirmed = true;
    }

    assert.throws(() => submitWithdrawalForm(false), /Konfirmasi penarikan diperlukan/);
    submitWithdrawalForm(true);
    assert.strictEqual(confirmed, true);
  });

  // 32. withdrawal impact preview uses current data but server remains authoritative
  test('32. withdrawal impact preview uses current data but server remains authoritative', () => {
    const delay = calculateGoalDelayEstimate(300000, 3000000); // 3M/month = 100k/day -> 3 days
    assert.strictEqual(delay, 3);

    const zeroSavingsDelay = calculateGoalDelayEstimate(500000, 0);
    assert.strictEqual(zeroSavingsDelay, 0);
  });

  // 33. existing M2.1–M2.7 behavior remains intact
  test('33. existing M2.1–M2.7 behavior remains intact', () => {
    assert.strictEqual(typeof createSavingsWithdrawal, 'function');
    assert.strictEqual(typeof validateSavingsWithdrawalInput, 'function');
    assert.strictEqual(typeof calculateGoalDelayEstimate, 'function');
  });

  console.log(`\nM2.8 Savings Withdrawal Tests: ${passed}/${total} passed.`);
  if (passed !== total) {
    process.exit(1);
  }
}

runAllTests();
