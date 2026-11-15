# Email to Levi: call prep (draft, not sent)

Last updated: 2026-11-15 (call notes' HubSpot needs added at the end). Written for [PLAN-V10](../../plan/PLAN-V10.md) step A2. **Send only on Al-khair's word.** His answers go in the plan's "Waiting on".

---

**Subject:** Call prep: 6 things I need from you

Hi Levi,

The Companies page and call prep are built and tested. To switch them on, I need six things from you:

1. **HubSpot access to contacts and calls.** Your HubSpot admin adds "read contacts" (`crm.objects.contacts.read`) to our key. Until then, the People and Call history sections say they are waiting.
2. **The customer list** you mentioned on 2 Nov, for the "any links to our customers?" question.
3. **Your OK on two privacy points:**
   - checking if a named person is still at the company (a web search with their name);
   - sending company names to Claude. Until you say yes, scripts use only what HubSpot has, with no web check.
4. **Full script or questions only?** Do you want the whole call script (opener, why now, questions, answers to pushback, goal), or only the questions? Does the team already use an opener I should copy?
5. **Names and access.** Are "Companies" and "Call prep" the right names? Who should get the Companies tick?
6. **Which Lead Finder leads show on the Companies page?** My suggestion: Pass and Director review leads that aren't rejected, and only for people with the Lead Finder tick.

**Cost when it is on:** about US$0.05 to US$0.15 a call script (not measured yet), reused free for 7 days. The morning "search ahead" is capped at US$5 a day. All of it stays inside the daily limit of US$150.

Thanks,
Al-khair

---

## Added 15 Nov: what call notes need from HubSpot (PLAN-V17 W1)

**One permission:** "read contacts" (`crm.objects.contacts.read`), the same as item 1 above. It lets a rep pick the person on a logged call, and links the call to them. Without it, calls are logged on the company only.

Nothing else is needed from HubSpot for call notes. On 15 Nov our key was checked against HubSpot itself, for free, with nothing changed (PLAN-V17 T1-2):
- **It can already write** calls, notes, tasks and company fields (like a lease end). So sending waits only for us to switch writing on, after one real test call on a company Levi names (**TBC**: which company).
- **It can already read** calls, notes, tasks and meetings.
- Deals can't be written. Call notes never change a deal: a call is only linked to one, when the company has exactly one open deal. Whether that link needs deal write access is **TBC**: the real test call (M2) shows it.

When this email goes, item 1 can say: "read contacts also lets call notes link each call to the person."
