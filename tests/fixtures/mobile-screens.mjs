// Static markup fixtures that mirror the real screens (same el-* / v5-* classes as the TSX),
// used by tests/mobile-390-geometry.test.mjs to check 390px layouts in light and dark.
import { readFileSync } from "node:fs";
import path from "node:path";

const LONG = "Compare the three best budget Android phones in Nigeria right now with prices, battery life and where to buy them, including https://www.jumia.com.ng/catalog/?q=tecno-spark-20-pro-plus-256gb-international-version";
const icon = '<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/></svg>';

/** All app CSS in app/layout.tsx import order, minus remote @imports. */
export function appCss(root) {
  const layout = readFileSync(path.join(root, "app/layout.tsx"), "utf8");
  const files = [...layout.matchAll(/^import "\.\/([^"]+\.css)";/gm)].map((match) => match[1]);
  return files.map((file) => readFileSync(path.join(root, "app", file), "utf8").replace(/^@import[^\n]*\n/gm, "")).join("\n");
}

function shell(title, body, { back = true } = {}) {
  return `<div class="el-shell"><div class="el-main">
  <header class="el-topbar">${back ? `<a class="el-icon-btn" href="#back" aria-label="Back">${icon}</a>` : "<span></span>"}<div class="el-topbar-title">${title}</div><span></span></header>
  <div class="el-content">${body}</div>
  <nav class="el-tabbar"><a href="#chat">${icon}<span>Chat</span></a><a href="#tasks" class="active">${icon}<span>Tasks</span></a><a href="#you">${icon}<span>You</span></a></nav>
</div></div>`;
}

const row = (title, sub, extra = "") => `<li><a class="el-list-row" href="#r"><span class="el-list-icon">${icon}</span><span class="el-list-text"><strong>${title}</strong><small>${sub}</small></span>${extra}<span class="el-list-trail">${icon}</span></a></li>`;

export const screens = {
  "tasks-home": shell("Tasks", `<main class="el-page">
    <header class="el-page-head"><h1>Tasks</h1><p>What Elias is working on, what it does on a schedule, and what's waiting on your OK.</p></header>
    <button type="button" class="el-btn el-btn-primary el-btn-lg v4-new-task">${icon} New task</button>
    <section class="el-error-card" role="alert">${icon}<div><strong>That didn't go through</strong><small>${LONG}</small></div><button type="button" class="el-btn">${icon} Retry</button></section>
    <section class="el-section"><div class="el-section-head"><h2>Working on</h2><button class="el-btn el-btn-sm">${icon} New job</button></div>
      <ul class="el-list"><li class="el-list-item"><div class="el-list-row static"><span class="el-list-icon el-job-running">${icon}</span><span class="el-list-text"><strong>${LONG}</strong><small>Running · step 2 of up to 8 · 3m</small><small class="el-clamp">${LONG}</small></span><span class="el-list-actions"><button class="el-btn el-btn-sm el-btn-danger">Cancel</button><button class="el-icon-btn" aria-label="Show">${icon}</button></span></div></li></ul></section>
    <section class="el-section"><h2>Scheduled</h2><p class="el-empty-line">${icon} Nothing scheduled. Ask in chat: “every Monday at 9, summarise my week”.</p>
      <ul class="el-list"><li class="el-list-item"><div class="el-list-row static"><span class="el-list-icon accent">${icon}</span><span class="el-list-text"><strong>Morning brief</strong><small>Next: Tomorrow, 7:00 AM · every day at 7:00</small><small>Calendar, important email, reminders and weather for Calabar</small></span><span class="el-list-actions"><button class="el-icon-btn" aria-label="Edit">${icon}</button><button class="el-icon-btn" aria-label="Pause">${icon}</button><button class="el-icon-btn danger" aria-label="Remove">${icon}</button></span></div><a class="el-list-foot" href="#c">Last run: ${LONG.slice(0, 90)}…</a></li></ul></section>
    <section class="el-section"><h2>Workbench</h2><ul class="el-list">${row("Task workbench", "Plan a task step by step, with files and checkpoints")}</ul></section>
  </main>`, { back: false }),

  "workbench-start": shell("Workbench", `<main class="el-page v5-wb">
    <header class="el-page-head v5-wb-head"><div><h1>Workbench</h1><p>Plan a task step by step. Approvals, files and checkpoints stay with it.</p></div></header>
    <section class="el-section"><form class="el-card v5-wb-start">
      <div class="el-hint">${icon}<span><strong>chike2510/elias-ai-with-a-very-long-repository-name</strong><br>Elias reads a text snapshot. Edits stay isolated until you approve an exact commit and pull request.</span></div>
      <label class="el-field"><span>What do you want done?</span><textarea rows="4" placeholder="Describe the outcome."></textarea></label>
      <button type="submit" class="el-btn el-btn-primary el-btn-lg">${icon} Make a plan</button>
    </form><div class="v5-wb-examples"><button class="el-chip">${icon} Audit a project</button><button class="el-chip">${icon} Research with sources</button><button class="el-chip">${icon} Write a document</button></div></section>
  </main>`),

  "workbench-task": shell("Workbench", `<main class="el-page v5-wb">
    <header class="el-page-head v5-wb-head"><div><h1>Workbench</h1><p>Plan a task step by step. Approvals, files and checkpoints stay with it.</p></div><button class="el-btn el-btn-sm">${icon} New</button></header>
    <section class="el-section"><div class="el-card v5-wb-focus">
      <div class="v5-wb-title"><h2>${LONG}</h2><span class="el-state v5-wb-state na">${icon}Approval needed</span></div>
      <p class="el-muted">Work is paused until you review the permission request below.</p>
      <div class="v5-wb-progress"><div><strong>2 of 5 steps</strong><span>40%</span></div><div class="v5-wb-meter"><i style="width:40%"></i></div></div>
      <details class="v5-wb-request" open><summary>Original request</summary><p>${LONG}</p></details>
      <div class="v5-wb-actions"><button class="el-btn el-btn-primary">${icon}Waiting on you</button><a class="el-btn" href="#w">${icon} Open workspace</a></div>
    </div></section>
    <section class="el-error-card v5-wb-alert" role="alert">${icon}<div><strong>This task needs attention</strong><small>${LONG}</small></div><button class="el-btn">${icon} Retry</button></section>
    <section class="el-approval v5-wb-approval"><div class="el-approval-head">${icon}<strong>Elias needs your OK</strong></div><div class="el-approval-body"><p class="v5-wb-q">${LONG}</p><small class="el-muted">Allowing lets Elias access public web sources for this task.</small></div><div class="el-approval-actions"><button class="el-btn el-btn-primary">${icon} Allow</button><button class="el-btn">Decline</button></div></section>
    <section class="el-section"><h2>Ready</h2><div class="el-card v5-wb-file"><div class="el-card-compact">${icon}<span><strong class="v5-wb-ellipsis">budget-android-phones-nigeria-october-2026-final-report.docx</strong><small>application/docx · 24 KB</small></span></div><p class="v5-wb-preview">${LONG}</p><div class="v5-wb-actions"><a class="el-btn el-btn-primary" href="#d">${icon} Download</a><button class="el-btn">${icon} Copy link</button></div></div></section>
    <section class="el-section"><h2>Plan</h2><ol class="el-list v5-wb-steps">
      <li class="el-list-row static"><span class="el-list-icon el-job-done">${icon}</span><span class="el-list-text"><strong>Search the web</strong><small class="el-clamp">${LONG}</small><small>Complete · 10:42 · <a href="#a">3 activity items</a></small></span></li>
      <li class="el-list-row static"><span class="el-list-icon"><b>3</b></span><span class="el-list-text"><strong>${LONG}</strong><small>Not started</small></span></li>
    </ol></section>
    <section class="el-section"><details class="v5-wb-fold" open><summary><span>Activity</span><small>12 items</small>${icon}</summary><ul class="el-list v5-wb-events"><li class="v5-wb-event"><div class="v5-wb-event-head"><strong>${LONG}</strong><time>10:42</time></div><p>${LONG}</p><details class="v5-wb-evidence" open><summary>Recorded evidence</summary><pre>${JSON.stringify({ url: LONG, ok: true }, null, 2)}</pre></details></li></ul></details></section>
    <section class="el-section"><details class="v5-wb-fold" open><summary><span>Files &amp; checkpoints</span><small>1 file · 0 checkpoints</small>${icon}</summary><ul class="el-list">${row("budget-android-phones-nigeria-october-2026-final-report.docx", "application/docx")}</ul><p class="el-empty-line v5-wb-gap">${icon} No checkpoints yet.</p></details></section>
    <div class="v5-wb-controls"><button class="el-btn el-btn-sm">${icon}Pause</button><button class="el-btn el-btn-sm el-btn-danger">${icon}Cancel</button><button class="el-btn el-btn-sm">${icon} Restore latest</button></div>
    <div class="el-notice ok v5-wb-alert">${icon}<span>Paused after the current step finished.</span></div>
    <section class="el-section"><h2>Recent</h2><ul class="el-list">${row(LONG, "Completed · 10/9/2026 · 2 files")}</ul></section>
  </main>`),

  "you": shell("You", `<main class="el-page">
    <section class="el-profile"><span class="el-avatar el-avatar-lg">C</span><div><h1>Chikeziri Emmanuel Onovo with a long display name</h1><p>@chike2510</p></div></section>
    <section class="el-section"><h2>Connections</h2><ul class="el-list">
      <li><a class="el-list-row" href="#g"><span class="el-list-icon">${icon}</span><span class="el-list-text"><strong>Google</strong><small>Gmail &amp; Calendar · a-very-long-address-for-testing@gmail.com</small></span><span class="el-btn el-btn-primary el-btn-sm">Connect</span></a></li>
      <li><a class="el-list-row" href="#b"><span class="el-list-icon">${icon}</span><span class="el-list-text"><strong>Browser</strong><small>Browser not configured</small></span><span class="el-state na">Not set up</span></a></li>
    </ul><div class="el-inline-error"><span>Couldn't check connections right now.</span><button type="button">Retry</button></div></section>
    <section class="el-section"><h2>Workspace</h2><ul class="el-list">${row("Library", "Research reports, study sets and files")}${row("Projects", "Group chats, files and instructions")}</ul></section>
    <section class="el-section"><h2>You &amp; Elias</h2><ul class="el-list">${row("Chats", "Every conversation with Elias")}<li><button type="button" class="el-list-row danger"><span class="el-list-icon">${icon}</span><span class="el-list-text"><strong>Sign out</strong></span></button></li></ul></section>
  </main>`, { back: false }),

  "chats": shell("Chats", `<main class="el-page v4-chats">
    <header class="el-page-head"><h1>Chats</h1></header>
    <div class="v4-chats-tools"><label class="v4-search">${icon}<input placeholder="Search chats" aria-label="Search chats"></label><a href="#n" class="el-btn el-btn-primary">${icon} New</a></div>
    <ul class="el-convo-list">${[1, 2, 3].map((n) => `<li><a href="#c${n}"><span class="el-convo-title">${LONG}</span><span class="el-convo-preview">${LONG}</span><span class="el-convo-meta">2h<em>1 waiting</em></span></a><button type="button" class="el-icon-btn el-convo-delete" aria-label="Delete chat">${icon}</button></li>`).join("")}</ul>
  </main>`),

  "memory": shell("Memory", `<main class="el-page">
    <header class="el-page-head"><h1>Memory</h1><p>What Elias remembers about you. Edit or forget anything.</p></header>
    <section class="el-error-card" role="alert">${icon}<div><strong>That didn't go through</strong><small>Request failed with status 500</small></div><button type="button" class="el-btn">${icon} Retry</button></section>
    <p class="el-empty-line">${icon} Nothing saved yet. Tell Elias about yourself in chat.</p>
    <section class="el-mem-group"><h2>About you <small>2</small></h2><ul class="el-list"><li class="el-list-item"><div class="el-list-row static"><span class="el-list-text"><span class="el-mem-entity">Bola</span><strong class="el-wrap">${LONG}</strong><small>Learned from chat · 10/9/2026</small></span><span class="el-list-actions"><button class="el-icon-btn" aria-label="Edit memory">${icon}</button><button class="el-icon-btn danger" aria-label="Forget">${icon}</button></span></div></li></ul></section>
  </main>`),

  "chat-cards": `<div class="el-shell el-shell-chat"><div class="el-main">
    <header class="el-topbar"><a class="el-icon-btn" href="#h" aria-label="Your chats">${icon}</a><div class="el-topbar-title">Elias</div><a class="el-icon-btn" href="#n" aria-label="New chat">${icon}</a></header>
    <div class="el-content"><main class="el-chat"><div class="el-thread"><div class="el-thread-inner">
      <div class="el-row user"><div class="el-bubble user">${LONG}</div></div>
      <div class="el-row assistant"><div class="el-bubble assistant"><p>${LONG}</p></div>
        <article class="v4r-report v5-report-card"><header class="v5-report-head"><span class="v5-report-icon">${icon}</span><span><small>Research report</small><strong>${LONG}</strong></span></header>
          <section><h3>Key findings</h3><ul class="v4r-findings"><li>${LONG}<sup class="v4r-cite"><a href="#s1">1</a><a href="#s2">2</a></sup></li></ul></section>
          <ol class="v4r-sources"><li><a href="#s"><span class="v4r-src-n">1</span><span class="el-favicon el-favicon-sm el-site-icon"></span><span class="v4r-src-text"><strong>${LONG}</strong><small>jumia.com.ng · Jumia, Oct 2026</small></span>${icon}</a></li></ol>
          <div class="v4r-actions"><a class="el-btn el-btn-sm" href="#r">${icon} All reports</a><button type="button" class="el-btn el-btn-sm el-btn-ghost">${icon} Copy</button></div>
        </article>
        <section class="el-error-card" role="alert">${icon}<div><strong>That didn't go through</strong><small>${LONG}</small></div><button type="button" class="el-btn">${icon} Retry</button></section>
        <section class="el-approval"><div class="el-approval-head">${icon}<strong>Send this email?</strong></div><div class="el-approval-body"><div class="el-approval-row"><span>To</span><div>a-very-long-address-for-testing@example-company-domain.com</div></div><div class="el-approval-preview">${LONG}</div></div><div class="el-approval-actions"><button class="el-btn el-btn-primary">Send</button><button class="el-btn">Edit</button><button class="el-btn el-btn-ghost">Cancel</button></div></section>
        <div class="el-card"><div class="el-connect"><span class="el-connect-mark google">G</span><span class="el-connect-copy"><strong>Connect Google</strong><small>${LONG}</small></span><a class="el-btn el-btn-primary" href="#c">Connect</a></div></div>
      </div>
    </div></div>
    <form class="el-composer"><div class="el-composer-box"><textarea rows="1" placeholder="Message Elias"></textarea><button type="submit" class="el-send" aria-label="Send">↑</button></div></form>
    </main></div>
    <nav class="el-tabbar"><a href="#chat" class="active">${icon}<span>Chat</span></a><a href="#tasks">${icon}<span>Tasks</span></a><a href="#you">${icon}<span>You</span></a></nav>
  </div></div>`,

  "connectors": shell("Connectors", `<main class="screen connectors-screen"><div class="mobile-screen-heading"><a href="#y" aria-label="Back to You">${icon}</a><h1>Connectors</h1><a class="icon-btn" href="#add" aria-label="Add connector">${icon}</a></div>
    <section class="el-section el-connections"><h2>Personal assistant</h2><ul class="el-list"><li><div class="el-list-row static"><span class="el-list-icon">${icon}</span><span class="el-list-text"><strong>Browser</strong><small>Browser not configured: the server needs CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_BROWSER_TOKEN (or BROWSERBASE_API_KEY + BROWSERBASE_PROJECT_ID).</small></span><span class="el-state na">Not configured</span></div></li></ul></section>
    <div class="connector-search searchbox">${icon}<input placeholder="Search connectors"></div>
    <div class="connector-tabs"><button type="button" class="active">Apps</button><button type="button">Custom API</button><button type="button">Custom MCP</button></div>
    <section class="connector-list"><a class="connector-card" href="#gh"><span class="connector-card-icon connector-icon-github">${icon}</span><span class="connector-card-copy"><strong>GitHub</strong><small>Repositories, files, branches, issues, and pull requests.</small><em>Connected</em></span>${icon}</a></section>
  </main>`),
};

