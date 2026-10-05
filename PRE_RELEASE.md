# Private testing

SubValue is not on npm yet. Test the bundled package; no frontend installation or API key is required.

## Get the package

Install Node.js **24.13 or newer** on Windows, macOS or Linux. Check `node --version`.

With access to the private repository, open the latest successful [Validate run](https://github.com/axelmtn/subvalue/actions/workflows/ci.yml). Download its `subvalue-cli-…` artifact and unzip it. Only `subvalue-cli-0.1.0.tgz` should be inside. The artifact expires after 14 days; a new Validate run regenerates it.

Put the `.tgz` in a new folder outside any repository. Open a terminal in that folder.

```sh
npx --offline --yes --package ./subvalue-cli-0.1.0.tgz subvalue --dry-run
npx --offline --yes --package ./subvalue-cli-0.1.0.tgz subvalue
```

The first command checks detection without reading session contents. The second scans real local usage, opens the browser, and serves only `127.0.0.1`. A different loopback port is selected if 4731 is occupied. No demo data is injected.

## Check the app

1. Confirm the detected providers. A detected provider may have no usage in the selected period.
2. Enter your billing mode and subscription amount when needed. They are declarations, never inferred from credentials.
3. Check Overview, 7D/30D/Month, Receipt and Settings. Pricing coverage describes imported usage, not every request ever made.
4. Export PNG. Check readable amounts and the absence of project names, paths, prompts and session IDs.
5. Stop the CLI with Ctrl+C. Relaunch the same command. Unchanged files should reuse the persistent cache.

For scan timings and cache counts:

```sh
npx --offline --yes --package ./subvalue-cli-0.1.0.tgz subvalue --verbose
```

Default metadata storage:

- Windows: `%LOCALAPPDATA%/SubValue/`
- macOS: `~/Library/Application Support/SubValue/`
- Linux: `$XDG_DATA_HOME/subvalue/` or `~/.local/share/subvalue/`

Do not send source logs, databases, credentials or conversation content when reporting a problem. Report the OS, Node version, safe error text, scan timing and cache counts. Review screenshots before sharing them.

## Build from the private checkout

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run build
npm pack --workspace @subvalue/cli --ignore-scripts --pack-destination artifacts
```

Move the resulting `.tgz` to the separate test folder and use the commands above. No npm publication is needed. Automatic validations cover Windows, Linux, macOS Apple Silicon and macOS Intel; a tester should also verify their normal desktop browser opens correctly.
