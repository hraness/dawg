---
id: read-history-before-editing
title: Read history and comments before editing, comment after
tools: [history_query, comment, inspect]
---

Goal: respect what the human liked or disliked, and leave a breadcrumb they can find.

1. The brief's "now and recent history" lines show the human's focus, playhead and newest comments. For more, ask history for comments on the part you are about to change:

```tool
{"tool":"history_query","args":{"track":"bass","kind":["comment"]}}
```

2. Or for everything that happened in a region, or to a parameter:

```tool
{"tool":"history_query","args":{"bars":"9-16","limit":10}}
```

```tool
{"tool":"history_query","args":{"param":"cutoff","since":"1h"}}
```

3. A row looks interesting? Read it in full (ops, context) by seq or id; page older rows with `before`.

```tool
{"tool":"history_query","args":{"show":"812"}}
```

```tool
{"tool":"history_query","args":{"tag":"love","before":700}}
```

4. Edit, then comment: what changed and why, in one or two sentences. It links to your last edit and carries the human's focus and playhead automatically. Tags help later searches.

```tool
{"tool":"comment","args":{"text":"Kept the #love bass riff from rev 41 and only thinned bars 13-16","tags":["bass"]}}
```

A turn that edits without calling `comment` still gets one (your final reply, tagged #auto), but your own words are better.

From a shell:

```dawg
dawg history --track bass --kind comment
dawg history --bars 9-16 --json
dawg history comment "thinned the bass in bars 13-16 #bass"
```
