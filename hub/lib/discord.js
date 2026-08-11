// lib/discord.js — optional outbound mirror to a Discord channel webhook.
// Set DISCORD_WEBHOOK_URL to enable; otherwise every call is a silent no-op.
// Discord is an adapter here, never the source of truth.
'use strict';

const WEBHOOK = process.env.DISCORD_WEBHOOK_URL || '';

// Which event types are worth a Discord ping (keep the channel readable).
const NOTABLE = new Set([
  'task.created', 'task.claimed', 'task.review', 'task.done', 'task.failed',
  'agent.registered', 'message.human', 'knowledge.written',
]);

function fmt(type, data) {
  switch (type) {
    case 'task.created':  return `📥 **New task** ${data.id}: ${data.title}`;
    case 'task.claimed':  return `🏃 **${data.assignee}** claimed ${data.id}: ${data.title}`;
    case 'task.review':   return `👀 **Review needed** — ${data.id}: ${data.title} (by ${data.assignee || '?'})`;
    case 'task.done':     return `✅ **Done** — ${data.id}: ${data.title} (by ${data.assignee || '?'})`;
    case 'task.failed':   return `❌ **Failed** — ${data.id}: ${data.title} — ${data.note || ''}`;
    case 'agent.registered': return `🤖 Agent online: **${data.name}** (${data.kind})`;
    case 'knowledge.written': return `🧠 ${data.author} wrote \`${data.file}\``;
    case 'message.human': return `💬 **${data.from} → ${data.to}**: ${data.body}`;
    default: return null;
  }
}

async function mirror(type, data) {
  if (!WEBHOOK || !NOTABLE.has(type)) return;
  const content = fmt(type, data);
  if (!content) return;
  try {
    await fetch(WEBHOOK, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: content.slice(0, 1900), username: 'Agent HQ' }),
    });
  } catch (e) {
    console.error('[discord] mirror failed:', e.message);
  }
}

module.exports = { mirror };
