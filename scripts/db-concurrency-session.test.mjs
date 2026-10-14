import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { ciDatabaseConfig, SqlSession } from './db-concurrency-session.mjs';

const ci = { CI: 'true', GITHUB_ACTIONS: 'true' };
const url = 'postgresql://postgres:synthetic-canary@127.0.0.1:55322/postgres';

test('concurrency harness refuses non-CI, remote, wrong-port and unexpected database targets', () => {
  for (const environment of [{}, { CI: 'true' }, { GITHUB_ACTIONS: 'true' }]) {
    assert.throws(() => ciDatabaseConfig(environment, url, 55322), /CI_DATABASE_REQUIRED/u);
  }
  for (const candidate of [
    url.replace('127.0.0.1', 'localhost'),
    url.replace('127.0.0.1', 'example.invalid'),
    url.replace('55322', '5432'),
    url.replace('/postgres', '/production'),
    url.replace('postgres:', 'service_role:'),
    `${url}?sslmode=require`,
    `${url}#unexpected`,
  ]) {
    assert.throws(() => ciDatabaseConfig(ci, candidate, 55322), /EPHEMERAL_DATABASE_REQUIRED/u);
  }
  const config = ciDatabaseConfig(ci, url, 55322);
  assert.equal(config.env.PGPASSWORD, 'synthetic-canary');
  assert.ok(!config.args.join(' ').includes('synthetic-canary'));
});

const fakeProcess = () => {
  const child = new EventEmitter();
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => {
    child.emit('close', 1);
    return true;
  };
  return child;
};

test('SQL session frames split responses and refuses overlapping queries', async () => {
  const child = fakeProcess();
  const session = new SqlSession(ciDatabaseConfig(ci, url, 55322), () => child);
  const response = session.query('select 1;');
  await assert.rejects(session.query('select 2;'), /SQL_SESSION_BUSY_OR_CLOSED/u);
  child.stdout.write('1\nPDFMASON_QUERY_');
  child.stdout.write('DONE_1\n');
  assert.equal(await response, '1');
  await session.terminate();
});

test('SQL session failure never exposes synthetic SQL, credentials or stderr', async () => {
  const child = fakeProcess();
  const session = new SqlSession(ciDatabaseConfig(ci, url, 55322), () => child);
  const response = session.query('select synthetic_private_canary;');
  const rejection = assert.rejects(response, (error) => error.message === 'SQL_SESSION_FAILED');
  child.stderr.write('SQL private-canary.pdf synthetic-canary');
  child.emit('close', 1);
  await rejection;
  await session.terminate();
});

test('SQL session retains only an exact sqlstate diagnostic', async () => {
  const child = fakeProcess();
  const session = new SqlSession(ciDatabaseConfig(ci, url, 55322), () => child);
  const response = session.query('select 1;');
  const rejection = assert.rejects(
    response,
    (error) => error.message === 'SQL_SESSION_FAILED:42501',
  );
  child.stderr.write('ERROR: 42501\n');
  child.emit('close', 1);
  await rejection;
  await session.terminate();
});
