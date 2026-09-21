# 101 POS — isolated ESC/POS prototype

This directory is intentionally outside the live print path. It has no Firebase,
ACC, database, localStorage, or production-data imports. The default mode is
`dry-run`: it renders fake invoice/report data and writes PNG + ESC/POS bytes to
`prototype/thermal-escpos/out` without opening a printer handle.

## What was verified on this workstation

- Windows print queues were inspected read-only on 2026-09-21.
- No `H-D821` queue or present USB thermal-printer device was found. Only
  virtual/remote queues were present, so physical USB/WinSpool compatibility and
  the cutter cannot be called PASS here.
- The adapter uses the Windows `WinSpool.drv` RAW path (`OpenPrinter`,
  `StartDocPrinter`, `WritePrinter`, `EndDocPrinter`) when explicitly enabled.
- The profile does not assume 576 dots. `printableWidthDots` must be supplied by
  the printer's self-test/driver documentation. The initial profile is 576 only
  as a **calibration candidate**, not a verified H-D821 fact.

## Run locally (dry-run only)

From the repository root:

```powershell
node prototype/thermal-escpos/server.cjs
```

Then, in another PowerShell window:

```powershell
Invoke-RestMethod http://127.0.0.1:17821/health
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:17821/render-fixtures
```

The response reports the exact raster width/height and byte sizes. PNG and
ESC/POS payloads are saved under `prototype/thermal-escpos/out`.

The server binds to loopback only and stops after one request if
`THERMAL_ESC_POS_ONESHOT=1` is set. It does not install a Windows service.

## Hardware gate (not executed)

Only after the H-D821 is connected, its Windows queue name and self-test are
confirmed, and the design is approved, a later run may set:

```powershell
$env:THERMAL_ESC_POS_ENABLE='1'
$env:THERMAL_ESC_POS_PRINTER='EXACT WINDOWS QUEUE NAME'
node prototype/thermal-escpos/server.cjs
```

The adapter still refuses non-allowlisted printer names and sends one complete
document per job. The cut command is appended once after feed lines; it is never
inserted between report pages because reports are rendered as one continuous
raster document.

## POS integration contract (local test only)

The POS calls `GET /health` and `POST /print` only when the separate direct
thermal option is enabled. The browser option is disabled by default and stays
disabled unless `health.ready` is true. A request contains `jobId` plus either
an invoice or report document; the service escapes all values before rendering.
Repeated requests with the same `jobId` return `duplicate: true` and do not
send another WinSpool job. Explicit invoice reprints receive a new reprint key.

For a real local test, set `THERMAL_ESC_POS_TOKEN` and enter the same token in
the POS settings. Hardware mode also requires `THERMAL_ESC_POS_ENABLE=1`, the
exact Windows queue name, a confirmed H-D821 profile, and a present queue.
No Firebase configuration, browser token, or production data is read by this
service.

## Calibration checklist before any real print

1. Connect H-D821 directly by USB and print its self-test/configuration page.
2. Record the Windows queue name, driver/port, print width in dots, DPI, and
   cutter mode from that page/manual. Do not infer them from the roll width.
3. Run dry-run and inspect the generated PNG at the measured width.
4. Test one plain-paper page with `THERMAL_ESC_POS_ENABLE=1`; verify alignment,
   Arabic legibility, logo, feed, and exactly one cut.
5. Keep A4 unchanged; the UI toggle must be wired later only after this isolated
   prototype is accepted.
