<img src="docs/brand/pdfrig-logo.png" alt="PDFrig" width="240" />

# PDFrig — Build better PDFs

A local-first PDF workspace for viewing, organizing, annotating, filling forms
and creating new copies of your documents. Shared web and Windows editor code;
no account is needed to try the local browser tools.

**Status: development preview, not a public release.** Existing-text editing and
in-editor OCR are still being developed. Do not mistake the **Add text** tool for
editing the original text. There is no supported public Windows installer yet.

[Quick start](#quick-start) · [Windows](#windows) ·
[Self-hosting](#self-hosting) · [Release checklist](#roadmap-and-launch) ·
[Detailed feature status](docs/product-scope.json)

## See the workspace

![PDFrig showing a synthetic tagged PDF, selectable text, form controls and a dismissible preservation notice](docs/screenshots/workspace.png)

_Real local development screenshot using our purpose-created CC0 PDF corpus.
Optional QA flags are enabled; gated tools are not approved for release. Notices
can be dismissed/restored; required warnings remain in export review._

![PDFrig local PDF utilities and processing-location disclosure](docs/screenshots/local-tools.png)

_Local tools create new copies. Screenshots contain no customer documents._

## What works today

These are bounded, fixture-tested capabilities—not a claim that every PDF is supported.

| Job              | Current support                                                                                                    |
| ---------------- | ------------------------------------------------------------------------------------------------------------------ |
| Read             | Render, search, select/copy searchable text, measured full-page fit, outline navigation and virtualized thumbnails |
| Organize         | Merge, insert, reorder, rotate, duplicate, delete, split and extract compatible pages, with undo/redo              |
| Add marks        | Text boxes/callouts, markup, comments, live freehand drawing, shapes and stamps; drag/resize added items           |
| Fill & sign      | Supported AcroForm fields; typed script-font, drawn or uploaded **visual** signatures                              |
| Create & convert | Blank PDFs, supported images/text to PDF, selected PDF pages to PNG/JPEG                                           |
| Refine           | Lossless compression, metadata tools, page/Bates numbering, headers/footers, crop and bounded resize               |
| Protect          | Bounded password/encryption and permission tools, with authority checks and explicit limitations                   |

Existing tags/bookmarks can be retained on the supported unchanged-page annotation
path and are checked on export. Page organizing has stricter support limits.
Every operation can refuse a document it cannot safely preserve.

### Important limitations

- **Original text:** engine research now repairs a demonstrated accessibility-text
  failure, but the candidate binary is not approved or connected to the editor.
- **Scans:** opening a scan does not automatically run OCR. The isolated OCR worker
  is tested, but there is no editor OCR action yet. Intended behavior is searchable/
  copyable invisible text with the original scan visually unchanged.
- **Signatures:** visual signatures are not certificate-backed signatures or proof
  of identity. Editing may invalidate existing digital signatures.
- **Redaction:** the separately gated raster-removal beta is not a black-box overlay;
  it changes document semantics and is not approved for public use.
- Forms, tags, attachments, encryption, active content, saved revisions, malformed
  structures and unusual fonts can constrain operations. Read warnings rather
  than assuming that a file which renders is safe to rewrite.
- Exported new content is not automatically tagged. No PDF/UA, PDF/A, legal,
  universal compatibility or perfect-OCR claim is made.

See the [feature catalogue](docs/product-scope.json) for exact IDs, verification
states and remaining work.

## Quick start

For the **browser app only**, install Git, Node.js **24.19.0** and pnpm **11.22.0**.
Rust, C++ tools, Docker and PDF verification tools are not needed just to try it.
Repository access is required while it remains private.

```powershell
git clone https://github.com/kevindemara/PDFrig.git
cd PDFrig
npm install --global pnpm@11.22.0
pnpm install --frozen-lockfile
pnpm web:dev
```

Open [the workspace](http://127.0.0.1:3000/workspace) or
[local utilities](http://127.0.0.1:3000/tools). Keep the terminal open.
Press Ctrl+C there to stop the server.

No credentials or paid services are needed for this loopback development preview.
Do not expose the development server to the internet. The repository retains its
internal PDFMason package/directory names; PDFrig is the display brand.

1. Open a PDF or use a [synthetic fixture](packages/test-corpus/fixtures/manifest.json).
2. Use **Select text** for searchable PDFs, or choose an annotation/form tool.
3. Review the preservation notice. Dismissing it changes presentation, not permissions.
4. Choose **Review export**, check warnings and save a new copy.
5. Open that copy in another PDF reader and inspect the affected pages.

The source stays unchanged. Unsaved editor work is session-only; keep the tab open
until you save. Typical editor bounds are 50 MB per input, 500 pages and 1,000
added marks; individual operations have additional limits.

### Configuration and troubleshooting

Environment names and safe defaults are in [.env.example](.env.example). If you
customize values, keep credentials in ignored local environment files. Never
commit them. To choose another loopback port in PowerShell:

```powershell
pnpm build:packages
$env:NEXT_PUBLIC_APP_URL='http://127.0.0.1:3101'
$env:PDFMASON_ALLOWED_ORIGINS='http://127.0.0.1:3101'
pnpm --filter @pdfmason/web dev --port 3101
```

Stop with Ctrl+C; do not stop unrelated processes to free a port. If installation
fails, check the pinned versions and lockfile rather than upgrading dependencies
indiscriminately. A scan with no selectable text needs OCR, which is not yet
connected to this editor. **Add text** creates an overlay, not original-text
replacement. If an export refuses a risky structure, keep the original and
inspect the warning; do not bypass preservation checks.

## Privacy and hosting

Local PDF operations run in the browser or desktop session; they do not upload
document contents. Optional account/cloud demos are clearly labeled and are not
real OCR/conversion services. Analytics consent is separate from PDF processing.

Self-hosting a production service is **not yet a credential-free one-command
deployment**. The existing production configuration still expects the legacy
Supabase/R2/Stripe stack. A reviewed local/self-hosted distribution mode must be
completed before promising a standalone public package.

### Self-hosting

Do not use fake-provider development mode as a public service. Before exposing
any service, complete the standalone versus managed-service configuration decision
and test the selected mode. The existing production mode requires real Supabase,
private R2, Stripe, origin/region/retention and price configuration; startup checks
must not be disabled to make a demo deployable.

For a shared service, use separate staging resources, HTTPS, exact origins,
private storage, opaque object keys, short-lived grants, RLS and negative
cross-user tests. Never expose database/worker control ports or put trusted keys
in client bundles. Run native OCR/Office only in bounded, non-root, isolated
workers with reviewed images and clear consent before upload. Review CSP/CSRF,
rate/body limits, cancellation, deletion reconciliation, secrets, image licensing
and rollback before inviting users. Operational controls and remaining staging
exercises are in the [operational handbook](docs/operations/handbook.txt).

Local source testing requires no paid service. Hardware/electricity/internet still
apply; hosting, domains and optional providers are not guaranteed free.

## Windows

The shared editor runs in a Tauri 2 Windows shell. Building it requires the
separate free Rust/C++/Windows SDK toolchain. An internal unsigned NSIS installer
exists for controlled testing, but clean-machine installation, upgrade/uninstall,
notices and release review remain open.

### Run from source

Install Rust **1.98.0**, the free Microsoft C++ Build Tools workload and Windows
SDK, plus WebView2. See the [official Tauri Windows prerequisites](https://v2.tauri.app/start/prerequisites/#windows).
Then, from the repository root:

```powershell
pnpm install --frozen-lockfile
pnpm desktop:dev
```

Native save creates a new file and refuses overwriting an existing file. The
shell shares the same feature limits; worker tests do not enable editor OCR.

### Internal installer testing

Use only a disposable Windows x64 VM/reference machine. In a clean test checkout,
`pnpm desktop:internal-build` prepares a current-user NSIS alpha installer,
ephemeral updater test key, checksum and signature evidence in an ignored build
directory. The helper refuses reuse/replacement of signing material; do not delete
keys or weaken its guards to rerun it. Never commit artifacts or private keys.

The artifact is **not Authenticode-signed or approved for public distribution**.
An updater signature is not a Windows-verified publisher identity. Do not disable
Windows protections or work around device policy. Source/browser testing remains
available if installation is blocked.

For an approved internal artifact, compare `Get-FileHash -Algorithm SHA256` with
its exact build manifest; matching bytes do not establish trust. Verify updater
signatures and tamper rejection with the desktop offline-verification harness.
Follow installer prompts only in the disposable machine. Record version/location,
Start-menu and shortcut target/name, taskbar and high-DPI icons, offline launch,
synthetic PDF open/save/cancel and any association changes. Do not silently replace
a user's default PDF app. Independently open the exported copy and verify the
source stayed unchanged.

### Upgrade and uninstall

There is no public update channel. Do not invent URLs, reuse alpha keys for a
release or turn off signature verification. Release testing must cover installing
over an existing version, ownership/data preservation and tampered-update refusal.
For source updates: save/export work, stop the app, update without discarding local
changes, run `pnpm install --frozen-lockfile`, then restart `pnpm desktop:dev`.

For an installed alpha, save/export and quit, then use Windows installed-app
settings to run its registered uninstaller. Sign out and clear optional recent
files first if you want to remove account caches/path history. Uninstall must not
delete PDFs or exports. Verify remaining per-user configuration and restore the
previous default PDF app if necessary; complete data erasure is not yet certified.
Deleting a source checkout is not an uninstaller and must not remove documents.

No installer binaries, signing keys, customer documents or build caches belong in
Git. Do not disable Windows protections to install an unknown build.

## Development and verification

```powershell
pnpm check
pnpm test:browser
```

`pnpm check` runs formatting, lint, strict types, unit/component tests, native
surface restrictions, license/secret checks and builds. Browser verification also
needs Playwright Chromium, qpdf **12.4.0**, Poppler (`pdftoppm`, `pdftotext`) and
Python with `pypdf` **6.16.1** / `cryptography` **50.0.0**. Install Chromium with
`pnpm exec playwright install chromium`. Configure `PDFMASON_QPDF_PATH`,
`PDFMASON_PYTHON_PATH` and put Poppler tools on PATH; individual verification
harnesses also support `PDFMASON_PDFTOPPM_PATH`. The bounded prerequisite probe never installs tools.
Browser tests own port 3100 and an isolated cache; choose another port with
`PDFMASON_BROWSER_TEST_PORT` (1024–65535) if needed. Never point QA at a user tab.
Docker is required for
`pnpm test:ocr-worker` and `pnpm test:office-worker`; these verify isolated workers,
not editor integration or public availability.

Use synthetic/licensed fixtures only. Never put PDFs, extracted text, filenames,
passwords or signature data into logs, issue attachments or analytics. Report
sensitive security issues privately rather than publishing document samples.
The PDF/image/text corpus is purpose-created CC0 with hashes and sensitivity
records in its fixture manifests; Office sandbox samples have a separate
[synthetic provenance manifest](apps/worker/test-fixtures/manifest.json).

Additional environment-dependent checks include `pnpm test:pdf-corpus`,
`pnpm test:pdf-utilities`, `pnpm test:pdf-decorations`, `pnpm test:pdf-permissions`,
`pnpm security:audit` and native Rust checks. Database tests require local Docker/
Supabase: `pnpm db:start`, `pnpm db:test`, `pnpm test:db-concurrency`,
`pnpm db:advisors`, then `pnpm db:stop`. Use isolated synthetic accounts only.

## Roadmap and launch

Next: approve a traceable text engine, broaden font/layout/tag fidelity checks,
connect genuine source-text editing with actual-export preview, and integrate
appearance-preserving OCR through a reviewed local/self-hosted path.

Also required: the chosen source license, complete third-party notices/SBOM,
secure standalone distribution, Windows reference-machine checks, broader
accessibility/security testing and reproducible release artifacts. The
following launch blockers must be resolved with actual evidence, not merely flags:

- Approve an exact, traceable source-text engine and complete broad font/layout/tag
  verification and editor integration. The [candidate assessment](docs/dependencies/source-text-engine-review.json)
  remains not approved; four passing research cases are not production coverage.
- Integrate scan-preserving OCR with reviewed licensing, sandbox/cleanup, consent,
  cancellation, alignment/recognition benchmarks and actual-output preview.
- Implement the chosen free local/self-hosted distribution mode without exposing
  development fakes or bypassing trusted-service authorization.
- Approve the project's source-available legal terms and third-party obligations;
  generate complete final SBOMs/notices and scan exact dependencies/worker images.
- Decide the no-cost Windows distribution/signing policy; complete clean-machine
  install/upgrade/uninstall, shortcuts/icons and offline/update-tamper testing.
- Complete manual assistive-technology/high-DPI testing, independent security
  review, production-like smoke/rollback/deletion exercises and brand clearance.

`pnpm beta:release-gate` intentionally requires separately reviewed public
approvals and measured economics. Passing local tests alone does not approve
public distribution or production deployment.

The monorepo has `apps/web`, `apps/desktop`, `apps/worker` and shared `packages/*`.
The [feature catalogue](docs/product-scope.json) retains stable IDs, support
contracts, states and excluded specialist scope. Keep IDs and update executable
tests/catalogue/README with behavior changes; do not silently expand exclusions.

### Contributor safety rules

Protect documents before convenience. Keep originals immutable and verify changed
outputs structurally, semantically and with independent renders. Never silently
drop tags/forms/bookmarks, rasterize, flatten or downgrade encryption. Fail safely
with structured warnings when preservation cannot be established. Visual marks
are not redaction or certificate-backed signatures. Critical content exposure,
source loss, recoverable redaction or signing compromise stops release.

Use strict TypeScript, shared editor behavior, typed adapters and bounded schema
validation at every untrusted boundary. Honor server-side tenant isolation and
entitlements; never grant access from a redirect or caller-supplied identity.
Do not log document bytes, text, filenames, passwords, signatures, object keys,
tokens or signed URLs. Maintain local/cloud disclosure, keyboard accessibility,
undo/redo and deletion/cancellation controls. No production documents as fixtures.

Dependencies require exact provenance, maintenance/security, license/transitive
and platform/bundle review. Deny AGPL, SSPL, unknown and incompatible licenses by
default; native GPL/LGPL distribution requires an explicit legal compliance plan.
Retain all required notices. Never commit environment files, keys, installers,
research downloads, toolchains or build/test caches. Native operations belong in
isolated workers, not web requests. Existing migrations are append-only.

Run formatting/lint/types, automated positive/negative tests and relevant
integration/fidelity checks; reject retry-dependent browser success. Keep changes
reviewable and preserve unrelated work. This version of Next.js has versioned
guides in `apps/web/node_modules/next/dist/docs/`; consult them before framework
changes. Historical planning/checkpoint files are intentionally not in the
publishable tree.

Preserve the approved PDFrig logo/mark and original Ink/Copper/Paper design
tokens. Keep branding centralized and distinct from third-party PDF products.
Do not change internal package names, storage keys, desktop identity or signing
identity as a display-name side effect. New architecture/dependency decisions
must have a reviewed record (machine-readable records are kept under `docs/`).
No interface compliance, trademark clearance or cryptographic certification is
implied by fixture tests. Severity guidance: security/content loss is Critical;
silent corruption, widespread failures, major accessibility and deletion failures
are High; bounded warning-backed fidelity and UX regressions are Medium; cosmetics
are Low. Critical issues stop release; High issues stop the affected capability.

### Publication hygiene

`pnpm repo:check` rejects non-root Markdown, private/generated paths and unknown
document binaries; `pnpm secret:scan` scans publishable text without printing
matching values. These run in local checks and CI. Ignore rules are not a defense
for files already tracked. Git history is separate: removed files and commit
author metadata can still be public after a push. Review history before changing
visibility; never rewrite history or rotate credentials without coordination.
`pnpm repo:history` performs a separate read-only scan of locally reachable Git
history with content-free findings; binary contents, remote caches and forks are
outside its coverage. A clean current tree is not proof of clean history.

## License

The owner's current intent is **free personal and business use, but no
redistribution or selling copies**. That is a proposed **source-available** policy,
not an open-source license. Legal terms have not been approved; package manifests
still say `UNLICENSED`. This README does not grant new use or redistribution rights.

Third-party components retain their own licenses and rights regardless of the
application's eventual license. See [third-party notices](docs/dependencies/THIRD_PARTY_NOTICES.txt)
and the [text-engine technical review](docs/dependencies/source-text-engine-review.json).
Brand assets and trademarks are separate from code licensing.
