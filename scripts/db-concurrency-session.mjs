import { spawn } from 'node:child_process';

/** Only the ephemeral GitHub CI database; never a developer or hosted project. */
export const ciDatabaseConfig = (environment, databaseUrl, expectedPort) => {
  if (environment.CI !== 'true' || environment.GITHUB_ACTIONS !== 'true') {
    throw new Error('CI_DATABASE_REQUIRED');
  }
  const url = new URL(databaseUrl);
  if (
    url.protocol !== 'postgresql:' ||
    url.hostname !== '127.0.0.1' ||
    url.port !== String(expectedPort) ||
    url.pathname !== '/postgres' ||
    url.username !== 'postgres' ||
    !url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error('EPHEMERAL_DATABASE_REQUIRED');
  }
  return {
    args: [
      '-X',
      '--no-password',
      '-qAt',
      '-v',
      'ON_ERROR_STOP=1',
      '-v',
      'VERBOSITY=sqlstate',
      '-h',
      url.hostname,
      '-p',
      url.port,
      '-U',
      url.username,
      '-d',
      'postgres',
    ],
    env: {
      ...environment,
      PGPASSWORD: decodeURIComponent(url.password),
      PGAPPNAME: 'pdfmason-concurrency-ci',
      PGCONNECT_TIMEOUT: '5',
      PGSSLMODE: 'disable',
    },
  };
};

/** Trusted synthetic SQL only. Raw SQL, stdout, stderr and credentials never log. */
export class SqlSession {
  #child;
  #active;
  #buffer = '';
  #sequence = 0;
  #closed = false;
  #sqlState;
  #closePromise;

  constructor(config, spawnProcess = spawn) {
    this.#child = spawnProcess('psql', config.args, {
      env: config.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
    });
    this.#closePromise = new Promise((resolve) => {
      this.#child.once('close', () => {
        this.#closed = true;
        this.#fail();
        resolve();
      });
    });
    this.#child.on('error', () => this.#fail());
    this.#child.stdin.on('error', () => this.#fail());
    this.#child.stderr.on('data', (chunk) => {
      // VERBOSITY=sqlstate emits only the code; retain no arbitrary provider text.
      const code = chunk.toString('utf8').match(/(?:ERROR|FATAL):\s+([A-Z0-9]{5})\r?\n/u)?.[1];
      if (code) this.#sqlState = code;
    });
    this.#child.stdout.on('data', (chunk) => {
      this.#buffer += chunk.toString('utf8');
      if (this.#buffer.length > 65536) {
        this.#fail();
        this.#child.kill();
        return;
      }
      const active = this.#active;
      if (!active) return;
      const marker = `${active.marker}\n`;
      const end = this.#buffer.indexOf(marker);
      if (end < 0) return;
      const output = this.#buffer.slice(0, end).trim();
      this.#buffer = this.#buffer.slice(end + marker.length);
      clearTimeout(active.timeout);
      this.#active = undefined;
      active.resolve(output);
    });
  }

  #fail() {
    const active = this.#active;
    if (!active) return;
    clearTimeout(active.timeout);
    this.#active = undefined;
    active.reject(new Error(`SQL_SESSION_FAILED${this.#sqlState ? `:${this.#sqlState}` : ''}`));
  }

  query(sql) {
    if (this.#closed || this.#active)
      return Promise.reject(new Error('SQL_SESSION_BUSY_OR_CLOSED'));
    return new Promise((resolve, reject) => {
      const marker = `PDFMASON_QUERY_DONE_${++this.#sequence}`;
      const timeout = setTimeout(() => {
        this.#fail();
        this.#child.kill();
      }, 20000);
      this.#active = { marker, resolve, reject, timeout };
      this.#child.stdin.write(`${sql}\n\\echo ${marker}\n`);
    });
  }

  async terminate() {
    if (!this.#closed) this.#child.kill();
    await this.#closePromise;
  }
}
