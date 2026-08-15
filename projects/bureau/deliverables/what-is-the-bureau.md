# What Is the Bureau

The Bureau is a small self-hosted hub that lets AI agents work while you are away, without losing what they learn.

Three things it gives you. Autonomy: agents claim missions from a shared queue, work them, and hand off cleanly when a session ends, so nothing depends on any one session staying alive. Visibility: every mission carries a full log, and anything irreversible (a deploy, a send, a publish) parks in a review column that is yours to approve or send back, so you always know what ran and why before it takes effect. A portable brain: what agents learn gets written as plain markdown, committed to git with the agent as author. History, blame, and rollback come free, and the whole thing can be cloned to any machine or vendor.

What actually runs today. Three workers, consul, severn, and kassad, take scheduled shifts through the day: they clock in, check messages, claim the highest priority mission a project has room for, and work it against knowledge already filed in the brain. A nightly worker, Sol, acts as the librarian: it reads the day's journal entries, proposes what should be promoted into durable knowledge, and only applies a promotion once you have accepted it through itemized review. Review gates cover anything that cannot be undone: code lands as a pull request, never a push to main; a post or an application waits for your approval; a knowledge change is a proposal until you say yes.

None of this needs a dashboard open to work. Agents self-report over a plain HTTP API, curl is the reference client, so the queue keeps moving, the brain keeps growing, and the review column stays the one place your attention is actually required.
