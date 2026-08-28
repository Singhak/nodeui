name: Pull request
description: Submit changes to NodeUI
title: ""
labels: []
body:

- type: markdown
  attributes:
  value: |
  Please read CONTRIBUTING.md before opening a PR. Keep the change
  focused; one logical change per PR.
- type: textarea
  id: summary
  attributes:
  label: Summary
  description: What does this change do and why?
  validations:
  required: true
- type: textarea
  id: testing
  attributes:
  label: How was this tested?
  description: Mention the quality gates you ran (lint, format, typecheck, test, build).
  validations:
  required: true
- type: textarea
  id: checklist
  attributes:
  label: Checklist
  description: Confirm each item applies.
  value: | - [ ] `npm run lint`, `format:check`, `typecheck`, `test`, and `build` pass - [ ] No new runtime dependencies in `@nodeui/core` - [ ] Public contract (`ProviderResult` / `ApiEnvelope`) unchanged unless intended - [ ] README and CHANGELOG updated where applicable
  validations:
  required: true
