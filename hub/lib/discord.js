// lib/discord.js: optional outbound mirror to a Discord channel webhook.
// Set DISCORD_WEBHOOK_URL to enable; otherwise every call is a silent no-op.
// Discord is an adapter here, never the source of truth.
'use strict';

const WEBHOOK = process.env.DISCORD_WEBHOOK_URL || '';

// Which event types are worth a Discord ping (keep the channel readable).
const NOTABLE = new Set([
  'task.created', 'task.claimed', 'task.review', 'task.blocked', 'task.done', 'task.failed',
  'agent.registered', 'message.posted', 'knowledge.written',
]);

function fmt(type, data) {
  // Capability links only when a public base URL is configured; localhost links are noise in a channel.
  const base = (process.env.BUREAU_PUBLIC_URL || '').replace(/\/$/, '');
  const view = base && data.view_token ? `\n🔗 View: ${base}/m/${data.view_token}` : '';
  switch (type) {
    case 'task.created':  return `📥 **New task** ${data.id}: ${data.title}`;
    case 'task.claimed':  return `🏃 **${data.assignee}** claimed ${data.id}: ${data.title}`;
    case 'task.review': {
      // Critic-gate reviews are the critic's desk, not the boss's phone: they
      // stay on the dashboard feed and never ping.
      if ((data.gate || 'boss') !== 'boss') return null;
      let msg = `👀 **Review needed** · ${data.id}: ${data.title} (by ${data.assignee || '?'})`;
      if (base && data.review_links)
        msg += `\n✅ Approve: ${base}/r/${data.review_links.approve.token}\n↩️ Send back: ${base}/r/${data.review_links.sendback.token}`;
      return msg + view;
    }
    case 'task.blocked': {
      let msg = `❓ **Waiting on the boss** · ${data.id}: ${data.title}${data.note ? ` · ${data.note}` : ''}`;
      if (base && data.answer_link) msg += `\n💬 Answer: ${base}/r/${data.answer_link.token}`;
      return msg + view;
    }
    case 'task.done':     return `✅ **Done** · ${data.id}: ${data.title} (by ${data.assignee || '?'})${view}`;
    case 'task.failed':   return `❌ **Failed** · ${data.id}: ${data.title} · ${data.note || ''}${view}`;
    case 'agent.registered': return `🤖 Agent online: **${data.name}** (${data.kind})`;
    case 'knowledge.written': return `🧠 ${data.author} wrote \`${data.file}\``;
    // The boss's messages ping, and so does anything addressed to the boss;
    // agent-to-agent chatter stays out of Discord.
    case 'message.posted': {
      if (data.from === 'human') return `💬 **${data.from} → ${data.to}**: ${data.body}`;
      if (data.to === 'boss' || data.to === 'human') return `📨 **${data.from} to the boss**: ${data.body}`;
      return null;
    }
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
      body: JSON.stringify({ content: content.slice(0, 1900), username: 'Bureau' }),
    });
  } catch (e) {
    console.error('[discord] mirror failed:', e.message);
  }
}

module.exports = { mirror };
