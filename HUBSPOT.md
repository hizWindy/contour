# HubSpot: A Simple Guide

> Built from my own research notes, then corrected and expanded with HubSpot's docs. Last updated: 2026-10-22. Anything marked **TBC** still needs confirming with the team.

## 1. What is HubSpot?

HubSpot is a **cloud CRM**. It runs in the browser, so there is nothing to install.

**CRM** means *Customer Relationship Management*. It is a shared address book for the business. It also remembers every conversation and every sale.

HubSpot also has tools on top of the CRM to **market** to people, **sell** to them, **support** them and **automate** the boring work.

**Simple picture:**

- The CRM is the filing cabinet.
- The hubs are the tools that use the cabinet.
- Workflows are the helpers that move papers around automatically.

**Why it matters for me:** HubSpot sits in almost every Contour project. Most of my work reads from it or writes to it.

## 2. The CRM: the filing cabinet

Everything in the CRM is a **record** stored under an **object**. An object is a type of thing.

| Object | What it holds | Example at Contour (my guess, **TBC**) |
|---|---|---|
| **Contacts** | People | A facilities manager at a client |
| **Companies** | Organisations | QUBE, TPG Telecom |
| **Deals** | Possible sales | A fitout project being quoted |
| **Tickets** | Support requests | A client issue after handover |
| **Products** | Things you sell | A service or package |
| **Orders** | Purchases (newer object) | Probably unused at Contour |

### Leads

A **lead** is usually just a contact at an early stage. It is not a separate list.

Each contact has a **Lifecycle Stage** property. It moves in this order:

> Subscriber → Lead → Marketing Qualified Lead → Sales Qualified Lead → Opportunity → Customer

(HubSpot also has a separate *Leads* object in some Sales Hub plans. Whether Contour uses it is **TBC**.)

## 3. The four ideas that explain the CRM

1. **Properties** are the fields on a record. Examples: email, phone, deal amount, lifecycle stage. You can add custom ones.
2. **Associations** are links between records. One contact is linked to one company, and that company is linked to a deal. This is how HubSpot knows "this person works at this client, for this project."
3. **Pipelines and stages** are the steps a deal or ticket moves through. Example: *Qualified → Proposal Sent → Closed Won / Closed Lost*. Contour's real stages are **TBC**.
4. **Activities** are the history on a record: emails, calls, meetings, notes and tasks. Every touchpoint is logged on the record.

## 4. The hubs and the plans

### Hubs: the tools on top

| Hub | What it does |
|---|---|
| **Marketing Hub** | Emails, forms, landing pages, ads, campaigns |
| **Sales Hub** | Deal tracking, email sequences, meeting links, quotes |
| **Service Hub** | Tickets, help desk, customer surveys |
| **Content Hub** | Website pages and blog (also called CMS Hub) |
| **Data Hub** | Data cleanup, syncing apps, custom code. **This used to be called Operations Hub.** |
| **Commerce Hub** | Payments, invoices, subscriptions |

**Correction to my old notes:** There is no "Automation Hub." Automation is a feature called **Workflows**, and you'll find it under the **Automation** menu.

### Plans (tiers)

Each hub comes as Free, Starter, Professional or Enterprise. Higher tiers unlock more.

### Which feature needs which plan

| Feature | Plan needed |
|---|---|
| Workflows (basic) | Professional or Enterprise in a hub |
| **Send a webhook** action | **Data Hub Professional or Enterprise** |
| **Custom code** action | **Data Hub Professional or Enterprise** |
| **"When a webhook is received"** trigger | Data Hub Professional or Enterprise on one HubSpot page. Another page says Marketing, Sales or Service Hub Professional also works. **Plan for the stricter one.** |
| AI actions and agents | HubSpot Credits, plus a paid hub |
| SMS | A Marketing SMS add-on |
| Custom objects | Enterprise |

**What Contour has: TBC.** The admin must tell us.

## 5. Workflows: the automation

A workflow is **"when this happens, do that."** It starts on its own once switched on.

### Triggers (what starts it)

| Trigger | Plain meaning | Example |
|---|---|---|
| **Event-based** | Something happens | A form is submitted |
| **Filter-based** | A record matches rules | Deal is "Qualified" and in Perth |
| **Schedule-based** | A date or timer | A date property arrives |
| **Webhook** | An outside app calls HubSpot | Our backend sends a result |
| **Manual** | A person or another workflow enrolls it | Click "enroll" |

- **Re-run rule:** A record enters a workflow **once** by default. Turn on re-enrollment to run it again.
- **Limit:** 250 filters per trigger.
- **Object types:** Contacts, companies, deals, tickets and more. Custom objects need Enterprise.

### Actions (the steps)

| Group | What it does |
|---|---|
| **Wait** | Delay by time, date, weekday or event |
| **Decide** | If/then branches, AND/OR, random split |
| **Records** | Edit properties, create records, link records, create tasks and notes, assign owners |
| **Send** | Emails, internal email, in-app notification, SMS (add-on), WhatsApp, Slack, Google Chat |
| **Data tools** | Custom code, format data, send a webhook |
| **AI (credits)** | Data Agent: Research (beta), Summarize record (beta), Run Agent, Use a custom LLM (beta) |
| **Other apps** | Zoom, DocuSign, Asana, Trello, NetSuite and others |

### Where the output can land

| Output | Available? |
|---|---|
| Note or task on the record | Yes |
| Property filled in on the record | Yes |
| Internal email to staff | Yes |
| In-app notification | Yes |
| Slack, Google Chat | Yes |
| SMS | Only with the Marketing SMS add-on |
| **Microsoft Teams** | **Not in the action list.** Send through a webhook from our backend (**TBC**). |

### Limits

- Custom code runs **20 seconds** at most, with 128 MB of memory.
- There is no real loop over many records. You enroll records and each one runs through.
- Action logs are kept 90 days. Enrollment history is kept 6 months.
- Some actions are locked until you upgrade.

### Verdict: a conductor, not an engine

Workflows are good at **starting, waiting, branching, saving and notifying**. They are poor at **heavy work** like deep research or scoring many records. That heavy work goes in our backend.

Our team can still stay inside HubSpot. The result appears as a note, task or notification in HubSpot. Nobody sees the backend.

## 6. Connecting HubSpot to outside systems

### Sending data out: "Send a webhook"

- A **webhook** is a message HubSpot sends to a web address when a step runs.
- The **"Send a webhook"** action needs Data Hub Professional or Enterprise.
- HubSpot publishes **no timeout** for it. The docs only say a slow webhook can make the step take longer.
- **Retries:** HubSpot retries a failed webhook for up to **3 days**. The first retry is after 1 minute, and the gap grows to a maximum of 8 hours. It does not retry on 4XX errors, except 429.
- The response can be used in later steps if it comes back as a JSON object.
- **Safe pattern for long jobs:** the backend replies "received" straight away and works in the background. When done, it saves the result through the HubSpot API.

### Receiving data in: "When a webhook is received"

- An outside app sends JSON to a URL that HubSpot gives you. The workflow then starts.
- It works only on **existing records**. It can't create new ones.
- It needs a **unique custom property** to match on, like a project ID. The match must be exact.
- **Dates are not supported.** Send them as text.
- Limit: 100 webhook events per workflow.

### Creating new records: use the API

To create records, call the HubSpot API from the backend. No workflow is needed.

### Custom code action

- Languages: JavaScript (Node.js) and Python (beta).
- Time limit: **20 seconds**. Memory: 128 MB.
- API keys go in **secrets**, not in the code.
- Our backend does the heavy work, so we don't need this action. We only use it if a tiny step is easier inside HubSpot.

### Databases

HubSpot can't connect straight to a database like Postgres. The connection goes through a small API (our backend).

**Example:** A deal reaches "Closed Won" → workflow sends a webhook → backend saves the project to the database → later the backend updates the deal through the HubSpot API.

### Other AI providers

You can call OpenAI, Claude, Gemini or any provider from a webhook or from custom code. You can't change which model Breeze uses.

## 7. HubSpot's own AI (Breeze)

**Breeze** is HubSpot's built-in AI. In our account (seen in a screenshot on 2026-10-22), **Breeze Assistant is already there**, and the menu shows **Agents**. Whether we have credits is **TBC**.

### What it can do for research

- **Custom agents** built in Breeze Studio can use a **"Browse the web"** action.
- **Company Research Agent (beta):** builds a brief from public web sources and CRM history.
- **Prospecting Agent:** reads signals like news and job postings.
- **Data Agent:** answers questions using CRM data, emails, documents and web sources.
- **Workflow AI actions:** "Data Agent: Research (beta)" and "Use a custom LLM (beta)". How deep they go, and whether the custom LLM can be Claude, is **TBC**.

I couldn't confirm how deep any of these go. Depth is a guess until we test.

### Credits: what they cost

- **Credits** are units HubSpot charges for each AI action. Think phone minutes.
- Extra credits cost about **1 cent each** (about US$10 per 1,000).
- A Prospecting Agent recommendation costs about 100 credits, about US$1.
- Included each month: roughly 500 (Starter), 3,000 (Professional), 5,000 (Enterprise).
- Unused credits **don't roll over**.
- These figures come from third-party sources and may be out of date. **TBC.**
- Check balance: gear icon → Account & Billing → Usage & Limits or Credits (exact name **TBC**). Agents → Run history shows credits per run.

### Who powers Breeze

- **Breeze runs on other companies' AI models.** HubSpot is a CRM company, not an AI maker.
- The MIT AI Agent Index lists OpenAI models for Breeze agents and says users can't choose the model. HubSpot's own AI page names no provider.
- One third-party guide says Anthropic's Claude is also in the mix. I could not confirm that, so we don't say it in the deck.
- This is not a weakness. It makes Breeze easy to use. The catch is that we can't pick, tune or swap the model.

### "Limited control"

This means we can't choose the model, the sources or the steps inside Breeze. It does not mean "expensive." Cost and control are two separate things.

### Breeze vs Claude

| Job | Best tool |
|---|---|
| Quick company brief saved on a HubSpot record | Breeze, if Contour has credits |
| Deep research (sector, lease, strategy topics) | Claude |
| Moving data between HubSpot and Claude | HubSpot API or webhooks |

**Decision (2026-10-22):** Claude goes first for research, because we need deep web search and long, structured writing, and we want to control the sources and steps. Breeze gets a fair test:
- If the admin turns on Breeze's research agent, we run the same 5 companies through both tools and compare.
- We use public information only (**TBC**). The team scores each brief "useful or not."
- If the agent is off, Claude goes ahead.
- Whether Claude beats Breeze is a guess until we test.

### Connectors

HubSpot has a remote **MCP server** (a way for AI tools like Claude to read HubSpot). A secondary source says it reached general availability on 13 April 2026. **TBC** on HubSpot's own site.

## 8. Our setup

### Upon review: why n8n is out

| | First idea | Now |
|---|---|---|
| Tools | n8n + engine + Claude | HubSpot workflows + engine + Claude |
| Automation | n8n | HubSpot workflows (waits, tasks, emails, alerts, send data to the engine) |
| Extra bill | n8n Cloud, US$20 to 50 a month | None |
| Client data | Passes through n8n too | Stays between HubSpot, our server and Claude |
| n8n | The plan | Only if we need it later |

- **The engine** is our own small program. It links HubSpot to Claude and runs the long jobs that workflows can't.
- **The catch:** workflows need the right HubSpot plan. We confirm that first.
- **Version 1 of Trigger events (first) and Meeting prep does not depend on the plan.** The engine has its own timer and only needs the HubSpot key. Only the HubSpot reactions (tasks, alerts) would wait for the right plan (**TBC**).
- **Decision wanted:** go with HubSpot workflows and Claude. Skip n8n.

### The pieces

```
HubSpot workflows  →  Backend on DigitalOcean  →  Claude (research)
 (trigger, tasks)      (FastAPI, later Postgres)       │
        ▲                                              │
        └──────── HubSpot API (save notes/tasks) ◄─────┘
```

| Piece | Job |
|---|---|
| **HubSpot** | Stores the data, reacts to results, shows results to the team |
| **Backend** | Holds the research, scoring and memory logic. Its own timer starts the daily and weekly jobs. |
| **Claude** | Does the research and writing |
| **Database** (later) | Remembers past briefs, scores and feedback |
| **DigitalOcean** | Hosts the backend and database |

**Why the timer lives in the backend:** it needs no special HubSpot plan. If Contour has Data Hub Professional, timers can move into HubSpot later.

**Not needed:** HubSpot's custom code action. n8n only if running the engine becomes a chore.

**Set up early:**
1. A secure public address (HTTPS) so HubSpot can call the backend.
2. Secrets (HubSpot token, Claude key) in server environment variables, never in code.
3. Data location. DigitalOcean has a Sydney region (**TBC**). Claude API calls go to Anthropic. Contour must approve both.
4. Contour creates and pays for the accounts.

## 9. Where the meeting brief shows up

| Option | Verdict |
|---|---|
| **Internal note on the HubSpot meeting record** | Best fit for Levi's "meeting panel." Use the *internal notes* field (**TBC**: exact field name). |
| **Note on the company and deal** | Add too, so history stays on the account |
| **Email with a link** | Keep it. It reaches people who don't open HubSpot. |
| **Custom sidebar card** | Nicest, but needs a developer app and a higher plan (**TBC**). Later. |
| **Teams message** | Optional, later. Goes through our backend. |

**Warning:** don't put the brief in the meeting *description* field. It can go out in the calendar invite, so the client could read it.

Open: what Levi means by "meeting panel," and whether meetings are logged in HubSpot or only Outlook.

A sample brief (made-up company, five parts: who they are, in HubSpot, recent news, questions to ask, related project) is on slide 3 of the pitch deck.

## 10. Reading the URL

```
app.hubspot.com/contacts/1754862/objects/0-1/views/all/list
```

| Part | Meaning |
|---|---|
| `1754862` | The **account ID** (also called Hub ID or portal ID). Whether this is Contour's account is **TBC**. |
| `0-1` | The **object type ID**. `0-1` means Contacts. |
| `views/all/list` | The "All" saved view, shown as a list |

**Object type IDs:**

| Object | ID |
|---|---|
| Contacts | `0-1` |
| Companies | `0-2` |
| Deals | `0-3` |
| Tickets | `0-5` |
| Products | `0-7` |
| Orders | `0-123` (**TBC**, from memory) |

Custom objects that the team creates start with `2-`, for example `2-12345`.

**Example:** change `0-1` to `0-3` in the URL and you open the Deals list.

## 11. Lists

A list is a saved group of records.

- **Active list:** updates itself. Example: "all contacts in Perth." New Perth contacts join automatically.
- **Static list:** a fixed snapshot. Nobody joins or leaves unless you do it by hand.

## 12. HubSpot vs GoHighLevel (GHL)

My old note said "HubSpot is very much like GHL." That is true at the core. Both give you a CRM, email, forms and automation, and both workflows follow *trigger → actions → branches*.

| | HubSpot | GHL |
|---|---|---|
| Built for | In-house business teams | Marketing agencies |
| Pricing | Per user and per tier | Mostly flat |
| White-label (your own branding) | No | Yes |
| Data model | Strict and structured (objects, associations) | Looser |
| Integrations | Very large marketplace and strong API | Smaller |
| Workflow runs on | Any record type (contact, company, deal, ticket) | Mostly the contact |
| Re-run default | Once only, unless re-enrollment is on | Looser (**TBC**) |
| Feature locks | Webhooks, code and AI are gated by plan | Mostly included (**TBC**) |

My GHL details are from memory.

## 13. API access (what I'll do as AI Engineer)

HubSpot has an **API**, which is a door that lets code talk to it. With it, I can:

- **Read** contacts, companies and deals.
- **Write** back, for example a note, a task or a property.
- **Search** records by property.
- **React to changes** with webhooks.

**How access works:**

1. An admin creates a **Private App** in HubSpot (Settings → Integrations → Private Apps).
2. The admin picks what the app may read or write. These are called **scopes**.
3. HubSpot gives a secret **access token**. My code sends it with every request.

**Example request (get contacts):**

```
GET https://api.hubapi.com/crm/v3/objects/contacts
Authorization: Bearer <my-token>
```

**Rules for me:**

- Never paste a token into chat or commit it to a file.
- Ask for the smallest scopes needed. Saving notes needs **write** access, so read-only is not enough for the meeting brief.
- Client data is confidential. The AI data-handling rules are still **TBC**.

## 14. Quick glossary

| Word | Plain meaning |
|---|---|
| CRM | The shared database of people, companies and deals |
| Record | One entry, like one contact |
| Object | A type of record (contacts, deals) |
| Property | A field on a record |
| Association | A link between two records |
| Pipeline | The ordered steps for deals or tickets |
| Workflow | An automation: trigger, then actions |
| Enrollment | A record entering a workflow |
| Lifecycle stage | How far along a contact is, from stranger to customer |
| Webhook | A message one system sends to another when something happens |
| API | A way for code to talk to HubSpot |
| Private App | The setup that gives my code safe access |
| Token | The secret password my code uses |
| Scope | One permission, like "read contacts" |
| Breeze | HubSpot's built-in AI |
| Credits | Units HubSpot charges for AI actions |
| Data Hub | The hub formerly called Operations Hub |

## 15. Questions for the admin (TBC)

1. Which hubs and which tier does Contour have? Is it **Data Hub Professional or Enterprise**?
2. Do we have **HubSpot Credits**? How many per month?
3. Can you create a **Private App** token for me, with write access to notes?
4. What are Contour's real deal pipeline stages, and which custom properties exist?
5. Are meetings logged in HubSpot, or only in Outlook?
6. What client data may be sent to AI tools?
7. Can you enable the **Company Research Agent** for a 5-company test?

## Sources

- [HubSpot: choose your workflow actions](https://knowledge.hubspot.com/workflows/choose-your-workflow-actions)
- [HubSpot: set workflow enrollment triggers](https://knowledge.hubspot.com/workflows/set-your-workflow-enrollment-triggers)
- [HubSpot: create workflows](https://knowledge.hubspot.com/workflows/create-workflows)
- [HubSpot: use webhooks in workflows](https://knowledge.hubspot.com/workflows/how-do-i-use-webhooks-with-hubspot-workflows)
- [HubSpot: webhook workflow triggers](https://knowledge.hubspot.com/workflows/set-when-a-webhook-is-received-workflow-triggers)
- [HubSpot developers: custom code actions](https://developers.hubspot.com/docs/api/workflows/custom-code-actions)
- [HubSpot: assistants and agents in Breeze Studio](https://knowledge.hubspot.com/ai/use-assistants-and-agents-in-breeze-studio)
- [HubSpot: customize Breeze agents](https://knowledge.hubspot.com/ai-tools/customize-breeze-agents)
- [HubSpot: Breeze credits](https://www.hubspot.com/products/artificial-intelligence/credits)
- Third-party, less reliable: [INSIDEA playbook](https://insidea.com/guides/hubspot-company-research-agent-playbook), [INSIDEA AI pricing](https://insidea.com/blog/hubspot/hubspot-ai-pricing-2026), [Impulse Creative credits](https://impulsecreative.com/blog/understanding-hubspots-new-credit-system-a-breakdown-of-the-changes), [tl;dv MCP post](https://tldv.io/blog/hubspot-mcp/)
