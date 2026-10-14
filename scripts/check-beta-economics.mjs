import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const modelPath = path.resolve(import.meta.dirname, '../docs/operations/beta-cost-model.json');
const model = JSON.parse(await readFile(modelPath, 'utf8'));

const revenueMinor = model.scenario.paidAccounts * model.scenario.monthlyPriceMinor;
const workloadCostMinor = model.workloads.reduce(
  (total, workload) => total + workload.units * workload.unitCostMinor,
  0,
);
const totalCostMinor = model.scenario.fixedMonthlyCostMinor + workloadCostMinor;
const contributionMinor = revenueMinor - totalCostMinor;
const marginPercent = revenueMinor === 0 ? 0 : (contributionMinor / revenueMinor) * 100;

const result = {
  currency: model.currency,
  marginPercent: Number(marginPercent.toFixed(1)),
  measurementStatus: model.measurementStatus,
  monthlyContributionMinor: contributionMinor,
  monthlyRevenueMinor: revenueMinor,
  monthlyTotalCostMinor: totalCostMinor,
  scenario: model.name,
};

console.log(JSON.stringify(result, null, 2));

if (marginPercent < model.minimumContributionMarginPercent) {
  console.error(
    `Modelled contribution margin ${result.marginPercent}% is below ${model.minimumContributionMarginPercent}%.`,
  );
  process.exitCode = 1;
}

if (
  process.argv.includes('--require-measured') &&
  (model.measurementStatus !== 'measured-staging' || model.pricingStatus !== 'approved')
) {
  console.error('Public release requires approved pricing and measured staging workload costs.');
  process.exitCode = 1;
}
