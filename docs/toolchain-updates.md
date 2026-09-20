# Toolchain updates

Every piece of third-party code this repository runs is pinned ([ADR-0003](adr/0003-pin-third-party-code.md)), and a pin that nothing updates is one that quietly goes stale. This page lists every pin by what keeps it current. There are three kinds.

## Updated by Dependabot

Weekly, grouped, as pull requests that must pass `verify` like any other.

- **GitHub Actions** — every `uses:` is a commit SHA with its version as a comment; Dependabot moves both together.
- **Container base images** — each `FROM` carries a digest as well as a tag, and Dependabot updates the digest within the tag. It does not move the language version in the tag; that is the next section's job.
- **Each module's dependencies** — every npm lockfile, `go.mod`, and `uv.lock`, one group per module.
<!-- ultra:begin devcontainer -->
- **Dev Container features** — the toolchain features in `.devcontainer/devcontainer.json`.
<!-- ultra:end devcontainer -->

## Language versions — moved on purpose, all at once

Dependabot holds these back on purpose. A language version is read in several places, and moving it in one place and not the others is how "works on my machine" starts. Move each one in a single pull request, everywhere it appears, and let `verify` prove it.

- **Node** — `.node-version` (read by every `setup-node` step), `engines` in each `package.json`, the `node:` tag in each Node Dockerfile, the Dev Container feature, and the `@types/node` major, which describes the runtime and must never run ahead of it.
<!-- ultra:begin go-service -->
- **Go** — the `go` line in `services/api-go/go.mod` (read by `setup-go`), the `golang:` tag in its Dockerfile, and the Dev Container feature.
<!-- ultra:end go-service -->
<!-- ultra:begin py-service -->
- **Python** — `services/api-py/.python-version` (read by uv), `requires-python` and mypy's `python_version` in `pyproject.toml`, the `python:` tag in its Dockerfile, and the Dev Container feature.
- **uv** — `[tool.uv] required-version` in `services/api-py/pyproject.toml`, which uv itself enforces and every `setup-uv` step reads. It is a range within one minor release, because uv's minor releases can change behaviour before 1.0.
<!-- ultra:end py-service -->

## Pinned by hand — check at every minor release

Nothing updates these, so they are part of the release checklist. Each is a version and, for a downloaded binary, a checksum taken from the release itself.

- **gitleaks** — `GITLEAKS_VERSION` and `GITLEAKS_SHA256` in `.github/workflows/security.yml`.
- **actionlint** — `ACTIONLINT_VERSION` and `ACTIONLINT_SHA256` in `.github/actions/setup-actionlint/action.yml`.
- **Trivy** — `TRIVY_VERSION` and `TRIVY_SHA256` in the `image-scan` job of `.github/workflows/security.yml`, the SHA-256 taken from the release's `trivy_X.Y.Z_checksums.txt`.
- **zizmor** — `ZIZMOR_VERSION` and `ZIZMOR_SHA256` in `.github/actions/setup-zizmor/action.yml`. The release publishes no checksum file; take the SHA-256 GitHub records for the asset: `gh api repos/zizmorcore/zizmor/releases/tags/vX.Y.Z --jq '.assets[] | select(.name == "zizmor-x86_64-unknown-linux-gnu.tar.gz") | .digest'`.
<!-- ultra:begin go-service -->
- **golangci-lint** — the `version:` input of its action in `.github/workflows/verify.yml`.
- **govulncheck** — the `@v…` in the `go run` line of `.github/workflows/security.yml`.
<!-- ultra:end go-service -->
<!-- ultra:begin py-service -->
- **pip-audit** — the `pip-audit==…` in `.github/workflows/security.yml`.
<!-- ultra:end py-service -->
<!-- ultra:begin mcp-server -->
- **mcp-publisher** — the release URL and its SHA-256 in `.github/workflows/mcp-publish.yml`.
<!-- ultra:end mcp-server -->

To move one: read the tool's release notes, take the checksum from the release — a published checksum file, or the asset's digest (`gh api repos/OWNER/REPO/releases/tags/vX.Y.Z --jq '.assets[] | {name, digest}'`) — change the version and checksum in one pull request, and let CI prove the new binary works. Never take a checksum from anywhere but the release: the point of pinning one is that a replaced download fails.
