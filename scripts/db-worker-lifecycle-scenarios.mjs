import assert from 'node:assert/strict';

// CONV-002/003/004, OCR-001. Only called by the ephemeral CI database harness.
export const workerLifecycleScenarios = async (fixture, track) => {
  const queue = async (f) => {
    const job = await f.admin.query(`select ${f.reserve()};`);
    await f.admin.query(`update public.jobs set state='queued' where id='${job}';
      insert into public.job_objects(job_id, workspace_id, role, storage_key, mime_type, delete_after)
      values ('${job}','${f.workspace}','input','synthetic/worker/${job}','application/pdf',now()+interval '1 hour');`);
    return job;
  };
  const claim = `select id from public.claim_cloud_job('worker-first-owner',60);`;
  const finish = (job, attempt = 1, success = true, worker = 'worker-first-owner') =>
    `select coalesce(public.finish_cloud_job_attempt('${job}','${worker}',${attempt},${success}),'rejected');`;
  const status = (f, job) =>
    f.admin.query(`select j.state || ':' || u.status from public.jobs j
    join public.usage_ledger u on u.job_id=j.id where j.id='${job}';`);

  for (const completionFirst of [false, true]) {
    await fixture(
      `worker completion / cancellation: completion first=${completionFirst}`,
      async (f) => {
        const job = await queue(f);
        assert.equal(await f.admin.query(claim), job);
        const a = await f.session();
        const b = await f.session();
        const cancel = `select public.request_cloud_job_cancellation('${job}','${f.workspace}','${f.owner}');`;
        assert.equal(
          await a.connection.query(completionFirst ? finish(job) : cancel),
          completionFirst ? 'completed' : 't',
        );
        const waiting = track(b.connection.query(completionFirst ? cancel : finish(job)));
        await f.blocked(waiting, b.pid, a.pid);
        await a.connection.query('commit;');
        assert.equal(await waiting.promise, completionFirst ? 'f' : 'cancelled');
        await b.connection.query('commit;');
        assert.equal(
          await status(f, job),
          completionFirst ? 'completed:consumed' : 'cancelled:released',
        );
      },
    );
    await fixture(
      `worker completion / account deletion: completion first=${completionFirst}`,
      async (f) => {
        const job = await queue(f);
        assert.equal(await f.admin.query(claim), job);
        const a = await f.session();
        const b = await f.session();
        assert.equal(
          await a.connection.query(completionFirst ? finish(job) : `select ${f.deletion};`),
          completionFirst ? 'completed' : 't',
        );
        const waiting = track(
          b.connection.query(completionFirst ? `select ${f.deletion};` : finish(job)),
        );
        await f.blocked(waiting, b.pid, a.pid);
        await a.connection.query('commit;');
        assert.equal(await waiting.promise, completionFirst ? 't' : 'rejected');
        await b.connection.query('commit;');
        assert.equal(
          await status(f, job),
          completionFirst ? 'deleting:consumed' : 'deleting:released',
        );
        assert.equal(
          await f.admin.query(
            `select bool_and(delete_after <= clock_timestamp()) from public.job_objects where job_id='${job}';`,
          ),
          't',
        );
      },
    );
  }
  for (const claimFirst of [false, true]) {
    await fixture(`worker claim / account deletion: claim first=${claimFirst}`, async (f) => {
      const job = await queue(f);
      const a = await f.session();
      const b = await f.session();
      if (claimFirst) {
        assert.equal(await a.connection.query(claim), job);
        const waiting = track(b.connection.query(`select ${f.deletion};`));
        await f.blocked(waiting, b.pid, a.pid);
        await a.connection.query('commit;');
        assert.equal(await waiting.promise, 't');
      } else {
        assert.equal(await a.connection.query(`select ${f.deletion};`), 't');
        // SKIP LOCKED is deliberately nonblocking; the deleting job is not claimed.
        assert.equal(await b.connection.query(claim), '');
        await a.connection.query('commit;');
      }
      await b.connection.query('commit;');
      assert.equal(await f.admin.query(claim), '');
      assert.equal(await f.admin.query(finish(job)), 'rejected');
      assert.equal(await status(f, job), 'deleting:released');
    });
  }
  await fixture('worker competing claims and rollback', async (f) => {
    const job = await queue(f);
    const a = await f.session();
    const b = await f.session();
    assert.equal(await a.connection.query(claim), job);
    assert.equal(await b.connection.query(claim), '');
    await a.connection.query('rollback;');
    assert.equal(await b.connection.query(claim), job);
    await b.connection.query('commit;');
    assert.equal(await f.admin.query(finish(job)), 'completed');
    assert.equal(await status(f, job), 'completed:consumed');
  });
  await fixture('worker finish rollback is atomic', async (f) => {
    const job = await queue(f);
    assert.equal(await f.admin.query(claim), job);
    const a = await f.session();
    assert.equal(await a.connection.query(finish(job)), 'completed');
    await a.connection.query('rollback;');
    assert.equal(await status(f, job), 'processing:reserved');
    assert.equal(
      await f.admin.query(
        `select delete_after > clock_timestamp() from public.job_objects where job_id='${job}';`,
      ),
      't',
    );
    assert.equal(await f.admin.query(finish(job)), 'completed');
  });
  await fixture('worker recovery fences previous attempt including same owner', async (f) => {
    const job = await queue(f);
    assert.equal(await f.admin.query(claim), job);
    await f.admin.query(
      `update public.jobs set lease_expires_at=clock_timestamp()-interval '1 second' where id='${job}';`,
    );
    const a = await f.session();
    const b = await f.session();
    assert.equal(
      await a.connection.query(`select public.recover_cloud_job('${job}');`),
      'retry_wait',
    );
    const waiting = track(b.connection.query(finish(job)));
    await f.blocked(waiting, b.pid, a.pid);
    await a.connection.query('commit;');
    assert.equal(await waiting.promise, 'rejected');
    await b.connection.query('commit;');
    assert.equal(await f.admin.query(claim), job);
    assert.equal(await f.admin.query(finish(job)), 'rejected');
    assert.equal(await f.admin.query(finish(job, 2)), 'completed');
    assert.equal(await status(f, job), 'completed:consumed');
  });
};
