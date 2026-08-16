// v2/templates.js — t-72 (goal: t-53). Canned starting shapes for
// quick-add's template picker (t-55 item i6). No side effects at module
// load — safe to be both its own <script type=module> tag (per t-62's
// fixed load order) and an ES import from quick-add.js (which is what
// actually consumes it); ES modules are cached per URL, so it only ever
// evaluates once either way, whichever loads it first.
export const TEMPLATES = [
  {
    id: 'content-pr',
    label: 'Content with PR',
    body: [
      'One-line description of what this mission delivers.',
      '',
      '## Acceptance',
      '- Change is committed on a branch (not main), opened as a PR.',
      '- <the specific, checkable thing this content must say or do>',
      '- No unrelated files touched.'
    ].join('\n')
  },
  {
    id: 'review-only',
    label: 'Review-only knowledge write',
    body: [
      'One-line description of the knowledge change being proposed.',
      '',
      '## Acceptance',
      '- Submitted as a proposal (POST /api/knowledge, or PATCH /api/tasks with items) — not self-approved.',
      '- Cites its source (a shift, a mission, a decision) so the reviewer can trace it.',
      '- Parked in review (gate: boss) with the change attached.'
    ].join('\n')
  },
  {
    id: 'goal-child',
    label: 'Goal decomposition child',
    body: [
      'goal: t-<id>',
      '',
      'One-line description of what this child mission delivers toward the goal.',
      '',
      '## Acceptance',
      '- <mechanically checkable criterion 1>',
      '- <mechanically checkable criterion 2>',
      "- Own only the file(s) named here; do not touch sibling missions' files."
    ].join('\n')
  }
];

export function findTemplate(id) {
  return TEMPLATES.find(function (t) { return t.id === id; }) || null;
}
