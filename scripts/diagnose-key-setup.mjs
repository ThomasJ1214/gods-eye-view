/**
 * Diagnose "could not restrict the credential file to your account".
 *
 * Provider Settings refuses to write a key unless hardenCredentialFile() can
 * PROVE the file ends up owner-only. That is the right default — a key in a
 * world-readable file is worse than no key — but the refusal is a single
 * boolean, and on Windows it has eight distinct causes: an unexpected
 * SystemRoot shape, a tool that fails its canonical-path check, a whoami SID
 * the parser rejects, an icacls failure, or any of five DACL read-back
 * mismatches. The panel can only say "nothing was saved".
 *
 * This script walks the same sequence against a THROWAWAY temp file and names
 * the step that fails. It never reads or writes .env, pinokio/ENVIRONMENT, or
 * any credential, and it prints no secret material.
 *
 * Usage: node scripts/diagnose-key-setup.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ok = (m) => console.log('  [OK]   ' + m);
const bad = (m) => console.log('  [FAIL] ' + m);
const info = (m) => console.log('  .      ' + m);

console.log('\nGEV credential-hardening diagnostic\n');
console.log('platform:', process.platform, '| arch:', process.arch, '| node:', process.version);

if (process.platform !== 'win32') {
  console.log('\nNot Windows — this diagnostic targets the win32 branch.');
  process.exit(0);
}

// ---- Step 1: resolve native tools -----------------------------------------
console.log('\nStep 1 — resolve Windows native tools');
const aliases = ['SystemRoot', 'SYSTEMROOT', 'WINDIR', 'windir'];
for (const a of aliases) info(`env.${a} = ${JSON.stringify(process.env[a])}`);

const configured = aliases
  .map((n) => process.env[n])
  .filter((v) => typeof v === 'string' && v.length > 0);
if (!configured.length) { bad('no SystemRoot/WINDIR set at all'); process.exit(1); }

const roots = configured.map((v) => {
  if (v !== v.trim()) { bad(`value has surrounding whitespace: ${JSON.stringify(v)}`); return null; }
  if (!/^[A-Za-z]:\\Windows\\?$/i.test(v)) { bad(`value does not match [Drive]:\\Windows — ${JSON.stringify(v)}`); return null; }
  return v.endsWith('\\') ? v.slice(0, -1) : v;
});
if (roots.some((r) => !r)) { bad('STOPPED: a root failed the shape check above'); process.exit(1); }
if (roots.some((r) => r.toLowerCase() !== roots[0].toLowerCase())) {
  bad(`aliases disagree: ${JSON.stringify(roots)}`); process.exit(1);
}
const systemRoot = roots[0];
ok(`systemRoot = ${systemRoot}`);

const systemDirectory = process.arch === 'ia32' ? 'Sysnative' : 'System32';
info(`systemDirectory = ${systemDirectory}`);
const expected = {
  whoami: path.win32.join(systemRoot, systemDirectory, 'whoami.exe'),
  icacls: path.win32.join(systemRoot, systemDirectory, 'icacls.exe'),
  powershell: path.win32.join(systemRoot, systemDirectory, 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
};

try {
  const realpath = fs.realpathSync.native || fs.realpathSync;
  const rootEntry = fs.lstatSync(systemRoot);
  if (!rootEntry.isDirectory() || rootEntry.isSymbolicLink()) { bad('systemRoot is not a plain directory'); process.exit(1); }
  const canonicalRoot = realpath(systemRoot);
  if (canonicalRoot.toLowerCase() !== systemRoot.toLowerCase()) {
    bad(`systemRoot canonicalises elsewhere: ${canonicalRoot}`); process.exit(1);
  }
  ok('systemRoot canonical');
  for (const [name, exe] of Object.entries(expected)) {
    let entry;
    try { entry = fs.lstatSync(exe); }
    catch (e) { bad(`${name}: cannot stat ${exe} (${e.code})`); process.exit(1); }
    if (!entry.isFile() || entry.isSymbolicLink()) { bad(`${name}: not a regular file — ${exe}`); process.exit(1); }
    const canon = realpath(exe);
    const candidates = [exe];
    if (process.arch === 'ia32') candidates.push(exe.replace('\\Sysnative\\', '\\System32\\'));
    if (!candidates.some((c) => c.toLowerCase() === canon.toLowerCase())) {
      bad(`${name}: canonicalises elsewhere — ${exe} -> ${canon}`); process.exit(1);
    }
    ok(`${name} = ${exe}`);
  }
} catch (e) {
  bad(`tool resolution threw: ${e.message}`); process.exit(1);
}

// ---- Step 2: whoami -> SID -------------------------------------------------
console.log('\nStep 2 — read the current token SID');
const whoami = spawnSync(expected.whoami, ['/user', '/fo', 'csv', '/nh'], { encoding: 'utf8', windowsHide: true });
info(`status=${whoami.status} signal=${whoami.signal} error=${whoami.error?.message ?? 'none'}`);
info(`raw stdout: ${JSON.stringify(whoami.stdout)}`);
if (whoami.stderr) info(`raw stderr: ${JSON.stringify(whoami.stderr)}`);
if (whoami.error || whoami.signal || whoami.status !== 0) { bad('whoami did not complete cleanly'); process.exit(1); }

function parseCsvRecord(text) {
  const source = String(text || '').replace(/^﻿/, '').trim();
  if (!source || /[\r\n]/.test(source)) return null;
  const fields = []; let field = ''; let quoted = false;
  for (let i = 0; i < source.length; i += 1) {
    const c = source[i];
    if (quoted) {
      if (c === '"' && source[i + 1] === '"') { field += '"'; i += 1; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"' && field === '') quoted = true;
    else if (c === ',') { fields.push(field); field = ''; }
    else field += c;
  }
  if (quoted) return null;
  fields.push(field);
  return fields;
}
const fields = parseCsvRecord(whoami.stdout);
info(`parsed fields: ${JSON.stringify(fields)}`);
if (!fields) { bad('CSV did not parse as ONE record (embedded newline?)'); process.exit(1); }
if (fields.length !== 2) { bad(`expected exactly 2 CSV fields, got ${fields.length}`); process.exit(1); }
const sid = fields[1].trim();
const sidOk = /^(?:S-1-5-21-(?:\d+-){3}\d+|S-1-12-1-(?:\d+-){3}\d+)$/i.test(sid);
info(`SID = ${sid}`);
if (!sidOk) { bad('SID does not match the accepted local/domain or Entra shape'); process.exit(1); }
ok('SID accepted');

// ---- Step 3: icacls on a throwaway file -----------------------------------
console.log('\nStep 3 — apply the owner-only DACL (throwaway temp file)');
const tmp = path.join(os.tmpdir(), `gev-acl-probe-${Date.now()}.tmp`);
fs.writeFileSync(tmp, 'probe\n');
info(`temp file: ${tmp}`);
const applied = spawnSync(expected.icacls, [
  tmp, '/inheritance:r', '/grant:r', `*${sid}:F`, '*S-1-5-18:F', '*S-1-5-32-544:F',
], { encoding: 'utf8', windowsHide: true });
info(`status=${applied.status} signal=${applied.signal} error=${applied.error?.message ?? 'none'}`);
if (applied.stdout) info(`stdout: ${applied.stdout.trim()}`);
if (applied.stderr) info(`stderr: ${applied.stderr.trim()}`);
if (applied.error || applied.signal || applied.status !== 0) {
  bad('icacls failed'); fs.rmSync(tmp, { force: true }); process.exit(1);
}
ok('icacls applied');

// ---- Step 4: PowerShell verify --------------------------------------------
console.log('\nStep 4 — verify the resulting DACL via PowerShell');
const VERIFY = [
  "$ErrorActionPreference = 'Stop'",
  '$acl = Get-Acl -LiteralPath $env:GEV_ACL_FILE',
  'if (-not $acl.AreAccessRulesProtected) { exit 2 }',
  "$allowed = @($env:GEV_ACL_USER_SID, 'S-1-5-18', 'S-1-5-32-544')",
  '$seen = @{}',
  '$rules = @($acl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]))',
  'if ($rules.Count -ne 3) { exit 7 }',
  'foreach ($rule in $rules) {',
  '  $ruleSid = $rule.IdentityReference.Value',
  '  if ($rule.IsInherited) { exit 3 }',
  '  if ($rule.AccessControlType -ne [System.Security.AccessControl.AccessControlType]::Allow) { exit 4 }',
  '  if ($allowed -notcontains $ruleSid) { exit 5 }',
  '  if ($seen.ContainsKey($ruleSid)) { exit 8 }',
  '  $full = [System.Security.AccessControl.FileSystemRights]::FullControl',
  '  if ($rule.FileSystemRights -ne $full) { exit 6 }',
  '  $seen[$ruleSid] = $true',
  '}',
  'if ($seen.Count -ne 3) { exit 9 }',
].join('; ');

const verified = spawnSync(expected.powershell, ['-NoProfile', '-NonInteractive', '-Command', VERIFY], {
  env: { ...process.env, GEV_ACL_FILE: tmp, GEV_ACL_USER_SID: sid },
  encoding: 'utf8',
  windowsHide: true,
});
const REASONS = {
  2: 'inheritance is still enabled (AreAccessRulesProtected false)',
  3: 'an inherited rule survived',
  4: 'a Deny rule is present',
  5: 'an unexpected principal holds a rule',
  6: 'a principal has rights other than exactly FullControl',
  7: `rule count is not exactly 3`,
  8: 'a principal appears twice',
  9: 'fewer than 3 expected principals present',
};
info(`status=${verified.status} signal=${verified.signal} error=${verified.error?.message ?? 'none'}`);
if (verified.stdout?.trim()) info(`stdout: ${verified.stdout.trim()}`);
if (verified.stderr?.trim()) info(`stderr: ${verified.stderr.trim()}`);
if (verified.status !== 0 && REASONS[verified.status]) info(`meaning: ${REASONS[verified.status]}`);

console.log('\nActual DACL for reference:');
const show = spawnSync(expected.icacls, [tmp], { encoding: 'utf8', windowsHide: true });
console.log((show.stdout || '').trim());

fs.rmSync(tmp, { force: true });

console.log('\nRESULT: ' + (
  !verified.error && !verified.signal && verified.status === 0
    ? 'hardening SUCCEEDS on a temp file — the failure is elsewhere (likely the target path).'
    : 'hardening FAILS at step 4 (see meaning above).'
) + '\n');
