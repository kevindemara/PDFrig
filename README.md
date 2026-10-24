<img src="docs/brand/pdfrig-logo.png" alt="PDFrig" width="240" />

# PDFrig - Build better PDFs

A local-first PDF editor for viewing, editing supported text, organizing pages,
adding annotations, filling forms and making searchable copies of scanned PDFs.
Your original file stays unchanged; save your work as a new PDF.

**Free for personal and business use.** No account, subscription, payment details
or paid service is needed for the local PDF tools. Start with the browser version
below; the Windows installer is an alternative if you prefer a desktop app.

**Public alpha release.** Expect document-specific limits and review every export.
PDFrig's own code is MIT-licensed. Native OCR security and third-party dependency
reviews are still in progress; this is not a security-certified release. See
[important limitations](#important-limitations) and [License](#license).

[Browser setup](#quick-start) · [Portable Windows ZIP](#portable-windows-zip) · [Windows installer](#install-the-finished-windows-app) ·
[Mac browser setup](#mac-browser-setup) · [AI-assisted setup](#set-up-with-an-ai-assistant) · [Features](#what-works-today) ·
[Self-hosting](#self-hosting) · [Build from source](#build-from-source)

## Quick start

### Browser version - recommended

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

### Mac browser setup

Mac users can run the **browser version from source**. There is currently no
native macOS `.app` or DMG download. These setup commands are checked against the
repository scripts; they have **not yet been tested on a Mac**, so macOS browser,
OCR and export compatibility still need manual verification.

Install the pinned [Node.js](https://nodejs.org/en/download) **24.19.0** for your
Mac's architecture (Apple Silicon or Intel), plus Git. Use an ordinary Terminal
window with zsh or bash; Rust, the full Xcode app, a Windows installer, Docker,
paid hosting and service accounts are not needed for browser setup. If Git is
missing, macOS may offer Apple's free Command Line Tools; those are for Git,
not a native PDFrig build. Review any system installer prompts yourself.

```sh
node --version
git --version
npm install --global pnpm@11.22.0
pnpm --version
git clone https://github.com/kevindemara/PDFrig.git
cd PDFrig
pnpm install --frozen-lockfile
pnpm web:dev
```

Verify Node and pnpm match `.nvmrc` and `package.json` before continuing. Stop if
a command fails. If global npm installation reports `EACCES`, use a user-owned
Node installation or npm prefix; do not change system-folder permissions or
run the app as root. See [npm's guidance](https://docs.npmjs.com/resolving-eacces-permissions-errors-when-installing-packages-globally).

Open [the editor](http://127.0.0.1:3000/workspace) or
[All tools](http://127.0.0.1:3000/tools). Keep Terminal open. **Control+C** stops
this server. Files stay local; initial dependency and verified OCR-model downloads
need internet. Check exports in Preview or another independent PDF reader. Safari
and other Mac browsers have not been validated on this host; report the browser
version if you encounter a problem.

If port 3000 is occupied, leave the other process alone and use a free loopback
port. For example, after installing dependencies, run:

```sh
pnpm build:packages
NEXT_PUBLIC_APP_URL=http://127.0.0.1:3101 \
PDFMASON_ALLOWED_ORIGINS=http://127.0.0.1:3101 \
pnpm --filter @pdfmason/web dev --port 3101
```

Then use `http://127.0.0.1:3101/workspace`. Do not bind to `0.0.0.0`, expose the
server through a tunnel, disable macOS protections or install the Windows EXE
to follow this guide. The [AI Builder prompt](SETUP_WITH_AI.txt) can also assist
with Mac browser setup; it must inspect the actual OS and shell first.

### Set up with an AI assistant

Prefer to have a coding assistant handle setup? Open
[**SETUP_WITH_AI.txt - AI Builder prompt**](SETUP_WITH_AI.txt)
([plain text](https://raw.githubusercontent.com/kevindemara/PDFrig/main/SETUP_WITH_AI.txt)),
copy the section between **BEGIN SETUP PROMPT** and **END SETUP PROMPT**, and paste
it into Codex or another coding assistant with local file and terminal access.

The prompt asks it to inspect your machine, install locked dependencies, build
the browser app, start a loopback-only server and verify the editor. It defaults
to the browser version; Windows installer source builds are a separate option.
You review prerequisite installations and any changes requiring permission.
A chat-only AI cannot run commands on your PC, and no assistant can guarantee
setup success or override device security. PDFrig requires no AI API key;
your chosen assistant's own usage terms are separate.

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

### PDF tables to XLSX or ODS

Use **All tools → PDF tables to spreadsheet** in the browser version or the
[portable Windows app](#portable-windows-zip). The older Windows installer linked
below does not include this feature. Browser development enables tables by default;
explicit builds use `NEXT_PUBLIC_FEATURE_TABLES_ENABLED=true` (Windows source builds:
`VITE_PDFMASON_TABLES_ENABLED=true`). The portable download already enables tables
and local OCR.

1. Open a PDF containing a table.
2. Choose a page, then drag around just its table. You can also enter the selection
   as Left/Top/Width/Height percentages.
3. Choose **Extract selectable text**. For an image-only scanned page, choose
   **OCR scanned table** and English or French. Local OCR requires
   `NEXT_PUBLIC_FEATURE_OCR_ENABLED=true` before starting the browser server;
   the existing native OCR security limitations still apply.
4. Compare the PDF and correction grid. Edit cells, add/remove rows or columns,
   and choose each column's data type. **Auto** converts plain decimal numbers but
   keeps leading-zero identifiers, ambiguous values and long digit strings as text.
   Choose an explicit decimal/percentage convention when required. Dates remain text.
5. For incorrect structure, open **Adjust row and column boundaries**. Enter
   increasing percentages across/down the selection and rebuild. Rebuilding replaces
   cell corrections. A blank boundary list produces a single column or row.
6. Check the review box, then **Save reviewed XLSX** or **Save reviewed ODS**.
   Any cell, type or layout change clears the review. Check the exported data in
   your spreadsheet program before using it for calculations.

This first version uses text spacing, not guaranteed table semantics or border
analysis. It handles one page/table at a time, up to 500 rows, 40 columns and
20,000 cells. Rotated/vertical text, mixed scan/text OCR pages, original formulas,
merged-cell reconstruction and cross-page table joining are not supported.
Yellow cells indicate low OCR confidence or a selection/boundary overlap, not a
calibrated accuracy score. All extracted values need review. The PDF and scanned
artwork are never modified; no spreadsheet formulas, macros or external links are
created from PDF text. XLSX includes a header filter range; ODS filtering can be
enabled in your spreadsheet program.

Work is session-only. Export before leaving the tool or closing the app. All
processing stays on this device with no paid service, spreadsheet application or
API required. Spreadsheet writing uses SheetJS Community Edition under
Apache-2.0; see [its retained license](docs/dependencies/upstream/SheetJS-0.20.3-Apache-2.0.txt).

### General troubleshooting

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

[**Download PDFrig-setup.exe**](https://github.com/kevindemara/PDFrig/releases/download/private-test-20261020-2/PDFrig-setup.exe)

- Windows x64, version `0.1.0-alpha.20261020.2`.

For the newer table extraction and spreadsheet exports, use the
[portable ZIP](#portable-windows-zip) or browser version. This installer remains
the earlier build; it has not been replaced by the portable download.

The [Windows release](https://github.com/kevindemara/PDFrig/releases/tag/private-test-20261020-2)
includes the finished installer,
[SHA256SUMS.txt](https://github.com/kevindemara/PDFrig/releases/download/private-test-20261020-2/SHA256SUMS.txt),
third-party notices and verification records. **You do not need to build the app.**

This is an **unsigned alpha release**. The current installer was tested for
same-machine upgrade, OCR, signatures, native Save As and unsaved-change warnings.
Independent checks verified searchable exports and unchanged scan appearance on
synthetic test documents. Clean-machine installation, disconnected-network OCR,
uninstall and broader security checks remain open. Windows compliance is not certified.

Use this version instead of `0.1.0-alpha.20261020.1`: it fixes a rare native-save
race that could overwrite a file created by another process during export.

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

The repository and linked release are public. **No GitHub sign-in is required**
to view the README/screenshots or download the installer and checksum file.
If a direct download fails, open the linked release page and select its asset;
do not bypass browser or Windows security warnings.

Installers are GitHub Release assets: no Windows installer EXE is included in
the tracked source files. See the [build evidence](docs/operations/windows-save-race-build.json)
and [download verification](docs/operations/windows-save-race-release.json) for exact
artifact hashes and test limits. These are historical build/test records, not
security certification or a complete license review.
For testing on another PC, use the [Windows release checklist](docs/operations/windows-release-checklist.txt).

### Portable Windows ZIP

[**Download PDFrig-portable-windows-x64.zip**](https://github.com/kevindemara/PDFrig/releases/download/v0.1.0-alpha.20261024.1/PDFrig-portable-windows-x64.zip)
— Windows x64, version `0.1.0-alpha.20261024.1`.

This no-install app includes **PDF table extraction to XLSX/ODS, a correction
preview and local OCR for scanned tables**. Scanned artwork stays unchanged.
Review every recognized value; OCR can make mistakes. Local application tests
and the maintainer's manual tests passed; broader platform testing remains open.

Download the ZIP and its accompanying
[SHA256SUMS.txt](https://github.com/kevindemara/PDFrig/releases/download/v0.1.0-alpha.20261024.1/SHA256SUMS.txt).
Verify the ZIP with `Get-FileHash`, extract **all** files into a
new folder, and run `PDFrig.exe`. Keep the `licenses` folder with it. No PDFrig
installation, administrator privileges, Node.js or Rust are needed. Do not run
the executable from inside the ZIP.

```powershell
Get-FileHash .\PDFrig-portable-windows-x64.zip -Algorithm SHA256
```

Compare the result with `SHA256SUMS.txt`. If the direct link fails, open the
[portable release page](https://github.com/kevindemara/PDFrig/releases/tag/v0.1.0-alpha.20261024.1)
and choose the ZIP under **Assets**. No GitHub account is required.

**Microsoft Edge WebView2 Runtime is required and is not bundled in this ZIP.**
If missing, use [Microsoft's official runtime installer](https://developer.microsoft.com/microsoft-edge/webview2/)
or the standard PDFrig installer, subject to your device policy. Initial runtime
setup may require internet. This is still an unsigned alpha: stop at a Windows
security block; do not bypass it.

This version runs without installing PDFrig but **stores settings/cache in the
Windows user profile**. This version uses a separate identity and profile
from the installed app. It is not a fully self-contained USB profile; close any
other copy of this same version before launching another one.
The ZIP creates no shortcuts, PDF associations or uninstall entry.

To update, close the app and extract the new ZIP into a separate folder. To
remove it, close it and delete only its app folder after saving any documents
elsewhere. User-profile settings/cache and WebView2 remain. See
[portable instructions](docs/operations/windows-portable-source-read-first.txt).
Clean-machine, missing-runtime and broader Excel/LibreOffice testing remain open.

For maintainers, `pnpm desktop:portable-build --output <unused-directory>` builds
the current source using the installed Windows build tools, performs local
source/notice checks and records the exact source and executable hashes. It
creates a no-install ZIP with matching notices, local OCR assets and no update
channel. It does not install PDFrig, upload anything or approve a public release.
The older `pnpm desktop:portable --source <reviewed-payload-directory> --output
<unused-directory>` command only repackages the previously pinned installer
payload; it does not include newer source changes.

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

The optional [AI setup guide](SETUP_WITH_AI.txt) helps users set up the browser
version and find the Windows build instructions. It is a user installation aid;
people downloading the finished Windows app do not need it. A successful source
build still requires independent testing and license/security review.

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

| Task                        | Support                                                                                                                                  |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Read                        | Search, select/copy searchable text, fit a full page, browse outlines and thumbnails                                                     |
| Edit original text          | Replace supported text and rewrap uniform paragraphs at the original font size; actual-PDF review and undo/redo                          |
| OCR                         | Local English/French recognition; add invisible search/copy text while keeping the visible scan unchanged                                |
| Organize                    | Merge, insert, reorder, rotate, duplicate, delete, split and extract compatible pages                                                    |
| Annotate                    | Text boxes/callouts, markup, comments, live drawing, shapes and stamps; drag/resize placed items                                         |
| Fill and sign               | Supported form fields and typed script-font, drawn or uploaded visual signatures                                                         |
| Create and refine           | Blank PDFs, images/plain text to PDF, page images, lossless compression, metadata, numbering, headers/footers, crop and bounded resize   |
| Tables (unreleased feature) | Current-page selectable-text or English/French OCR tables, correction grid and reviewed XLSX/ODS output; not yet in the linked installer |

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
**6.16.1**, `openpyxl` **3.1.5**, ReportLab **4.4.9**, `cryptography` **50.0.0**
and Pillow **12.3.0**. These verification
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
Earlier Windows [build](docs/operations/windows-license-audit-build.json) and
[download](docs/operations/windows-license-audit-release.json) records are retained
for audit history, not as recommendations to install an older build.

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

## Roadmap and release work

- Broaden supported text encodings, fonts, paragraph layouts and accessibility.
- Broaden OCR language/accuracy coverage and complete native parser/model review.
- Finish the standalone local/self-hosted production configuration and remove
  obsolete managed-service surfaces.
- Complete third-party notices and software bills of materials. The conservative
  build-input inventory has **25 notice-text gaps**: 24 other-platform Rust inputs
  and one optional Windows npm input. The Rust gaps are outside the Windows target;
  the exact installer audit found neither the optional npm input nor the removed
  Fontkit, dfa and Brotli dependencies in the current payload and embedded assets.
  Historical findings remain in the audit records; a passing policy check is not
  a complete distribution review.
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
