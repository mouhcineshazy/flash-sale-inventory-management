Here's a prioritized list — these are the resources the JS/Node community consistently points to as the best free explanations of this exact material.
Start here — the official source
Node.js official docs: "The Node.js Event Loop, Timers, and process.nextTick()"

Search: nodejs.org event loop timers nextTick

This is the authoritative source, written by the Node core team. Covers the actual phases (timers, pending callbacks, idle/prepare, poll, check, close callbacks) precisely. Dense but accurate — read this first, then watch the videos below to build intuition around it.
The single most-referenced video on this topic
Philip Roberts — "What the heck is the event loop anyway?" (JSConf, ~26 min)

Search on YouTube: Philip Roberts event loop JSConf

Technically about browser JS, but it's the foundational mental model the entire JS/Node community uses to explain call stack, callback queue, and the event loop visually. Almost every other explanation, including Node-specific ones, builds on this talk. Genuinely worth the 26 minutes.
Node-specific deep dive
Akshay Saini — Node.js / JavaScript deep-dive series

Search on YouTube: Akshay Saini Node.js event loop libuv

Goes further into Node-specific internals — libuv, the thread pool, how Node differs from browser JS specifically. Strong for your situation because it explicitly contrasts single-threaded JS execution with what's actually happening underneath (libuv's thread pool handling I/O).
The Java-to-Node concurrency contrast specifically
Search: Node.js event loop vs Java thread per request

This exact phrase pulls several solid blog posts and Stack Overflow threads written specifically for backend engineers coming from threaded languages (Java, C#) into Node. Useful because it forces the comparison you'll need to articulate clearly in an interview.
Streams and buffers (the other Node-specific gap)
Node.js official docs: "Stream" guide

Search: nodejs.org stream guide

No Java equivalent really maps cleanly to Node streams, so this is worth a dedicated read on its own — readable/writable/duplex/transform streams, backpressure.

Suggested order: Philip Roberts video first (builds the visual mental model in 26 min) → official Node.js event loop docs (fills in the precise phase details) → Akshay Saini's Node-specific video (libuv, thread pool) → the Java-vs-Node concurrency search (forces you to articulate the contrast) → streams docs last, since it's a separate topic from the event loop itself.
That whole sequence is maybe 3-4 hours total, all free, and covers exactly the gap a CRUD-style project wouldn't naturally surface.