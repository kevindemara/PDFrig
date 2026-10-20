<img src="docs/brand/pdfrig-logo.png" alt="PDFrig" width="240" />

# PDFrig — Build better PDFs

A local-first PDF editor for viewing, editing supported text, organizing pages,
adding annotations, filling forms and making searchable copies of scanned PDFs.
Your original file stays unchanged; save your work as a new PDF.

**Free for personal and business use.** No account, subscription, payment details
or paid service is needed for the local PDF tools. Start with the browser version
below; the Windows installer is an alternative if you prefer a desktop app.

**Public alpha release.** Text editing and OCR have
document-specific limits. PDFrig's own code is MIT-licensed. Third-party notice
and native OCR security reviews are not complete; see [License](#license) and
[release work](#roadmap-and-launch).

[Browser setup](#quick-start) · [Windows download](#install-the-finished-windows-app) ·
[Features](#what-works-today) · [Self-hosting](#self-hosting) · [Build from source](#build-from-source)

## Quick start

### Browser version — recommended

Run PDFrig locally and open it in your browser. This is the recommended way to
try the app; there is no public hosted editor at present.

Install Git, Node.js **24.19.0** and pnpm **11.22.0**, then run these commands in
a terminal. Rust, C++ tools, Docker and a Windows installer are **not** needed.

```powershell
git clone https://github.com/kevindemara/PDFrig.git
cd PDFrig
npm install --global pnpm@11.22.0
pnpm install --frozen-lockfile
pnpm web:dev
```

Open [the editor](http://127.0.0.1:3000/workspace) or
[PDF utilities](http://127.0.0.1:3000/tools). Keep the terminal open while using
the app. Press **Ctrl+C** in that terminal to stop it.

No credentials or paid services are needed. Initial installation requires internet
access for dependencies and verified English/French OCR models. After preparation,
local OCR uses bundled assets, not a runtime CDN or document upload. Never disable
asset integrity checks to work around a failed download.

### Open, edit and export

1. Open a PDF in the editor.
2. Use **Select text** to select/copy searchable text. Choose **Edit selected text**
   to change supported original text, or use **Text → Edit existing text**.
3. To search/copy words in a scanned page, choose **Text → OCR this page**. OCR does
   not visibly replace the scanned words.
4. For existing-text edits and OCR, build the actual PDF preview, inspect it,
   check the review box and apply the copy. Changing an edit invalidates its preview.
5. Choose **Review export**, read any preservation warnings and save a new copy.
   Check the exported pages in another PDF reader before relying on them.

**Add text** creates a text overlay; it is not the same as editing the original
text. Dismissing a notice does not grant permissions or bypass export checks.
Unsaved work is session-only, so export before closing the tab or restarting.

Choose **All tools** in the editor's top bar to open the utilities screen in either
the browser or Windows app. If you have unexported edits, unapplied redaction marks
or session-only measurement guides, a confirmation appears before switching.
Choose **Cancel** to stay and export first, or **Discard and continue** to leave and discard that
session work. The logo shortcut uses the same warning; original and previously
exported PDFs are not changed.

### Troubleshooting

- **Port already in use:** stop your own previous server, or choose another
  loopback port with the commands below. Do not terminate unrelated processes.
- **No selectable text:** the page may be a scan. Run OCR on that page first.
- **An edit is refused:** review the explanation. Unsupported fonts, layouts or
  document structures can remain read-only; never discard the original.
- **Dependency installation fails:** check the pinned versions and lockfile.
  Avoid unplanned dependency upgrades or disabling verification checks.

```powershell
pnpm build:packages
$env:NEXT_PUBLIC_APP_URL='http://127.0.0.1:3101'
$env:PDFMASON_ALLOWED_ORIGINS='http://127.0.0.1:3101'
pnpm --filter @pdfmason/web dev --port 3101
```

Safe configuration examples are in [.env.example](.env.example). Keep any real
credentials in ignored local files; never commit them. Some internal package and
environment-variable names retain the original PDFMason name for compatibility.

## Windows

### Install the finished Windows app

[**Download PDFrig-setup.exe**](https://github.com/kevindemara/PDFrig/releases/download/private-test-20261019-6/PDFrig-setup.exe)
— Windows x64, version `0.1.0-alpha.20261019.6`.

The [Windows release](https://github.com/kevindemara/PDFrig/releases/tag/private-test-20261019-6)
includes the installer, `SHA256SUMS.txt`, notices and the build record. While the
repository is private, sign in to GitHub with repository access to download it.

This is an **unsigned alpha release**.
This installer passed a same-machine upgrade, All tools navigation with Cancel and
Discard confirmation, and a synthetic form export checked independently for field
values and unchanged surrounding pixels.
A successful installation and use on a second Windows PC has been reported, but
that was an earlier alpha. This is not comprehensive installer, offline OCR or
upgrade/uninstall testing.
Windows compliance is not certified. Outstanding licensing and security reviews
are described below.

1. Download **PDFrig-setup.exe**, not **Source code (zip)** or **Source code (tar.gz)**.
2. Verify its checksum in PowerShell against `SHA256SUMS.txt`:

   ```powershell
   Get-FileHash .\PDFrig-setup.exe -Algorithm SHA256
   ```

3. Close any running PDFrig window and run the installer through the normal
   Windows prompts. Stop if installation or execution is blocked by Windows or
   your device policy; do not disable security protections to proceed.
4. Open PDFrig from its Start-menu shortcut, edit a test copy and check its export.

You do **not need Node.js, pnpm, Rust, C++ Build Tools, Docker or a server** to use
the finished Windows app. WebView2 may need an internet download during setup;
the app bundles its local PDF/OCR assets. Native save requires a new filename
and does not overwrite an existing file.

An unsigned installer can trigger Windows trust warnings. A matching checksum
verifies download integrity, not a trusted publisher. No paid code-signing
certificate is required for this test build. If installation is blocked, use the
local browser version instead.

Installers are GitHub Release assets: no Windows installer EXE is included in
the tracked source files. See the [build evidence](docs/operations/windows-all-tools-build.json)
and [download verification](docs/operations/windows-all-tools-release.json) for exact
artifact hashes and test limits. These are historical build/test records, not
security certification or a complete license review.

### Upgrade and uninstall

There is no automatic public update channel. Export your work, close PDFrig and
run the newer installer only when its release notes and checksum have been reviewed.
Keep copies of important documents; broad upgrade testing is still pending.

To uninstall, close PDFrig and use Windows **Installed apps**. Your PDFs and exports
are separate from the application. Optional recent-file/account caches may need
separate clearing; complete data erasure has not been certified. Deleting a source
checkout is not an uninstaller.

### Build from source

**Code → Download ZIP is source code, not an installed Windows app.** Use a Git
clone for development: source ZIPs lack Git metadata needed by repository checks.
Building is optional; most people should use the browser setup or finished installer.

For the Windows development app, install Rust **1.98.0** using the
`x86_64-pc-windows-msvc` toolchain, Microsoft C++ Build Tools with
**Desktop development with C++**, a Windows SDK and WebView2. Use tools whose
terms you are eligible to accept. See [Tauri's Windows prerequisites](https://v2.tauri.app/start/prerequisites/#windows).
After the Git/Node.js/pnpm setup above:

```powershell
pnpm install --frozen-lockfile
pnpm desktop:dev
```

This starts a development window; it does not install PDFrig. If a build helper
is blocked, stop: do not disable Application Control or rename/move executables
to evade device policy. Do not change its checkout while another PC is building
a selected revision; retain the exact source commit and archive checksum.

**Purpose of BUILD_WITH_AI.txt:** the [tool-neutral build prompt](BUILD_WITH_AI.txt)
helps a coding assistant inspect prerequisites, run locked tests, build an internal
QA installer and report its checksum. It is not an executable, automatic installer
or AI feature in PDFrig. Users downloading a finished installer do not need this file.
Building with an assistant does not remove licensing, security or testing obligations.

### Internal installer testing

Maintainers can audit notices with `pnpm desktop:notices`; add `--require-complete`
to fail on unresolved text gaps. `pnpm desktop:internal-build --private-test`
creates an isolated, PDFrig-branded private alpha. `--installer-qa` selects the
separate QA-labeled profile. These do not enable a production updater or register
PDF associations. Never commit signing keys, installers or build caches.

Test source-bound artifacts on an authorized reference machine. Verify checksums,
updater test signatures, cancellation and existing-file refusal; independently
check exported PDFs. Record installed shortcuts, icons, offline OCR, upgrades and
uninstall behavior. An updater test signature is not Authenticode verification.
A successful build alone is not public-release approval.

## See the workspace

![PDFrig editor showing a synthetic PDF, selectable text and form controls](docs/screenshots/workspace.png)

![PDFrig local PDF utilities](docs/screenshots/local-tools.png)

Screenshots use purpose-created synthetic fixtures, not personal or customer
documents. Test flags may expose tools that remain gated in normal builds.

## What works today

Features are document-dependent and may be disabled in a particular build.

| Task               | Support                                                                                                                                |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| Read               | Search, select/copy searchable text, fit a full page, browse outlines and thumbnails                                                   |
| Edit original text | Replace supported text and rewrap uniform paragraphs at the original font size; actual-PDF review and undo/redo                        |
| OCR                | Local English/French recognition; add invisible search/copy text while keeping the visible scan unchanged                              |
| Organize           | Merge, insert, reorder, rotate, duplicate, delete, split and extract compatible pages                                                  |
| Annotate           | Text boxes/callouts, markup, comments, live drawing, shapes and stamps; drag/resize placed items                                       |
| Fill and sign      | Supported form fields and typed script-font, drawn or uploaded visual signatures                                                       |
| Create and refine  | Blank PDFs, images/plain text to PDF, page images, lossless compression, metadata, numbering, headers/footers, crop and bounded resize |

Password/permission tools and redaction have separate feature gates and review
requirements. Office conversion is not available in this version. The
[feature catalogue](docs/product-scope.json) records exact support and stable IDs.

### Important limitations

- **Original text:** printable ASCII only, with existing supported font glyphs and
  encodings. Mixed-style paragraphs, unsupported transforms, linked paragraphs,
  unknown simple embedded fonts and cross-page reflow are not supported. Longer
  text wraps within the supported paragraph area without squeezing or shrinking;
  overflow stops instead of overlapping neighboring content. Review every result.
- **Scans:** scanned words are **not visibly editable**. OCR is started per page,
  not automatically on open. It adds invisible, untagged search/copy text and can
  misrecognize words. Rotated or already-searchable pages and unsupported glyphs
  can be refused. Source revisions are retained for undo, within session limits.
- **Preservation:** forms, tags, bookmarks, encryption, signatures, attachments,
  active content, revisions and damaged structures can constrain an operation.
  Some annotation edits retain tags/bookmarks while page organizing stays locked.
  Added content is not automatically tagged; no PDF/UA or PDF/A compliance is claimed.
- **Signatures and redaction:** visual signatures are not certificate-backed
  signatures or proof of identity. Editing can invalidate existing digital
  signatures. Redaction beta is gated and is not approved for public use.
- **Bounds:** typical editor limits are 50 MB per input, 500 pages and 1,000 added
  marks. OCR has a 20-megapixel limit and a three-minute deadline. Individual tools
  have additional limits; large or complex documents can be refused.

## Privacy and hosting

Local PDF operations process documents on your device without uploading their
contents. Avoid sharing private PDFs, extracted text, passwords or signatures in
issues or logs. Review exports before relying on them.

The repository still contains **legacy managed-service, account and billing code**
from an earlier architecture. Those integrations are not needed for the local
editor, and this project does not currently offer a paid cloud service. Local
account/cloud demonstration screens do not represent live processing services.
Removing obsolete backend code is separate work; its safeguards must not be
disabled or its demo providers exposed as a real service.

### Self-hosting

The browser quick start runs on your computer's loopback address. **Do not expose
the development server to the internet.** Self-hosting a production service is
**not yet a supported one-command setup**: a clean standalone production mode is
still needed. The legacy managed-server path is not an installation requirement
for ordinary users.

Before offering a shared deployment, review its supported configuration, HTTPS,
exact allowed origins, authentication/authorization, private storage, document
retention/deletion, worker isolation, limits, security and dependency licenses.
Never bypass startup checks or put trusted credentials in browser bundles.
The [legacy operations handbook](docs/operations/handbook.txt) documents the old
managed stack, not the free local-app setup.

## Development and verification

```powershell
pnpm check
pnpm test:browser
```

The first command checks formatting, lint, types, unit/component tests, native
permissions, dependency policy, sensitive files and builds. Browser tests also
require Playwright Chromium, qpdf **12.4.0**, Poppler, and Python with `pypdf`
**6.16.1**, `cryptography` **50.0.0** and Pillow **12.3.0**. These verification
tools are not required for normal browser use. Install Chromium with
`pnpm exec playwright install chromium`; configure `PDFMASON_QPDF_PATH`,
`PDFMASON_PYTHON_PATH` and Poppler on PATH. Tests use a dedicated loopback server
and synthetic fixtures, not a user's open documents.

Useful targeted checks include `pnpm test:local-text`, `pnpm test:pdf-corpus`,
`pnpm test:pdf-utilities`, `pnpm test:pdf-decorations` and `pnpm test:pdf-permissions`.
Native Windows changes also need locked Cargo tests, rustfmt and clippy. Server
and isolated Office/OCR-worker checks have separate Docker/tool requirements;
they are not needed to start the local editor.

The [OCR review](docs/dependencies/ocr-engine-review.json),
[model/API review](docs/dependencies/ocr-model-api-review.json) and
[experimental candidate record](docs/dependencies/ocr-minimal-candidate.json)
retain the detailed security work and reproducibility evidence. The research
candidate is not adopted; do not substitute it for pinned application assets.
The [text-engine review](docs/dependencies/source-text-engine-review.json) records
the selected original-text editing approach and its limits.

### Contributor safety rules

Keep originals immutable and verify outputs structurally, semantically and with
independent renders. Do not silently strip tags, forms or bookmarks, rasterize
content, downgrade encryption or bypass unsupported-document checks. Preserve
stable feature IDs, shared browser/Windows behavior and unrelated work.

Do not log document content, filenames, credentials or signature data. Use
synthetic/licensed fixtures only. Retain third-party notices and review exact
dependency provenance, native code and licenses before adoption. Do not change
storage keys, app identity or signing identity as a branding side effect.

### Publication hygiene

```powershell
pnpm repo:check
pnpm secret:scan
pnpm repo:history
```

These check the current publishable tree and locally reachable Git history for
known sensitive patterns. Only the root README is tracked as Markdown. Approved
fixtures, screenshots and icons have provenance/hash records; required source,
tests, lockfiles and license evidence should remain in the repository.

Ignore rules do not remove already-tracked files or history. Automated scans do
not prove an absence of all secrets; remote caches, forks and installer internals
need separate review. Making a repository public also exposes its Releases and
their attachments. Never rewrite history or delete release evidence without
coordination. See the [publication audit](docs/operations/publication-audit.json).

## Roadmap and launch

- Broaden supported text encodings, fonts, paragraph layouts and accessibility.
- Broaden OCR language/accuracy coverage and complete native parser/model review.
- Finish the standalone local/self-hosted production configuration and remove
  obsolete managed-service surfaces.
- Complete third-party notices/SBOMs. The conservative
  dependency review still has **28 notice-text gaps**, including **four prospective
  Windows npm inputs**; a passing policy check does not clear those gaps.
- Complete independent Windows installation, upgrade/uninstall, offline OCR,
  shortcuts/high-DPI, accessibility and export testing.

Publishing source is not proof of security, license clearance or release readiness.
Public distribution approval remains separate from local test success.

## License

**PDFrig is free for personal and business use.**

PDFrig's original code and documentation are open source under the
[MIT License](LICENSE). You may use, modify, redistribute and sell copies,
including for commercial use, provided you retain the copyright and license
notice. The software is provided without warranty.

Third-party components retain their own licenses and rights. Review the
[third-party notices](docs/dependencies/THIRD_PARTY_NOTICES.txt),
[local OCR native notices](docs/dependencies/LOCAL_OCR_NOTICES.txt),
[local OCR JavaScript notices](docs/dependencies/LOCAL_OCR_JS_NOTICES.txt) and
[remaining notice gaps](docs/dependencies/desktop-notice-review.json).
Separately licensed material, including the CC0 test fixtures and the OFL-licensed
Dancing Script font, keeps its existing terms. MIT does not clear missing
dependency notices or native security reviews, and it is not approval of the
existing Windows binaries for public distribution. Installer-specific licenses,
notices and verification remain part of each release's build records.
No trademark rights are granted by the source-code license.

Developed by [Kevin DeMara](https://github.com/kevindemara).
