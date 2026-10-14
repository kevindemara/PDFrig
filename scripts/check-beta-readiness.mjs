import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { ACTIONABLE_ALERTS } from '../packages/observability/dist/index.js';

const root = path.resolve(import.meta.dirname, '..');
const publicRelease = process.argv.includes('--public-release');

const requiredFiles = [
  'apps/web/app/pricing/page.tsx',
  'apps/web/app/get-started/page.tsx',
  'apps/web/app/help/page.tsx',
  'apps/web/app/status/page.tsx',
  'apps/web/app/support/page.tsx',
  'apps/web/app/privacy/page.tsx',
  'apps/web/app/terms/page.tsx',
  'apps/web/app/refunds/page.tsx',
  'apps/web/app/subprocessors/page.tsx',
  'apps/web/app/retention/page.tsx',
  'apps/web/app/known-limitations/page.tsx',
  'docs/operations/handbook.txt',
  'docs/operations/beta-cost-model.json',
];

const failures = [];
for (const relativePath of requiredFiles) {
  try {
    await access(path.join(root, relativePath));
  } catch {
    failures.push(`Missing required beta artifact: ${relativePath}`);
  }
}

const handbook = await readFile(path.join(root, 'docs/operations/handbook.txt'), 'utf8');
for (const section of [
  'backup-and-restore',
  'credential-rotation',
  'deletion-reconciliation',
  'incident-response',
  'release-rollback',
  'tabletop-2026-08-25',
  'milestone-7-threat-review',
]) {
  if (!handbook.includes(`SECTION: ${section}\n`))
    failures.push(`Missing required beta handbook section: ${section}`);
}
for (const alert of ACTIONABLE_ALERTS) {
  try {
    const [file, section] = alert.runbook.split('#');
    await access(path.join(root, file));
    if (!section || !handbook.includes(`SECTION: ${section}\n`))
      throw new Error('Missing alert section');
  } catch {
    failures.push(`Alert ${alert.id} has no runbook at ${alert.runbook}`);
  }
}

const knownLimits = await readFile(
  path.join(root, 'apps/web/app/known-limitations/page.tsx'),
  'utf8',
);
for (const featureId of ['EDIT-002', 'OCR-001', 'REDACT-001']) {
  if (!knownLimits.includes(featureId)) failures.push(`Known limits omit ${featureId}`);
}

const publicCopy = await Promise.all(
  [
    'apps/web/app/privacy/page.tsx',
    'apps/web/app/security/page.tsx',
    'apps/web/app/subprocessors/page.tsx',
  ].map((relativePath) => readFile(path.join(root, relativePath), 'utf8')),
);
for (const forbiddenClaim of ['SOC 2 certified', 'HIPAA compliant', 'zero knowledge']) {
  if (publicCopy.some((copy) => copy.toLowerCase().includes(forbiddenClaim.toLowerCase()))) {
    failures.push(`Unapproved public assurance claim: ${forbiddenClaim}`);
  }
}

if (publicRelease) {
  const approvalPath = path.join(root, 'docs/operations/public-release-approval.json');
  try {
    const approval = JSON.parse(await readFile(approvalPath, 'utf8'));
    const requiredApprovals = [
      'accessibilityManualAudit',
      'alertsStagingExercise',
      'backupRestoreStagingExercise',
      'legalPolicies',
      'measuredUnitEconomics',
      'penetrationTest',
      'productionSmoke',
      'signedWindowsArtifact',
    ];
    for (const approvalName of requiredApprovals) {
      if (approval[approvalName]?.status !== 'approved' || !approval[approvalName]?.evidence) {
        failures.push(`Public approval missing or incomplete: ${approvalName}`);
      }
    }
  } catch {
    failures.push(
      'Public approval manifest is absent. Create docs/operations/public-release-approval.json only from independently reviewed evidence.',
    );
  }
}

if (failures.length > 0) {
  console.error(failures.map((failure) => `- ${failure}`).join('\n'));
  process.exitCode = 1;
} else {
  console.log(
    publicRelease
      ? `Public beta readiness passed with ${ACTIONABLE_ALERTS.length} actionable alerts.`
      : `Local beta readiness passed with ${ACTIONABLE_ALERTS.length} actionable alerts. Public-release approvals remain intentionally separate.`,
  );
}
