# AGENTS.md

## 1. Purpose

This file defines repository-wide instructions for coding agents working on **Local PII Masker**.

Local PII Masker is a PC-oriented Web application that detects personally identifiable information and confidential terms in Japanese text, replaces them with reversible mask tokens, and restores known tokens in text returned from an external service.

The application is privacy-sensitive. Correctness, predictable behavior, and prevention of unintended data transmission take priority over implementation speed.

## 2. Source of truth

Read the following documents before making implementation decisions:

1. `docs/requirements.md` — MVP functional and non-functional requirements
2. `docs/ui-design.md` — screen layout, interaction states, messages, and UI acceptance criteria
3. `docs/architecture.md` — logical architecture and state-management policy
4. `docs/model-evaluation.md` — NER model evaluation policy
5. `README.md` — project overview and current status

When documents conflict, use this priority order:

1. Explicit instruction from the repository owner in the current task
2. `docs/requirements.md`
3. `docs/ui-design.md`
4. `docs/architecture.md`
5. This file
6. Existing implementation

Do not silently resolve a material contradiction. Record the conflict in the change summary and make the smallest reversible choice.

## 3. MVP boundaries

The MVP is a single-page, browser-complete application for PC use.

### Included

- Japanese text input and editing
- Regex-based detection of structured PII
- Browser-local Japanese NER through Transformers.js and an ONNX model
- Manual selection and addition of mask targets
- Candidate review through enabled/disabled state, manual addition, and deletion; category is selected at detection or manual addition and fixed after registration
- Original-text and masked-result tabs
- Copying masked text
- Pasting an external AI response and restoring known tokens
- Token validation
- Explicit clearing of session data

### Excluded

Do not add the following unless the owner explicitly changes the requirements:

- User accounts or login
- Server-side storage
- LocalStorage, SessionStorage, IndexedDB, Cookie, or other persistence of user text or token mappings
- Processing history or document history
- Cloud synchronization or team sharing
- Direct API integration with a generative AI service
- Per-occurrence masking of identical strings
- Direct editing of the masked result
- Semantic reconstruction of a token deleted or rewritten by an external AI
- A claim that the result is legally anonymized
- Formal mobile or tablet support

## 4. Privacy and security rules

These rules are mandatory.

1. Never send the original text, detected strings, mask entries, token mappings, external response, or restored response to an application server or third-party service.
2. Never place user text or token mappings in URLs, query parameters, browser history, analytics events, telemetry, error reports, or console logs.
3. Never persist user data in browser storage. Keep it only in application memory for the current page session.
4. Public assets such as JavaScript bundles, CSS, tokenizer files, and model files may be fetched and cached. Keep this clearly separated from user data.
5. Do not inject user input as HTML. Render it as text and preserve React escaping.
6. Do not include snippets of user text in exceptions or user-facing error messages.
7. New dependencies must be justified. Avoid dependencies that add tracking, remote logging, or opaque network behavior.
8. Do not describe the application as completely safe, anonymous, or guaranteed to detect every item.
9. If a feature would require transmitting user content, stop and surface the conflict rather than implementing it.

## 5. Domain invariants

The following behavior must remain true across refactors.

### 5.1 Original text is the source of truth

- Keep `originalText` as the authoritative text.
- Generate `maskedText` from `originalText` and the current enabled mask entries.
- Do not apply new replacements to a previously generated masked result.
- Treat `maskedText` and `restoredResponse` as derived values, not authoritative stored values.

### 5.2 Identical strings are all-or-none

- A mask entry represents a string, not one occurrence.
- Enabling an entry masks every applicable occurrence of that exact string.
- Disabling or deleting it affects all applicable occurrences.
- Do not introduce per-occurrence enablement in the MVP.

### 5.3 Overlapping targets use longest match

Both `山田` and `山田太郎` may be registered.

For text such as:

```text
山田さんと山田太郎さん
```

with both entries enabled, the result must be equivalent to:

```text
[PERSON_1]さんと[PERSON_2]さん
```

At a given start position, choose the longest matching enabled string. Do not apply a shorter entry inside a range already consumed by a longer entry.

Do not implement masking as a naïve sequence of `replaceAll` calls when that can alter later matching behavior.

### 5.4 Exact-string matching

Unless the requirements are revised:

- Normalize input to Unicode NFC
- Distinguish upper- and lowercase
- Distinguish full-width and half-width characters
- Distinguish spaces and no spaces
- Use exact string equality for candidate aggregation

Centralize normalization and matching logic. Do not duplicate it in UI components.

### 5.5 Detection and confirmation are separate

- Regex and NER output are candidates.
- Automatically detected candidates become enabled immediately and affect the masked result until the user disables or deletes them.
- Re-detection must preserve an existing entry's enabled or disabled state and must not undo an explicit user decision.
- Manual addition is an explicit user action and becomes enabled after the manual-add confirmation dialog succeeds.
- Preserve all detection sources when the same string is found by more than one method.

### 5.6 Restoration is token replacement

- Restore only known mask tokens that remain intact in the pasted external response.
- Replace every occurrence of a known token.
- Detect and report known, not-present, and unknown tokens separately.
- Do not infer that a rewritten phrase corresponds to a deleted token.

## 6. Data model direction

Use explicit domain types. The current conceptual model is:

```ts
type MaskCategory =
  | "PERSON"
  | "ADDRESS"
  | "ORGANIZATION"
  | "PHONE"
  | "EMAIL"
  | "POSTAL_CODE"
  | "SECRET"
  | "OTHER";

type DetectionSource = "regex" | "ner" | "manual";

type MaskEntry = {
  id: string;
  originalText: string;
  token: string;
  category: MaskCategory;
  sources: DetectionSource[];
  confidence?: number;
  enabled: boolean;
  occurrenceCount: number;
  reviewStatus: "unreviewed" | "approved" | "excluded";
};

type MaskSession = {
  originalText: string;
  entries: MaskEntry[];
  externalResponse: string;
};
```

The exact implementation may evolve, but preserve the domain invariants above.
The current UI has only enabled and disabled states. Keep `reviewStatus` only for internal compatibility; new automatic and manual entries use `approved`, and the current flow must not create `unreviewed` entries.

Prefer pure functions for:

- normalization
- occurrence counting
- candidate aggregation
- overlap resolution
- masked-text generation
- token generation and collision checking
- token restoration
- token validation

Keep browser APIs and React state outside the pure domain layer where practical.

## 7. Token rules

The final user-facing token format is not yet fixed.

Until it is finalized:

- Keep token generation behind one module or interface.
- Generate a stable token per mask entry for the current session.
- Use different tokens for different original strings.
- Include category information where practical.
- Check that generated tokens do not already occur in the original text or other relevant session text.
- Avoid exposing a token format throughout UI and domain code.
- Tests must not rely on incidental random token suffixes; inject or seed a token generator when necessary.

## 8. UI rules

Follow `docs/ui-design.md`.

### Main structure

- Use one page, not a routed multipage workflow.
- Place the text workspace on the left and mask-entry management on the right at standard PC widths.
- Keep the external-response restoration section collapsible and initially closed.
- Show that data is processed in the browser and is not saved.

### Original and masked views

- The original tab is editable.
- The masked-result tab is read-only.
- Switching tabs must not change text, candidates, or settings.
- The primary application copy action belongs to the masked-result view.
- If there are no enabled mask targets, require confirmation before copying text identical to the original.

### Candidate management

Show, at minimum:

- original string
- category
- occurrence count
- detection source
- review/enabled state
- confidence when available

Selecting a candidate should make its locations inspectable in the original view.

### Manual addition

- The user selects text in the original editor.
- Show an action popover or equivalent entry point.
- Open a confirmation dialog that shows the selected string, category, and total occurrence count.
- State clearly that every identical occurrence will be affected.
- Reject empty or whitespace-only selections.
- If the same string already exists, focus or update the existing entry rather than creating a duplicate.

### Accessibility

- All primary workflows must be keyboard-operable.
- Do not use color as the only state indicator.
- Provide visible focus states and accessible names.
- Use correct semantics and ARIA for tabs, dialogs, progress indicators, collapsible regions, and live notifications.
- Return focus to the initiating control after closing a dialog.

## 9. AI and detection integration

### Regex detection

Initial structured PII candidates are:

- email address
- telephone number
- Japanese postal code

Treat matches as candidates rather than guaranteed PII. New matches are enabled immediately, but the UI must preserve their detection source and let the user disable them.

Keep each detector isolated and testable. A regex match alone must not be presented as guaranteed PII.

### NER

- Use Transformers.js as the browser inference runtime.
- Use an ONNX Japanese NER model selected through the evaluation process in `docs/model-evaluation.md`.
- The current model is a PoC candidate, not a permanent hard-coded architectural dependency.
- Access the model through an adapter so it can be replaced.
- Run model loading and inference in a Web Worker when implemented.
- The UI must continue to support manual addition and regex detection when NER initialization or inference fails.
- Never send the source text to Hugging Face or another remote inference API. Downloading public model assets is distinct from remote inference.

## 10. React and TypeScript implementation guidance

The expected stack is React, TypeScript, and Vite.

- Enable strict TypeScript checking.
- Avoid `any`; use `unknown` plus validation at boundaries.
- Prefer small, focused components and domain modules.
- Avoid storing the same state in multiple places.
- Derive counts, masked text, and restored text with pure selectors/functions where feasible.
- Do not use array indexes as stable React keys for mask entries.
- Preserve text fidelity, including newlines and whitespace.
- Avoid large synchronous work on the main thread.
- Use an error boundary for unexpected UI failures, but do not log sensitive state.
- Keep UI messages in one place when practical so wording remains consistent with the specification.

Do not add Redux or another global state library without a demonstrated need. Start with React state plus `useReducer` or a small store only when complexity warrants it.

## 11. Testing requirements

Every change to masking, restoration, candidate aggregation, or session clearing requires tests.

### Unit tests

At minimum cover:

1. One target with one occurrence
2. One target with multiple identical occurrences
3. Enable and disable behavior affecting all occurrences
4. `山田` and `山田太郎` longest-match behavior
5. Targets that overlap at different positions
6. Same-length overlap with deterministic behavior
7. Unicode NFC normalization
8. Full-width/half-width distinction
9. Case distinction
10. Token collision prevention
11. Multiple occurrences of one token during restoration
12. Known, unknown, and absent token classification
13. Candidate deduplication across regex, NER, and manual sources
14. Original-text edits recalculating occurrence counts
15. Zero-occurrence entries remaining in the list

### Component/integration tests

Cover the acceptance criteria in `docs/requirements.md` and `docs/ui-design.md`, especially:

- original/masked tab behavior
- automatic candidates being enabled immediately and the disable/re-enable flow
- manual-add flow
- copy confirmation when no mask is active
- session clear confirmation and reset
- NER failure with continued manual/regex operation
- external-response restoration
- keyboard operation of primary actions

### Network/privacy verification

Include a manual or automated check that user-entered content does not appear in network requests, storage APIs, console output, analytics, or error-reporting payloads.

## 12. Commands and verification

The application scaffold is not yet committed. After the package scripts are created, use the commands defined in `package.json` rather than inventing alternatives.

Before declaring a code task complete, run all available relevant checks, typically:

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

If a script does not exist, do not claim it passed. Add a conventional script only when it is part of the requested setup or required for repeatable verification.

Report:

- commands run
- commands not run and why
- failures or warnings
- material manual checks

## 13. Dependency policy

Before adding a dependency:

1. Confirm that platform APIs or existing dependencies are insufficient.
2. Check browser compatibility for current Chrome and Edge.
3. Review license and maintenance status.
4. Review whether it performs external requests, telemetry, logging, or persistence.
5. Prefer pinned major versions and commit the lockfile.

Do not load runtime JavaScript from arbitrary CDNs in the production application. Prefer bundled or self-hosted assets. Model delivery may be evaluated separately according to `docs/model-evaluation.md`.

## 14. Change discipline

- Keep changes scoped to the requested task.
- Do not refactor unrelated areas while implementing a feature.
- Do not modify requirements merely to match an implementation shortcut.
- Update the relevant documentation when behavior, UI, architecture, privacy boundaries, or acceptance criteria change.
- Add comments for non-obvious domain decisions, not for self-evident syntax.
- Avoid committing generated build output, model binaries, local environment files, or sensitive sample data.
- Use synthetic names, addresses, phone numbers, and organizations in tests and fixtures.
- Never commit real PII.

## 15. Definition of done

A change is complete only when:

1. It satisfies the applicable requirements and UI acceptance criteria.
2. Domain invariants remain intact.
3. Privacy rules are not weakened.
4. Relevant tests are added or updated and pass.
5. Type checking, linting, and build checks pass when available.
6. Error, empty, loading, and disabled states are handled where applicable.
7. Keyboard and accessible-name behavior is considered for UI changes.
8. Documentation is updated when the externally observable behavior changes.
9. The final summary identifies changed files, verification performed, and remaining limitations.
