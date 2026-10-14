import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { ciDatabaseConfig, SqlSession } from './db-concurrency-session.mjs';
import { workerLifecycleScenarios } from './db-worker-lifecycle-scenarios.mjs';

// CONV-002/003/004, OCR-001: CI-only multi-session metadata tests, no documents.
let stage = 'ephemeral CI target validation';
let passed = 0;

const track = (promise) => {
  const operation = { done: false, promise };
  promise.then(
    () => {
      operation.done = true;
    },
    () => {
      operation.done = true;
    },
  );
  return operation;
};

const expectDenial = (call, code = '42501', message = 'WORKSPACE_ACCESS_DENIED') => `
  do $test$ begin
    perform ${call};
    raise exception 'EXPECTED_DENIAL_MISSING';
  exception when sqlstate '${code}' then
    if sqlerrm <> '${message}' then raise exception 'UNEXPECTED_DENIAL'; end if;
  end $test$;
  select 'denied';`;

const run = async () => {
  // Refuse before even inspecting containers. No local or hosted database fallback.
  if (process.env.CI !== 'true' || process.env.GITHUB_ACTIONS !== 'true') {
    throw new Error('CI_DATABASE_REQUIRED');
  }
  const configFile = await readFile(
    new URL('../packages/db/supabase/config.toml', import.meta.url),
    'utf8',
  );
  const port = Number(configFile.match(/\[db\][\s\S]*?^port = (\d+)$/mu)?.[1]);
  assert.ok(Number.isInteger(port) && port > 1024 && port <= 65535);
  const status = JSON.parse(
    execFileSync(
      'pnpm',
      ['--filter', '@pdfmason/db', 'exec', 'supabase', 'status', '--output', 'json'],
      { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 131072 },
    ).toString(),
  );
  const config = ciDatabaseConfig(process.env, status.DB_URL, port);

  const fixture = async (label, action, limit = 10) => {
    stage = label;
    const owner = randomUUID();
    const admin = new SqlSession(config);
    const sessions = [];
    try {
      await admin.query(`set statement_timeout = '15s';
        insert into auth.users(id, email, email_confirmed_at)
        values ('${owner}', '${owner}@example.invalid', now());
        update public.entitlement_snapshots set enabled = true, limit_value = ${limit}, limit_unit = 'jobs'
        where workspace_id in (select id from public.workspaces where owner_user_id = '${owner}')
          and feature_key = 'cloud.demo.integrity';`);
      const workspace = await admin.query(
        `select id from public.workspaces where owner_user_id = '${owner}';`,
      );
      assert.match(workspace, /^[a-f0-9-]{36}$/u);
      const session = async (role = 'service_role', isolation = 'read committed') => {
        assert.ok(['service_role', 'postgres'].includes(role));
        assert.ok(['read committed', 'repeatable read'].includes(isolation));
        const connection = new SqlSession(config);
        sessions.push(connection);
        const pid = Number(await connection.query('select pg_backend_pid();'));
        assert.ok(Number.isInteger(pid) && pid > 0);
        await connection.query(`begin isolation level ${isolation}; set local role ${role};
          set local statement_timeout = '15s'; set local lock_timeout = '12s';
          set local idle_in_transaction_session_timeout = '30s';`);
        return { connection, pid };
      };
      const reserve = (key = 'concurrency-original-request', options = '{}', hours = 1) =>
        `public.create_cloud_job_with_reservation('${workspace}', '${owner}',
          'demo.integrity', '1.0.0', '${options}'::jsonb, '${key}', 'cloud.demo.integrity',
          1, 'jobs', to_char(now(), 'YYYY-MM'), now() + interval '${hours} hours')`;
      const deletion = `public.request_account_deletion('${workspace}', '${owner}', 'concurrency-account-delete')`;
      const revoke = (mode) =>
        mode === 'delete'
          ? `delete from public.workspace_members where workspace_id = '${workspace}' and user_id = '${owner}';`
          : `update public.workspace_members set status = 'removed' where workspace_id = '${workspace}' and user_id = '${owner}';`;
      const blocked = async (operation, waiter, blocker) => {
        const deadline = Date.now() + 10000;
        while (Date.now() < deadline) {
          if (operation.done) throw new Error('EXPECTED_LOCK_WAIT_MISSING');
          const observed = await admin.query(`select exists(select 1 from pg_stat_activity
            where pid = ${waiter} and wait_event_type = 'Lock'
              and ${blocker} = any(pg_blocking_pids(pid)));`);
          if (observed === 't') return;
          await delay(50);
        }
        throw new Error('EXPECTED_LOCK_WAIT_TIMED_OUT');
      };
      const snapshot = async () =>
        JSON.parse(
          await admin.query(`select json_build_object(
        'state', (select status from public.workspaces where id = '${workspace}'),
        'jobs', (select count(*) from public.jobs where workspace_id = '${workspace}'),
        'reserved', (select coalesce(sum(quantity),0) from public.usage_ledger
          where workspace_id = '${workspace}' and status = 'reserved'),
        'released', (select coalesce(sum(quantity),0) from public.usage_ledger
          where workspace_id = '${workspace}' and status = 'released'))::text;`),
        );
      await action({
        admin,
        session,
        reserve,
        deletion,
        revoke,
        blocked,
        snapshot,
        workspace,
        owner,
      });
      passed += 1;
      console.log(`PASS ${label}`);
    } finally {
      // Disconnect rolls back unfinished transactions and releases all barriers.
      await Promise.all(sessions.map((connection) => connection.terminate()));
      try {
        await admin.query(`delete from auth.users where id = '${owner}';`);
      } finally {
        await admin.terminate();
      }
    }
  };

  for (const conflict of [false, true]) {
    await fixture(
      conflict ? 'same-key conflicting request' : 'same-key identical replay',
      async (f) => {
        const a = await f.session();
        const b = await f.session();
        const first = await a.connection.query(`select ${f.reserve()};`);
        const deadline = await a.connection.query(
          `select delete_after::text from public.jobs where id = '${first}';`,
        );
        const waiting = track(
          b.connection.query(
            conflict
              ? expectDenial(f.reserve(undefined, '{"flag":true}'), '22023', 'IDEMPOTENCY_CONFLICT')
              : `select ${f.reserve(undefined, '{}', 2)};`,
          ),
        );
        await f.blocked(waiting, b.pid, a.pid);
        await a.connection.query('commit;');
        assert.equal(await waiting.promise, conflict ? 'denied' : first);
        await b.connection.query('commit;');
        assert.equal((await f.snapshot()).jobs, 1);
        assert.equal((await f.snapshot()).reserved, 1);
        assert.equal(
          await f.admin.query(`select delete_after::text from public.jobs where id = '${first}';`),
          deadline,
        );
      },
    );
  }

  for (const rollback of [false, true]) {
    await fixture(
      rollback ? 'quota contention after rollback' : 'quota contention after commit',
      async (f) => {
        const a = await f.session();
        const b = await f.session();
        await a.connection.query(`select ${f.reserve('concurrency-quota-first')};`);
        const waiting = track(
          b.connection.query(
            rollback
              ? `select ${f.reserve('concurrency-quota-second')};`
              : expectDenial(f.reserve('concurrency-quota-second'), 'P0001', 'QUOTA_EXCEEDED'),
          ),
        );
        await f.blocked(waiting, b.pid, a.pid);
        await a.connection.query(rollback ? 'rollback;' : 'commit;');
        const result = await waiting.promise;
        if (rollback) assert.match(result, /^[a-f0-9-]{36}$/u);
        else assert.equal(result, 'denied');
        await b.connection.query('commit;');
        assert.equal((await f.snapshot()).jobs, 1);
        assert.equal((await f.snapshot()).reserved, 1);
      },
      1,
    );
  }

  for (const mode of ['update', 'delete']) {
    for (const reservationFirst of [false, true]) {
      await fixture(
        `membership ${mode}: ${reservationFirst ? 'reservation' : 'revocation'} first`,
        async (f) => {
          const reservation = await f.session();
          const revocation = await f.session('postgres');
          if (reservationFirst) {
            await reservation.connection.query(`select ${f.reserve()};`);
            const waiting = track(revocation.connection.query(f.revoke(mode)));
            await f.blocked(waiting, revocation.pid, reservation.pid);
            await reservation.connection.query('commit;');
            await waiting.promise;
            await revocation.connection.query('commit;');
            assert.equal((await f.snapshot()).jobs, 1);
          } else {
            await revocation.connection.query(f.revoke(mode));
            const waiting = track(reservation.connection.query(expectDenial(f.reserve())));
            await f.blocked(waiting, reservation.pid, revocation.pid);
            await revocation.connection.query('commit;');
            assert.equal(await waiting.promise, 'denied');
            await reservation.connection.query('commit;');
            assert.equal((await f.snapshot()).jobs, 0);
          }
          const retry = await f.session();
          assert.equal(await retry.connection.query(expectDenial(f.reserve())), 'denied');
          await retry.connection.query('commit;');
        },
      );
    }
  }

  await fixture('membership revocation rollback', async (f) => {
    const a = await f.session('postgres');
    const b = await f.session();
    await a.connection.query(f.revoke('update'));
    const waiting = track(b.connection.query(`select ${f.reserve()};`));
    await f.blocked(waiting, b.pid, a.pid);
    await a.connection.query('rollback;');
    assert.match(await waiting.promise, /^[a-f0-9-]{36}$/u);
    await b.connection.query('commit;');
    assert.equal((await f.snapshot()).reserved, 1);
  });

  for (const reservationFirst of [false, true]) {
    await fixture(
      `account deletion: ${reservationFirst ? 'reservation' : 'deletion'} first`,
      async (f) => {
        const reservation = await f.session();
        const deletion = await f.session();
        if (reservationFirst) {
          const job = await reservation.connection.query(`select ${f.reserve()};`);
          await reservation.connection
            .query(`insert into public.job_objects(job_id, workspace_id, role,
          storage_key, mime_type, delete_after) values ('${job}', '${f.workspace}', 'input',
          'synthetic/concurrency/${job}', 'application/pdf', now() + interval '1 hour');`);
          const waiting = track(deletion.connection.query(`select ${f.deletion};`));
          await f.blocked(waiting, deletion.pid, reservation.pid);
          await reservation.connection.query('commit;');
          assert.equal(await waiting.promise, 't');
          await deletion.connection.query('commit;');
          assert.equal((await f.snapshot()).released, 1);
          assert.equal(
            await f.admin.query(`select state = 'deleting' and delete_after <= now()
          from public.jobs where id = '${job}';`),
            't',
          );
          assert.equal(
            await f.admin.query(`select state = 'pending' and delete_after <= now()
          from public.job_objects where job_id = '${job}';`),
            't',
          );
        } else {
          await deletion.connection.query(`select ${f.deletion};`);
          const waiting = track(reservation.connection.query(expectDenial(f.reserve())));
          await f.blocked(waiting, reservation.pid, deletion.pid);
          await deletion.connection.query('commit;');
          assert.equal(await waiting.promise, 'denied');
          await reservation.connection.query('commit;');
          assert.equal((await f.snapshot()).jobs, 0);
        }
        assert.equal((await f.snapshot()).state, 'deleting');
        assert.equal((await f.snapshot()).reserved, 0);
      },
    );
  }

  for (const reservationFirst of [false, true]) {
    await fixture(
      `workspace suspension: ${reservationFirst ? 'reservation' : 'suspension'} first`,
      async (f) => {
        const a = await f.session();
        const b = await f.session('postgres');
        const suspend = `update public.workspaces set status = 'suspended' where id = '${f.workspace}';`;
        if (reservationFirst) {
          await a.connection.query(`select ${f.reserve()};`);
          const waiting = track(b.connection.query(suspend));
          await f.blocked(waiting, b.pid, a.pid);
          await a.connection.query('commit;');
          await waiting.promise;
          await b.connection.query('commit;');
        } else {
          await b.connection.query(suspend);
          const waiting = track(a.connection.query(expectDenial(f.reserve())));
          await f.blocked(waiting, a.pid, b.pid);
          await b.connection.query('commit;');
          assert.equal(await waiting.promise, 'denied');
          await a.connection.query('commit;');
        }
        assert.equal((await f.snapshot()).jobs, reservationFirst ? 1 : 0);
        const retry = await f.session();
        assert.equal(await retry.connection.query(expectDenial(f.reserve())), 'denied');
        await retry.connection.query('commit;');
      },
    );
  }

  await fixture('owner revocation blocks account deletion', async (f) => {
    const a = await f.session('postgres');
    const b = await f.session();
    await a.connection.query(f.revoke('update'));
    const waiting = track(b.connection.query(expectDenial(f.deletion)));
    await f.blocked(waiting, b.pid, a.pid);
    await a.connection.query('commit;');
    assert.equal(await waiting.promise, 'denied');
    await b.connection.query('commit;');
    assert.equal((await f.snapshot()).state, 'active');
    assert.equal(
      await f.admin.query(`select account_deletion_requested_at is null
      from public.profiles where user_id = '${f.owner}';`),
      't',
    );
  });

  for (const operation of ['reservation', 'deletion']) {
    await fixture(`unsupported snapshot isolation: ${operation}`, async (f) => {
      const a = await f.session('service_role', 'repeatable read');
      assert.equal(
        await a.connection.query(
          expectDenial(
            operation === 'reservation' ? f.reserve() : f.deletion,
            '0A000',
            'TRANSACTION_ISOLATION_UNSUPPORTED',
          ),
        ),
        'denied',
      );
      await a.connection.query('commit;');
      assert.equal((await f.snapshot()).jobs, 0);
      assert.equal((await f.snapshot()).state, 'active');
    });
  }
  await workerLifecycleScenarios(fixture, track);
  console.log(`Database concurrency: ${passed} deterministic scenarios passed.`);
};

try {
  await run();
} catch (error) {
  // Never echo SQL, result objects, credentials, provider messages or stacks.
  console.error(`Database concurrency check failed at: ${stage}.`);
  if (error instanceof Error && /^SQL_SESSION_FAILED:[A-Z0-9]{5}$/u.test(error.message)) {
    console.error(error.message);
  }
  process.exitCode = 1;
}
