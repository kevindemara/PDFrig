// Prospective target graph only; never proof of final bundle contents or licence clearance.
export function desktopNoticeScope(cargo, targetCargo, npmPackages, gaps) {
  const root = targetCargo.resolve?.root;
  const nodes = targetCargo.resolve?.nodes;
  if (
    !root ||
    !cargo.workspace_members.includes(root) ||
    !Array.isArray(nodes) ||
    !nodes.some((node) => node.id === root)
  )
    throw new Error('DESKTOP_NOTICES_TARGET_GRAPH_INVALID');
  const packages = new Map(cargo.packages.map((pkg) => [pkg.id, pkg]));
  const ids = new Set(nodes.map((node) => node.id));
  if ([...ids].some((id) => !packages.has(id)))
    throw new Error('DESKTOP_NOTICES_TARGET_GRAPH_INVALID');
  const candidate = new Set(npmPackages.map((pkg) => `${pkg.name}@${pkg.version}`));
  let targetCargoCount = 0;
  for (const id of ids) {
    if (cargo.workspace_members.includes(id)) continue;
    const pkg = packages.get(id);
    candidate.add(`${pkg.name}@${pkg.version}`);
    targetCargoCount++;
  }
  return {
    schemaVersion: 1,
    target: 'x86_64-pc-windows-msvc',
    publicReleaseApproved: false,
    finalArtifactContentsVerified: false,
    scope:
      'Locked Cargo target metadata plus all installed desktop npm production inputs. Build/optional inputs may not be shipped; final artifact inspection remains required. Excluded gaps are retained by the full strict audit.',
    targetCargoCount,
    excludedCargoCount: cargo.packages.filter(
      (pkg) => !cargo.workspace_members.includes(pkg.id) && !ids.has(pkg.id),
    ).length,
    candidateGaps: gaps.filter((gap) => candidate.has(gap)),
    outsideTargetCargoGaps: gaps.filter((gap) => !candidate.has(gap)),
  };
}
