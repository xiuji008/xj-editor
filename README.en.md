# Markdown Desktop Editor (XJ-Editor)

[中文文档](README.md)

A desktop Markdown editor written "for myself", running standalone on Windows.

## Why This Program Exists

The goal of this program is **not to reinvent the wheel**. There are plenty of Markdown editors out there, but each one falls just short:

- I wanted **a single app that handles Markdown / HTML / JSON / plain text** editing and can also **preview images, PDFs, and Office documents** — instead of juggling a pile of separate tools;
- I wanted **workflow-level capabilities** like automatic image-host uploads, one-click document-to-Markdown conversion, and AI-powered one-click polishing/expansion — instead of assembling scattered plugins;
- I wanted **WYSIWYG** diagrams (Mermaid / PlantUML / Chart.js), KaTeX formulas, and GitHub-style alerts as everyday essentials that work out of the box — no extra configuration;
- I wanted an editor that **respects local files, works offline, and never sends data off the machine**.

No existing editor happened to satisfy all of these at once. So this program is not a replacement for anything — it is **a tool tailored to my own workflow**. Wherever something is awkward, I change it.

---

## Feature Overview

### Multi-Format Editing & Preview

| Format | Capabilities |
| --- | --- |
| **Markdown** | Source editing + live preview, with extended syntax, diagrams, formulas, code highlighting (see below) |
| **HTML** | Source editing + live preview in an iframe, automatic resolution of local relative assets, manual script reload |
| **JSON** | Source editing + WYSIWYG tree view, two-way sync, format/minify, real-time validation |
| **Text** | Plain text editing (txt / sql / xml etc.) with live line/character counts; `.js / .mjs / .cjs` files also get a "Run" button |
| **Images** | Preview of png / jpg / jpeg / gif / webp / svg / bmp / ico / avif |
| **PDF** | Built-in reader: page jump / zoom / fit-width & fit-page / highlight annotations / note panel / reading progress and notes, rendered locally via pdf.js |
| **Office** | Preview of doc / docx / xls / xlsx / ppt / pptx, with adaptive scaling for legacy `.doc` |
| **Archives** | Browse contents of zip / tar / gz / tgz / bz2 / xz; rar / 7z show file header info |

Markdown / HTML / JSON all support one-click switching between **Edit / Split / Preview** view modes.

### Markdown Rendering

- **Full syntax**: headings, lists, tables, blockquotes, task lists, footnotes, strikethrough, and more
- **Code highlighting**: 12 themes (GitHub Dark/Light, Dracula, Monokai, Nord, Atom, Xcode, VS, Solarized, etc.); code blocks come with a language tab bar, one-click copy, and one-click download (exported by language, e.g. `js` → `.js`, `python` → `.py`, `mermaid` → `.mmd`, unknown languages default to `.txt`)
- **Run scripts**: ` ```js` blocks (including `javascript / mjs / cjs / node`) show a "Run" button at the top-right; results stream into a bottom "Script Output" panel (no Node installation required — see "Run Scripts")
- **Mermaid diagrams**: flowcharts, sequence diagrams, Gantt charts, etc. (supports the `sequence` alias)
- **PlantUML diagrams**: uses the official online service by default, configurable to a private deployment; supports SVG / PNG
- **Chart.js charts**: draw pie / bar / line / area / radar / doughnut charts with a minimal JSON syntax, or full native configuration
- **Math formulas**: KaTeX renders inline `$...$` and block `$$...$$`
- **Alerts**: `> [!NOTE/TIP/IMPORTANT/WARNING/CAUTION]` GitHub-style, with customizable titles
- **YAML Front Matter card**: document metadata (title / tags / category / description / dates) rendered as an info card
- **Image enhancement**: `![caption](url)` automatically renders as a figure with a caption (figcaption)

### UI & Appearance

- **Light / Dark / Follow system**: toggle with the sun/moon toolbar buttons ("Settings → Appearance" offers follow-system mode); no first-paint flash, multi-window sync; dark mode covers the toolbar, file tree, editor, preview, dialogs, Git and terminal panels, while chart containers and PDF pages stay light; HTML / Word export is unaffected by the theme
- **Display fonts**: body font (Markdown preview) and editor font (source pane) are set independently; built-in presets for Chinese / calligraphy / Latin / monospace families with live samples; changes apply instantly and persist across restarts
- **Preview zoom**: Markdown / HTML preview supports 25% ~ 500% zoom (10% steps) via toolbar `-` / percentage (click to reset to 100%) / `+`; `Ctrl + wheel` zooms anchored to the preview's center line; the zoom level is remembered
- **Code highlight themes**: 12 themes switchable at any time; preview and HTML export stay in sync

### Editing Experience

- **Table of contents (TOC)**: floating TOC in the preview pane, auto-extracts h1–h6, smooth-scroll on click, highlights the current section while reading
- **Sync scrolling**: line-anchored two-way sync between source and preview, accurate even with asynchronously loaded diagrams/images
- **Find / Replace**: `Ctrl+F` find, `Ctrl+H` replace, with case sensitivity, live highlighting of all matches and the current one, replace / replace all, and F3 navigation
- **Smart undo / redo**: custom history stack (consecutive typing merges into one step, toolbar actions get their own step, capped at 200), reliable `Ctrl+Z` / `Ctrl+Y`
- **Selection floating buttons**: selecting text pops up "Ask AI" and "Generate diagram" entries — send the selection to the AI assistant or generate diagram code from a description
- **Adaptive toolbar**: when space runs out, buttons collapse into a "More" dropdown; common templates (headings / lists / code blocks / links / tables / diagrams / formulas / alerts) insert with one click
- **Insert-link dialog**: fill in the target URL and display text separately; missing protocols auto-prefixed with `https://`; when no text is selected the URL doubles as the display text
- **External preview links**: `http(s)` / `mailto:` / `tel:` links in the preview open in the system default browser instead of navigating the app window; links to local files still open in-app
- **Paste-image feedback**: after pasting an image, an "Uploading image…" placeholder appears at the paste position (showing a count for multiple images), removed automatically when the upload finishes or fails; it follows scrolling and hides when scrolled out of view
- **Large-file protection**: plain text files over 2 MB (txt / sql / log etc.) become read-only previews of the first 512 K characters, avoiding layout freezes from huge textarea content; such files cannot be saved in place — use "Open with system default app" instead

### Document Metadata (YAML Front Matter)

The `---` metadata block at the top of a document renders as a blue-themed card (title / category / series / tags / keywords / author / status / created / updated / summary).

- **One-click metadata update**: the "Update Metadata" button in the AI panel (or on the toolbar) reads the full document, generates/completes metadata, and merges it back into the front matter; `Ctrl+Z` undoes it
- **Times maintained by the system**: `createDate` keeps the first written value, and `lastUpdateDate` refreshes automatically on metadata updates and every save; values returned by AI for these two fields are ignored, and manual edits are overwritten on save
- **Only supported fields are written**: 9 business fields (`title`, `emoji`, `description`, `keywords`, `tags`, `category`, `series`, `author`, `status`) plus 2 system time fields; the AI only outputs fields it is confident about (no empty placeholders), and existing reasonable values are left untouched; unsupported fields are never written
- **No comments in the metadata block**: only `key: value` lines — no group headings or field descriptions

Example (a metadata block after one-click update):

```yaml
---
title: Markdown Metadata in Practice
emoji: 📝
description: Field design for Markdown metadata and how AI maintains it automatically.
keywords: Markdown, metadata, Front Matter, AI
tags: [Markdown, metadata, automation]
category: Tech Notes
series: Editor Practice
author: Zhang San
status: published
createDate: 2026-09-21 10:00:00
lastUpdateDate: 2026-09-21 11:22:33
---
```

### Image Handling

- **Insert / paste images**: multi-select local images or paste from the clipboard
  - Local mode: images are copied to an `images/` folder next to the current file, with relative paths inserted
  - Image-host mode: images upload automatically and the URL is inserted
- **Pasting local file paths** converts them into Markdown links automatically
- **Right-click save-as**: images / Mermaid / Chart diagrams in the preview can be exported as PNG or saved with one click

### Image Hosting

- **Local storage**: default mode; images go into a sibling `images/` folder
- **PicGo**: integrates with a local PicGo HTTP service (default `127.0.0.1:36677`), batch upload supported
- **Custom image host**: compatible with the Chevereto API v1 spec, with a custom upload endpoint and API key; image URLs in the response are matched automatically (with array-index and multi-path smart fallback)
- Built-in "select image to test upload" to verify the configuration

### One-Click Convert to Markdown

Office / PDF / RTF / EPUB / ODT / CSV documents can be converted to Markdown **locally** (via anydoc; files never leave the machine, no network needed):

- Supports Word (doc/docx/docm), PPT (ppt/pptx/pps/pot), Excel (xls/xlsx/xlsm/xlsb), OpenDocument (odt/ods/odp), RTF, EPUB, CSV, PDF
- A same-named `.md` is generated in the same folder (numbered suffix on name conflicts) and opened for editing automatically
- Embedded images follow the image-host configuration: exported locally to an `xxx-assets/` folder or uploaded to the image host (automatic local fallback on upload failure)
- Clear error messages (scanned PDFs need OCR, encrypted files, corrupted files, etc.)

### AI Assistant

Comes with 8 vendor presets: **OpenAI, Anthropic Claude, Google Gemini, DeepSeek, Moonshot Kimi, Alibaba Qwen, Zhipu GLM, Ollama (local)**; supports OpenAI-compatible / Anthropic / Google Gemini protocols, and custom vendors can be added.

- **Quick tasks**: 11 built-in generation types — polish, expand, condense, summary, title, translate, continue writing, proofread, formatting, keyword digest, metadata; apply to the whole document or the selection with one click (more than 6 types collapse into a "More" dropdown)
- **Customizable prompts**: every built-in type has a default prompt that can be edited in "AI Panel → Quick Prompts" or "Settings → Quick AI", including scope, result handling, disable, reorder, adding custom types, and one-click restore to defaults (persisted to `{userData}/quick-ai.json`)
- **Generate diagrams**: select descriptive text (or type in the input box), pick **Mermaid / PlantUML / Chart**, and generate code in one click; insert at the cursor (replacing the selection) or at the end of the document; new types only require one entry in `DIAGRAM_TYPES` and the dropdown plus prompt pick it up automatically
- **Summary generation**: inserts a `> [!NOTE] Article Summary` alert below the title automatically
- **One-click metadata update**: the AI reads the full document to generate/complete metadata and merges it into the front matter, writing only supported fields without comments; `createDate` and `lastUpdateDate` are maintained by the system (see "Document Metadata")
- **Applying results**: replace the whole document / append to end / insert at cursor / insert at top / insert below title / update metadata / copy — all undoable with `Ctrl+Z`
- **File references**: multi-select files as context — text (auto-truncated when too long), images (multimodal), Office/PDF auto-converted to Markdown
- **Multiple sessions**: "New Chat" starts a fresh session; "History" lets you browse, search, switch, rename, and delete past sessions ordered by update time; sessions persist to `{userData}/ai-chats.json` and survive restarts, reopening the last active session
- **Standalone chat window**: move the chat into a dedicated window (`#ai-chat`) to chat while writing; it shares session data with the main panel in real time
- **Streaming responses**: replies render as they stream; "Stop" is available at any time (keeping what was generated); vendors without streaming automatically degrade to a single response
- **Multi-turn context**: free-form chats carry the last 20 messages (~16 K characters) as context; quick tasks / diagram generation stay single-turn to avoid interference
- **Test connection**: verify vendor configuration with one click
- Configuration persists to local JSON; the panel shows a hint when no API key is configured

### AI Call Logs

Every LLM call (polish / expand / summary / diagram / commit message / connection test) is logged automatically, viewable in "Settings → AI Call Logs":

- **Monthly storage**: `{userData}/ai-logs/ai-log-YYYY-MM.json`; open the log directory or clear a specific month from the UI
- **Recorded content**: time, scene, vendor & model, protocol & endpoint, actual request params and messages, response body, finish reason, duration, interrupted / degraded flags
- **Token stats**: prefers server-reported usage (streaming requests request it via `stream_options`); when absent, usage is estimated from character counts and flagged as "estimated"; input / output / total are shown in the list
- **Aggregate view**: filter by month, scene, and status, keyword search, pagination, plus call counts, success/failure, input/output/total tokens, and average duration
- **Security**: secret fields such as API keys are masked as `***`, image base64 is never written to disk, and overlong text is truncated

### File Management

- **Directory tree sidebar**: browse all files after opening a folder; resizable, with expanded state and recent folders **restored across restarts**
- **File operations**: create, open, save, save as, export HTML; context menu supports new file/folder, rename, delete, copy/paste (`Ctrl+C` / `Ctrl+V`), reveal in folder, open with system default app
- **Copy to system / drag to system**: `Ctrl+C` in the tree (or right-click "Copy") also writes to the system clipboard so you can `Ctrl+V` on the desktop or in Explorer; dragging a node to the desktop or a folder copies the file
- **Encoding detection**: automatic recognition of UTF-8 / UTF-16LE / UTF-16BE
- **Click the top file name to rename**; the status bar shows line count, character count, and file path live
- **Unsaved marker**: prominent indicator on the title and file name, with a save confirmation before switching/closing
- **Built-in scratchpad**: a fixed file `暂存区.md` (Scratchpad) in the install directory (falls back to the app data directory when not writable) for temporarily stashing content; **not shown in the tree** — open it via the toolbar "Scratchpad" button; auto-saved and clearable

### Export to Word

- **Two entry points**: the toolbar "Export Word (.docx)" (Markdown files only; choose a save location) and the editor toolbar "To Word" (generates a same-named `.docx` in the same folder, confirming before overwrite)
- **Native structure**: reuses the Markdown rendering pipeline to produce rich HTML, then converts it into native Word paragraphs/tables (headings, lists, tables, quotes, code blocks keep theme colors, plus images and the Front Matter card)
- **Diagrams & images**: Mermaid / Chart diagrams are encoded from the DOM into images and embedded; local images are downsampled to A4 body width to keep the docx size reasonable
- **Fully local**: the whole conversion runs in the renderer process — no network, no uploads; unconvertible elements (e.g. broken image paths) are reported in a summary after export

### Export to PDF

The toolbar "printer" button exports the current document as a **vector PDF** (selectable, searchable text — not a screenshot); a settings dialog appears first:

- **Supported formats**: Markdown, HTML, JSON, plain text, images (one image per page, scaled and centered), Word (`.docx` only); `.doc` / Excel / PPT are not supported yet
- **Page setup**: A3 / A4 / A5 / Letter / custom millimeter sizes, portrait or landscape, page margins (8 / 14 / 20 / 25 mm), content scale (75% ~ 200%), and a "Page N of M" footer toggle; choices persist to `localStorage`
- **Content fidelity**: Markdown reuses the preview rendering pipeline (vector Mermaid, Chart.js charts, KaTeX formulas, code highlighting and theme colors all preserved); KaTeX fonts are inlined as data URLs so the temporary print page can always load them
- **Implementation**: the renderer generates print HTML (or supplies the source file path), and the main process uses a hidden window's Chromium `printToPDF`; HTML / images print the source file directly so relative CSS and images work naturally; `.docx` is rendered off-screen by docx-preview (images base64-encoded) — nothing is screenshotted from the app window
- **Degradation notices**: items that could not be resolved (e.g. some image paths) are summarized in a notice (up to 5 entries) without blocking the rest of the export

### Git Version Control

After opening a Git repository folder, a Git panel appears below the tree (hidden in non-repo folders; `Ctrl+Shift+G` or the toolbar Git button toggles it):

- **Clone from Git**: the toolbar "Open from Git" takes a repo URL (HTTPS / SSH / local path), target folder, and optional branch; clone progress and logs stream live, and the project folder opens automatically on completion
- **Auto detection**: `git rev-parse` detects repos, supporting opening in any subdirectory; a hint appears if Git is not installed, and the panel ⋯ menu allows specifying the `git.exe` path manually
- **Change list**: grouped into "Conflicted / Staged / Unstaged (incl. untracked)" with status badges (M modified, A added, D deleted, R renamed, U untracked, ! conflict); tree nodes show matching badges and descendant change counts
- **Stage & commit**: checking a file stages it (unchecking unstages), with group check; commit messages support multiple lines and quick backfill from history, `Ctrl+Enter` commits; committing is blocked when conflicts or unstaged changes exist
- **AI commit messages**: stream-generate a commit message from staged changes (all changes if nothing staged); interruptible while generating, with confirmation before overwriting existing text
- **Commit conventions**: the ⋮ menu "Commit convention settings…" edits the convention text and AI prompt templates (full/concise presets, restorable); with pre-commit validation enabled, non-conforming messages only warn — you can still confirm and commit
- **Diff view**: clicking a file shows a line-by-line diff with inline/side-by-side toggle and copy; compare the working tree, the index, or a specific commit
- **History**: repo-wide and per-file history (`--follow`, tracing past renames), with keyword filtering, load-more, and per-commit diffs
- **Discard changes**: "Discard this file" in a file's context menu drops uncommitted modifications (with confirmation)
- **Branch management**: clicking the branch name opens a branch dialog showing local/remote branches (with upstream and ↑↓), switch, create & switch, and delete local branches (falls back to `-D` if `-d` fails); remote branches can be checked out as same-named local branches with tracking
- **Remote sync**: ↓ / ↑ buttons in the panel header pull/push directly; the ⋮ menu also offers "Fetch remote updates" (`fetch --prune`); pushing without an upstream asks to set one (`-u`); remote operations time out at 120 s with interactive credential prompts disabled so the UI never hangs; auth failures, non-fast-forward rejections, missing upstream, unreachable networks, and merge conflicts all surface as specific messages
- **Stash**: the ⋮ menu "Stash…" saves current changes (with a description, optionally including untracked files `-u`), and supports apply (keep), pop (apply + drop), and delete
- **Ignore rules**: the ⋮ menu "Edit .gitignore…" edits the repo root's ignore rules directly (rule count, unsaved-close reminder); "Add to .gitignore" in a file's context menu writes `/file` or `/dir/` automatically with dedup, and warns that tracked files need `git rm --cached` first
- **Implementation notes**: the main process shells out to the system-installed git (`electron/git.cjs`) with no third-party dependencies; write operations are serialized per repository; Chinese paths and UTF-8 output are normalized; credentials are not managed in-app — the system's SSH agent / credential helper is used

### Terminal (Command Line)

Click the toolbar terminal icon or press `` Ctrl+` `` to open the terminal panel at the bottom of the window (or right-click a tree node and choose "Open command line here"); styled after VS Code:

- **Opens in place**: starts in the currently open directory by default; right-clicking a file node starts in that file's folder
- **Multiple tabs**: `+` opens several terminals with labels like `1: PowerShell`, individually closable; switching tabs preserves each terminal's output and history
- **Shell choice**: auto-detects PowerShell / Command Prompt / Git Bash / WSL (uninstalled ones hidden); `▾` picks a specific one for new terminals, and the choice is remembered
- **Common actions**: `↑` `↓` scroll through history, `Ctrl+C` interrupts (still copies when text is selected), `Ctrl+L` clears the screen, multi-line paste executes line by line; clear / interrupt / close buttons all present
- **Execution feedback**: after Enter the command echoes into the output area and the input line hides while running; the prompt and input reappear after execution ends (output idle ~0.3 s), matching VS Code
- **Adjustable height**: drag the panel's top edge; closing the panel does not kill the terminals inside — reopen to continue
- **System terminal**: right-click a tree node → "Open in system terminal" to launch a **real terminal window** (auto-detects Windows Terminal / Ghostty / PowerShell 7 / PowerShell / Command Prompt / Git Bash, uninstalled ones hidden) with a full TTY for fullscreen programs like vim / less / tmux / Claude Code; when multiple are detected a submenu lets you pick, and the choice is remembered

> Note: the built-in panel is driven by the main process (`electron/terminal.cjs`) starting the system shell through pipes, with no native dependencies; Chinese output on Windows is auto-detected as UTF-8 / GB18030 and never garbled. Due to pipe mode, fullscreen programs requiring a real TTY (vim, less, etc.) cannot run in the panel — use "Open in system terminal" instead; ordinary commands and interactive REPLs like `python` / `node` work fine.
>
> The roadmap, acceptance criteria, and phased rollback plan for integrating a real PTY (node-pty + xterm.js) are documented in `docs/内置终端接入PTY改造方案.md` (Chinese).

### Run Scripts (JS)

The editor has built-in JS script execution, with two entry points sharing the bottom "Script Output" panel:

- **Run `.js` files**: opening `.js / .mjs / .cjs` shows a green "Run" button in the top toolbar; clicking runs the current script (unsaved changes are saved first), streaming stdout / stderr into the panel and showing the exit code
- **Run ` ```js` blocks**: in Markdown preview, `js / javascript / mjs / cjs / node` code blocks show a "Run" button at their top-right; the block's content runs with the document folder as the working directory
- **Output panel**: the bottom "Script Output" panel distinguishes stdout (normal color) / stderr (red) / system notices (gray), with clear, stop, and close controls; a status shows while running and the exit code appears on completion (red when non-zero)
- **No Node installation needed**: the main process prefers the system `node` (friendlier error stacks) and falls back to Electron's built-in Node (`ELECTRON_RUN_AS_NODE`) when absent — works even in packaged builds
- **Safety measures**: 60-second timeout with automatic termination, 5 MB output cap with truncation, process-tree cleanup, and UTF-8 / GB18030 auto-detection for Chinese output on Windows

> Note: scripts run in the main process `electron/script.cjs`, which spawns a Node child process via `child_process`; output streams back through `window.mdAPI.script` (with `contextIsolation`, no Node capabilities are exposed to the renderer — IPC channels only). Arbitrary code execution only happens when the user clicks "Run" — never automatically.

### Toolbox

The toolbar "Toolbox" button or `Ctrl+Alt+T` opens a right-side drawer (full-screen capable) with everyday dev utilities:

| Tool | Category | Capabilities |
| --- | --- | --- |
| **JSON formatter** | Text processing | Dual-pane workbench (source + virtual-scrolling tree), lazy loading and search for large JSON, format / minify / sort keys / escape & unescape |
| **Base64 codec** | Encoding | Text ↔ Base64 with URL-safe alphabet support |
| **Hash calculator** | Hashing | MD5 / SHA-1 / SHA-256 / SHA-384 / SHA-512, with HMAC keys |
| **Timestamp converter** | Date & time | Auto-detects seconds / milliseconds; outputs local time, ISO, and UTC |
| **Process manager** | Dev helpers | Find and kill processes by port / name / PID (including children) — the cure for "port already in use"; system-critical processes and the app itself are blocked |

- **Common abilities**: category filter, keyword search, favorites and recents; some tools (e.g. the JSON formatter) can insert their result at the current cursor position
- **Implementation notes**: the process manager only uses built-in system commands (Windows: `netstat` / `tasklist` / `taskkill` / PowerShell; POSIX: `ps` / `lsof` / `kill`) with no third-party dependencies; PIDs are converted to numbers before being concatenated into commands, eliminating command injection

### System Integration

- **File associations**: after registering, double-clicking `.md` files opens them in this editor; other text/code extensions (txt/json/xml/csv/html/js/ts/py etc., ~30 types) join the "Open with" candidates (writes to the current user's registry only — no admin rights needed, one-click unregister)
- **Drag-and-drop / command line**: drop a file onto the shortcut, or run `Markdown编辑器.exe document.md` to open it; if the app is already running, the existing window takes over
- **Single instance**: repeated launches hand files to the existing window
- **F12** toggles DevTools at any time (`--debug` opens them on launch)

## Keyboard Shortcuts

| Shortcut | Action |
| --- | --- |
| `Ctrl+N` | New document |
| `Ctrl+O` / `Ctrl+Shift+O` | Open file / open folder |
| `Ctrl+S` / `Ctrl+Shift+S` | Save / Save as |
| `Ctrl+F` / `Ctrl+H` | Find / Replace |
| `F3` / `Shift+F3` | Next / previous match |
| `Ctrl+Z` / `Ctrl+Y` | Undo / Redo |
| `Ctrl+C` / `Ctrl+V` (file tree) | Copy / paste files or folders (`Ctrl+C` also writes to the system clipboard, so you can paste onto the desktop etc.) |
| `Ctrl+Shift+T` | Open the built-in Scratchpad |
| `Ctrl+Shift+G` | Show / hide the Git panel |
| `` Ctrl+` `` | Show / hide the terminal panel |
| `Ctrl+Alt+T` | Toggle the toolbox |
| `Ctrl+wheel` (preview) | Zoom the Markdown preview |
| `F12` | Developer tools |

## Project Structure

```
xj-editor/
├── electron/                 # Electron main process & preload scripts
│   ├── main.cjs              # Windows, file system, single instance, mdlocal:// protocol, PDF export
│   ├── process.cjs           # Process management (query/kill by port / name / PID, system commands)
│   ├── docConvert.cjs        # Local document-to-Markdown conversion (anydoc WASM)
│   ├── ai.cjs                # AI requests (multi-vendor / multi-protocol / multimodal)
│   ├── aiLogger.cjs          # AI call logs (monthly JSON on disk / masking / token stats)
│   ├── aiChats.cjs           # AI chat session persistence (multi-session / history, shared across windows)
│   ├── quickAi.cjs           # Quick AI types & built-in prompts (customizable, JSON persisted)
│   ├── git.cjs               # Git version control (system git, serialized writes)
│   ├── commitSpec.cjs        # Git commit convention config (AI commit messages)
│   ├── fileassoc.cjs         # Windows file associations
│   ├── terminal.cjs          # Built-in terminal (piped shell) & system terminal detection
│   ├── script.cjs            # JS script runner (Node child process, for .js files / ```js blocks)
│   └── preload.cjs           # Renderer bridge layer (window.mdAPI)
├── src/
│   ├── components/
│   │   ├── MarkdownEditor.vue    # Core Markdown editor
│   │   ├── HtmlEditor.vue        # HTML editing + live preview
│   │   ├── JsonEditor.vue        # JSON editing + tree view
│   │   ├── TextEditor.vue        # Plain text editing
│   │   ├── FilePreview.vue       # Image / PDF / Office / archive preview
│   │   ├── FindBar.vue           # Shared find / replace component
│   │   ├── AiPanel.vue           # AI assistant panel (multi-session / streaming)
│   │   ├── AiChatWindow.vue      # Standalone AI chat window (#ai-chat, shares sessions)
│   │   ├── AiChatHistoryDialog.vue # Chat history (search / switch / rename / delete)
│   │   ├── AiConfigDialog.vue    # AI vendor configuration
│   │   ├── AiLogDialog.vue       # AI call log viewer (list / stats / detail)
│   │   ├── TerminalPanel.vue     # Bottom terminal panel (multi-tab / resizable)
│   │   ├── TerminalView.vue      # Single terminal view (output rendering / input)
│   │   ├── TerminalIcon.vue      # Terminal icon
│   │   ├── ScriptOutputPanel.vue # Script output panel (results of .js files / ```js blocks)
│   │   ├── PdfExportDialog.vue   # PDF export page setup (paper / orientation / margins / scale / page numbers)
│   │   ├── pdf/                  # PDF reader (pdf.js)
│   │   │   ├── PdfViewer.vue     # Reader shell (page jump / zoom / highlights / notes)
│   │   │   ├── PdfPage.vue       # Per-page rendering & text selection
│   │   │   ├── PdfNotesPanel.vue # Annotation list
│   │   │   └── PdfNoteCard.vue   # Annotation card (Markdown rendering / AI notes)
│   │   ├── Git*.vue              # Git panel & dialogs (changes / diff / history / branches / stash / clone)
│   │   ├── ImageHostingConfigDialog.vue  # Image hosting configuration
│   │   ├── PlantUmlConfigDialog.vue      # PlantUML service configuration
│   │   ├── FileAssociationsDialog.vue    # File associations
│   │   └── settings/                     # Unified "Settings" window (categories on the left + config on the right)
│   │       ├── SettingsDialog.vue        # Settings shell (category nav / save & unsaved hints)
│   │       ├── AppearancePanel.vue       # Appearance: app theme, default view, display fonts, highlight theme
│   │       ├── ImageHostingPanel.vue     # Images & image hosting
│   │       ├── PlantUmlPanel.vue         # PlantUML service
│   │       ├── AiConfigPanel.vue         # AI vendor configuration
│   │       ├── QuickAiPanel.vue          # Quick AI types & prompt customization
│   │       └── FileAssociationsPanel.vue # File associations
│   ├── QuickAiPromptsDialog.vue  # Quick AI prompt editor dialog (from the AI panel)
│   ├── composables/
│   │   ├── useAiChat.ts          # AI chat composable (sessions / streaming / interrupt)
│   │   ├── useTheme.ts           # Light / dark / follow-system theme (multi-window sync)
│   │   └── usePdfDocument.ts     # pdf.js document loading (worker / cmap / runtime compat patches)
│   ├── utils/
│   │   ├── aiChat.ts             # AI chat session I/O & context building
│   │   ├── markdown.ts           # Markdown rendering (diagrams/formulas/highlight/sync scroll)
│   │   ├── docxExport.ts         # Markdown → Word (.docx) conversion
│   │   ├── git.ts                # Git output parsing & change status assembly
│   │   ├── commitSpec.ts         # Commit convention & AI commit-message prompts
│   │   ├── metadata.ts           # Metadata field list & AI metadata merge (no comments, system-maintained times)
│   │   ├── history.ts            # Custom undo / redo history stack
│   │   ├── find.ts               # Find navigation & highlighting
│   │   ├── imageHosting.ts       # Image-host uploads
│   │   ├── ai.ts                 # AI configuration, chat & diagram generation
│   │   ├── quickAi.ts            # Quick AI type config & prompt rendering
│   │   ├── plantUmlConfig.ts     # PlantUML service configuration
│   │   ├── previewZoom.ts        # Preview zoom (25% ~ 500%, Ctrl+wheel)
│   │   ├── printExport.ts        # Multi-format PDF export (print HTML generation / page params)
│   │   ├── fonts.ts              # Display font list & CSS variable delivery
│   │   ├── pdfNotes.ts           # PDF annotations & notes (sidecar on disk)
│   │   ├── pdfAi.ts              # PDF AI note generation
│   │   ├── terminal.ts           # Terminal line buffering (ANSI parsing) & prompt computation
│   │   ├── scriptRunner.ts       # Script runner singleton state (output subscription / panel visibility / stop)
│   │   └── fileUtils.ts          # Paths / file types / mdlocal:// utilities
│   ├── styles/
│   │   ├── code-themes/          # 12 code highlight themes
│   │   └── dark.css              # Dark theme variables & component overrides
│   ├── tools/                    # Toolbox (registry / categories / drawer / widgets)
│   ├── App.vue                   # App shell (toolbar / tree / status bar)
│   └── main.ts                   # Entry point
├── docs/                     # Design documents (e.g. terminal PTY migration plan, in Chinese)
├── scripts/                  # Build scripts (copy pdf.js assets / after-pack)
├── release_app/              # Packaged output
│   ├── Markdown编辑器 Setup 1.0.0.exe   # NSIS installer
│   └── win-unpacked/                   # Portable build
└── package.json
```

## Development & Debugging

```bash
npm install
npm run dev:electron   # Starts the Vite dev server + Electron
```

## Packaging as an exe

```bash
npm run dist
```

Output goes to the `release_app/` directory:

- `Markdown编辑器 Setup 1.0.0.exe` — the installer (recommended; registers file associations during setup)
- `win-unpacked/` — portable build; double-click `Markdown编辑器.exe` to run

> Note: `package.json` ships with packaging compatibility settings to avoid common problems in non-admin Windows environments:
> - `CSC_IDENTITY_AUTO_DISCOVERY=false`: skips automatic code-signing discovery
> - `win.signAndEditExecutable=false`: skips exe signing/editing (avoids the `winCodeSign` symlink permission error)
> - The output directory is fixed to `release_app/` (avoids cleanup failures when stale files in the old `release/` folder are locked by system handles)

> If packaging hits the `winCodeSign` symlink permission error, use:
> ```bash
> npx electron-builder --win nsis --config.win.signAndEditExecutable=false
> ```

## Opening Files from File Explorer

1. **File associations**: open "Settings → File Associations" → "Register file associations".
   Once registered (writes only to the current user's registry `HKCU`, no admin rights needed):
   - Double-clicking `.md / .markdown / .mdown / .mkd` opens them in this editor
   - Right-click a text file → "Open with" → "Choose another app" shows "Markdown Editor"
   - The NSIS installer registers these extension associations automatically

2. **Drag onto the shortcut**: drop a document onto the desktop/Start-menu shortcut or the app icon to open it.
   When the editor is already running, files go to the existing window (single-instance lock, auto focus). The command line works too: `Markdown编辑器.exe document.md`.

## Tech Stack

### Core Framework

| Module | Technology | Purpose |
| --- | --- | --- |
| UI framework | **Vue 3 + Element Plus** | UI components (toolbar, tree, dialogs, status bar, etc.) |
| Desktop shell | **Electron 33** | Cross-platform desktop app; the main process handles the file system, windows, protocols, and system integration |
| Build | **Vite + TypeScript + vue-tsc** | Frontend build, type checking, and hot-reload development |
| Packaging | **electron-builder** (NSIS) | Produces the installer and portable build |

### Content Rendering (Markdown / HTML / JSON)

| Module | Technology | Purpose |
| --- | --- | --- |
| Markdown parsing | **marked 18** | Parses Markdown source into HTML (GitHub-flavored extensions) |
| Code highlighting | **highlight.js** | Language highlighting with 12 switchable themes |
| Math formulas | **KaTeX** | Inline/block LaTeX rendering |
| Diagrams | **Mermaid 11** | Flowcharts, sequence diagrams, Gantt charts, etc. |
| Charts | **Chart.js 4** | Pie/bar/line charts via a minimal JSON syntax |
| PlantUML | **pako** (deflate + base64) | Encodes PlantUML source and requests rendering from the service (official online by default, configurable to private deployments) for SVG/PNG |
| HTML preview | **iframe sandbox** + auto-injected `<base>` | WYSIWYG preview of local HTML with relative assets loading |
| JSON view | **highlight.js + custom tree** | JSON syntax highlighting + tree node editing, two-way synced with the source |

### Office Preview

| Module | Technology | Purpose |
| --- | --- | --- |
| Office rendering | **@open-file-viewer (vue + core, incl. officePlugin)** | Renders doc/docx/xls/xlsx/ppt/pptx locally |
| Legacy .doc | Container-width adaptive scaling | A4-proportional scaling + max-visual-width centering for the legacy binary format |
| Preview data source | Main-process `mdlocal://` privileged protocol | Reads file streams over a local protocol without exposing file contents to the browser network stack |

> Note: Office / archive preview completes entirely in the renderer process; files are read via `mdlocal://`, with no third-party online conversion service.

### Archive Preview

| Module | Technology | Purpose |
| --- | --- | --- |
| Archive browsing | **@open-file-viewer/core's archivePlugin** | Lists entries (name / size / directory structure) with per-entry preview or download |
| zip | **JSZip** | Full parsing, including encrypted-archive detection |
| tar / gz / tgz / bz2 / xz | **pako + seek-bzip + xz-decompress** | Decompressed and shown as tar entries or single files |
| rar / 7z | Header probing | Browser-side extraction is not possible, so format info and a download entry are shown |

> Note: all archive parsing happens locally in the renderer; nothing is uploaded. rar / 7z lack browser-side decompression, so only header info plus download is offered.

### Document-to-Markdown Conversion

| Module | Technology | Purpose |
| --- | --- | --- |
| Conversion engine | **@firecrawl/anydoc-wasm** | WebAssembly bindings for the Rust anydoc library, converting locally in the Electron main process |
| Conversion mode | `initSync` loading wasm bytes directly | No fetch involved — **fully local conversion**, no network requests, files never leave the machine |
| Supported formats | Word (doc/docx/docm), PPT (ppt/pptx/pps/pot/pptm/ppsx/ppsm), Excel (xls/xlsx/xlsm/xlsb), OpenDocument (odt/ods/odp), RTF, EPUB, CSV, PDF | Outputs GitHub-flavored Markdown; CSV uses an explicit format, the rest is auto-detected |
| Embedded images | Extraction from the document model's assets | Local mode exports to an `xxx-assets/` folder; image-host mode uploads and references URLs (automatic local fallback on failure) |
| Error handling | Error-code mapping (needsOcr / encrypted / malformed, etc.) | Clear user-facing messages (e.g. scanned PDFs need OCR first) |

### PDF Reading & Export

| Module | Technology | Purpose |
| --- | --- | --- |
| PDF reading | **pdfjs-dist 6** + custom PdfViewer | Local rendering, only visible pages render; page jump, zoom, fit-width / fit-page, text-selection highlight annotations, note panel, reading progress memory |
| Runtime adaptation | **polyfill + Blob Worker** | Polyfills ES2025 methods missing in Chromium 130 (`Math.sumPrecise`, `Map.getOrInsertComputed`, etc.); the worker is inlined to bypass Worker CORS restrictions under `file://` |
| Annotations & notes | sidecar `original.notes.json` | Highlights and Markdown notes are stored alongside the document; AI can generate notes |
| PDF export | **Chromium `printToPDF`** (hidden window) | Vector output with selectable text; the main process controls paper (including custom millimeter sizes), orientation, and margins; footer page numbers come from print styles |
| Word to PDF | **docx-preview 0.3.7** | Off-screen rendering of `.docx` (style extraction + images to base64), then handed to `printToPDF` |
| Print HTML | **marked + KaTeX (fonts inlined)** | Markdown reuses the preview pipeline; Mermaid stays vector and images go through `mdlocal://` |

### Desktop Capabilities

| Module | Technology | Purpose |
| --- | --- | --- |
| Main-process bridge | **preload.cjs (contextBridge)** | Exposes file/AI/conversion abilities safely as `window.mdAPI` with contextIsolation enabled |
| Custom protocol | `mdlocal://` privileged protocol | Lets the renderer safely load local images/PDFs/Office files |
| File associations | **fileassoc.cjs** (writes to `HKCU\Software\Classes`) | Registers/unregisters associations and "Open with" candidates without admin rights |
| AI requests | **ai.cjs** (native fetch + AbortController) | Unified wrapper for OpenAI-compatible / Anthropic / Google Gemini protocols |
| Single instance | **requestSingleInstanceLock** | Forwards files from repeated launches to the existing window and focuses it |
| Process management | **process.cjs** (netstat / tasklist / taskkill / PowerShell) | Queries and kills processes by port, name, or PID; PIDs are converted to numbers before command assembly, and system-critical processes plus the app itself are blocked |
| External terminal | **terminal.cjs** (detection + detached launch) | Opens a folder in a system terminal (Windows Terminal / Ghostty / PowerShell / Git Bash etc.) with a full TTY |
| Script runner | **script.cjs** (`child_process` + built-in Node) | Runs `.js` files / ` ```js` blocks with output streamed over IPC; prefers the system `node`, falling back to Electron's built-in Node |
| Theming | **Element Plus dark css-vars + custom dark.css** | CSS-variable-level switching driven by `<html class="dark">`, following the system and syncing across windows |
