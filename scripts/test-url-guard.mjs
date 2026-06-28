/**
 * Security test for the SSRF / URL guard (V-02 demonstration, V-03 enforcement).
 *
 * Uses only IP-literal / localhost cases so no external network is required.
 *
 * Run: node scripts/test-url-guard.mjs   (exit 0 = all guards hold)
 */
import {
  assertSafeUrl,
  assertUrlSyntax,
  getAllowedGitHosts
} from "../evaluators/visual/utils/urlGuard.js";

let failures = 0;
function ok(name, cond) {
  console.log(`${cond ? "✅" : "❌"} ${name}`);
  if (!cond) failures++;
}

async function rejects(fn) {
  try {
    await fn();
    return false;
  } catch {
    return true;
  }
}
async function resolves(fn) {
  try {
    await fn();
    return true;
  } catch {
    return false;
  }
}

console.log("--- URL guard ---\n");

// V-03: scheme + SSRF (async, DNS — but IP-literals/localhost need no network)
ok("file:// rejected", await rejects(() => assertSafeUrl("file:///etc/passwd")));
ok("cloud metadata 169.254.169.254 rejected", await rejects(() => assertSafeUrl("http://169.254.169.254/latest/meta-data/")));
ok("loopback 127.0.0.1 rejected", await rejects(() => assertSafeUrl("http://127.0.0.1:6379/")));
ok("localhost rejected", await rejects(() => assertSafeUrl("http://localhost/admin")));
ok("private 10.0.0.5 rejected", await rejects(() => assertSafeUrl("http://10.0.0.5/")));
ok("private 192.168.1.1 rejected", await rejects(() => assertSafeUrl("http://192.168.1.1/")));

// V-02: command-injection-style repo URLs are rejected by syntax+allowlist (no shell anyway)
const hosts = getAllowedGitHosts();
ok("injection string rejected (allowlist)", await rejects(() =>
  assertUrlSyntax("https://x.git; rm -rf ~", { allowedHosts: hosts })));
ok("non-allowlisted host rejected", await rejects(() =>
  assertUrlSyntax("https://evil.example.com/repo.git", { allowedHosts: hosts })));
ok("ftp scheme rejected", await rejects(() =>
  assertUrlSyntax("ftp://github.com/x", { allowedHosts: hosts })));

// Allowed shapes pass the syntactic check
ok("github.com repo passes syntax+allowlist", await resolves(() =>
  Promise.resolve(assertUrlSyntax("https://github.com/org/repo.git", { allowedHosts: hosts }))));
ok("gitlab subdomain passes (endsWith match)", await resolves(() =>
  Promise.resolve(assertUrlSyntax("https://www.gitlab.com/org/repo.git", { allowedHosts: hosts }))));

console.log("");
console.log(failures === 0 ? "All URL-guard assertions PASS." : `${failures} assertion(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
