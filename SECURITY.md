# Security Policy

## Supported Versions

The most recently released minor version is supported with security fixes.
Older versions may receive fixes at maintainers' discretion.

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |
| < 0.1   | :x:                |

## Reporting a Vulnerability

If you believe you have found a security vulnerability in `@rekurt/ohlcv-*`,
**please do not file a public issue**. Instead, report it privately via
GitHub's [security advisory form](https://github.com/rekurt/ohlcv-front/security/advisories/new),
or email the maintainers at the address listed on the GitHub profile.

Please include:

- A description of the issue and its impact
- Steps to reproduce (proof-of-concept code is welcome)
- Affected version(s)
- Any mitigation you've identified

We aim to acknowledge reports within 72 hours and provide a remediation
plan within 7 days for confirmed issues.

## Scope

In scope:

- Code injection via untrusted candle data, indicator config, drawing
  snapshots, or `loadState` input
- Prototype pollution
- Denial-of-service via crafted data feeds (e.g., RAF storm, unbounded
  memory growth)
- XSS via theme tokens, legend text, or any DOM-touching surface

Out of scope:

- Vulnerabilities in dependencies (please report to upstream)
- Issues that require the attacker to already control the user's browser
  or the host application's source code
