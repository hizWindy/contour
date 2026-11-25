# Testing live voice (PLAN-V28) before live

A hands-on script for [PLAN-V28](PLAN-V28.md)'s T5-2: 20 practice requests, spoken to the Assistant through Gemini 3.8 Live, on Al-khair's laptop in the copy `../contour-v28`, then 5 of them again on the laptop's speakers and 5 on a phone. It takes about an hour. It is paid, on Al-khair's word: about US$1.50 of Gemini and about US$0.60 of Claude for the 30 (TBC). The meter stops at US$4.

**TBC** means to be confirmed.

- **Last updated:** 25 Nov 2026 (T5-1; at M1, the merge review's echo check on the speakers).
- **What it covers:** T5-2, and the numbers T5-3 tunes from. It isn't the trial on live (M3).
- **Where results go:** PLAN-V28's Log, under T5-2. Write numbers and what happened only. No recordings, and no real company or people names, because the plan goes to GitHub.

## Before you start

Claude sets these up on Al-khair's word, and says when they're ready:

- **The made-up world** is in the copy's database, `leadfinder_v28` (T5-1). Their ids start with `990028`, so they're easy to remove.

  | Company | City | People | Why |
  |---|---|---|---|
  | Sample Logistics | Melbourne | Jo Sample, Jo Northwind, Sam Sample | Two Jos. Never worked, so research asks first. |
  | Northwind Traders | Sydney | Kim Northwind, Alex Example | Two Northwinds |
  | Northwind Freight | Brisbane | Lee Example | Two Northwinds |
  | Example Advisory | Perth | Chris Example, Chris Sample | Two Chrises |
  | Sample Engineering | Adelaide | Pat Sample | Two Samples |

  None of these names is in the copy's HubSpot companies (a count only, 25 Nov).
- **The copy's `engine/.env`** gains `LIVE_VOICE_OK=true`, `API_PORT=8151`, and `CORS_ORIGINS=["http://localhost:5321","http://127.0.0.1:5321"]`, so the socket's Origin check lets the website in. `LIVE_VOICE_NAMES_OK` stays off until Levi's OK (L2). The test key is there already.
- **The backend** runs on port 8151 with the Windows Claude key, because T5-2 uses Claude. **The website** runs on port 5321.
- **Sign-in is off on the laptop,** so the server's switch alone turns live voice on. If it's on, the Platform admin turns on his own "Live voice (paid by the minute)" in Edit person.
- **Write down Admin settings' line** before you start, like "Live voice this month: 0 minutes, about US$0.00 of US$4.00.". Then check AI Studio's usage page too.
- **Use Edge with a headset** for requests 1 to 20: Edge is where today's free mic is weakest. Then Chrome on the laptop's speakers, then a phone ("Then").

**It's safe by design:**

- **Nothing can reach HubSpot.** The copy has no HubSpot key, so "send it" fails with the card's own line. The Assistant must say it wasn't sent, never "Sent".
- **The research stops at its question.** Say "cancel", so nothing is spent.
- **Made-up names only.** Don't say a real client's name: it would go to Google.
- **The meter stops a talk** when the month's US$4 is reached. The key has about US$5.

## What to note for each request

- **Names, fields and dates:** right or wrong on the card (the company, the person, the date and the words).
- **First sound:** from the end of your words to the Assistant's first sound. The target is 1.5 seconds (TBC).
- **The card:** from the end of your words to the card on screen. The target is 4 seconds (TBC).
- **Gemini's words against yours:** the bar's "Working it out" line shows what Gemini asked Contour, and the captions show what Google heard you say. Note where a name differs.
- **Misses:** the Assistant didn't ask Contour, asked about the wrong thing, or said "Sent" when nothing was sent.

**Stop and report back** if names or dates are wrong in more than 2 of the 20 (TBC; the paper's step 4).

Press V once at the start: the whole set is one talk. A talk lasts 30 minutes at most, so press V again if it ends.

## The 20 requests

**A. Calls (5): four with a name clash, and one quick log**

1. [ ] Say **"Log a call with Jo at Sample Logistics. They want a site tour next week."** Expect the Assistant to ask "Jo Sample or Jo Northwind?". Say **"Jo Sample."** Expect the call card, with Sample Logistics, Jo Sample and the note, and "Ready. Say send it." Say **"Later."**: it's kept in Call logs.
2. [ ] Say **"Log a call with Northwind. I spoke to Kim about their lease."** Expect "Northwind Traders or Northwind Freight?". Say **"Traders."** Expect the card with Kim Northwind. Say **"Cancel."**
3. [ ] Say **"Log a call with Chris at Example Advisory. Left a voicemail."** Expect "Chris Example or Chris Sample?". Say **"The second one."** Expect Chris Sample, with Left voicemail. Say **"Cancel."**
4. [ ] Say **"Log a call with Sample. Pat wants a budget range for the fitout."** Expect "Sample Logistics or Sample Engineering?". Say **"Sample Engineering."** Expect Pat Sample. Say **"Later."**
5. [ ] Say **"No answer, Sam Sample."** With the free mic, this is a quick log that sends itself. In live voice, expect its card to open, with "Ready. Say send it.": nothing sends by itself (choice 7). Say **"Cancel."**

**B. Tasks with dates (5).** Say **"Cancel"** after each card.

6. [ ] **"Remind me to call Jo Sample next Friday."** Expect a task due on the Friday of next week (a week starts on Monday).
7. [ ] **"Add a task to send Kim Northwind our case studies on the 3rd."** Expect the next 3rd of a month. A weekend moves to the next working day, and the card says why.
8. [ ] **"Follow up with Example Advisory in two weeks."** Expect the day two weeks on, never a weekend.
9. [ ] **"Task for tomorrow: book a site visit with Pat Sample."** Expect tomorrow, or Monday after a Friday.
10. [ ] **"Remind me on Monday to check Northwind Freight's lease date."** Expect the coming Monday.

**C. Emails (3).** Say **"Cancel"** after each card.

11. [ ] **"Email Jo Sample to thank them for today's call."** Expect an email card to Jo Sample.
12. [ ] **"Email Kim Northwind to suggest a site visit next Tuesday."** Expect the email to name the Tuesday of next week.
13. [ ] **"Draft an email to Chris Example with three times to meet next week."** Expect an email card to Chris Example.

**D. Changes to an open card (3)**

14. [ ] Say request 12 again. With its card open, say **"Make it shorter."** Expect the same card, shorter. Say **"Cancel."**
15. [ ] Say request 6 again. With its card open, say **"Make it Thursday instead."** Expect the due day to move to that Thursday. Say **"Cancel."**
16. [ ] Say request 4 again. With its card open, say **"Add that they need forty desks."** Expect the note to gain it. Keep it open for 17.

**E. "Send it" (2)**

17. [ ] With request 16's card open, say **"Send it."** Expect the card to try, wait out its 5-second hold, then fail with its own line, because the copy has no HubSpot. The call stays in Call logs. Expect the Assistant to say that line, never "Sent". If the send takes more than about 17 seconds, it says "Still sending. The card will say when it's done." first.
18. [ ] Say request 2 again and pick Traders. With its card open, say **"Okay, do it."** These aren't send words. Expect nothing to be sent, and the Assistant to say "Nothing was sent. To send it, say 'send it'." Then say **"Cancel."** If Gemini answers without asking Contour at all, note it as a miss (TBC at T5-2).

**F. A page (1)**

19. [ ] Say **"Open Northwind."** Expect "Northwind Traders or Northwind Freight?". Say **"Freight."** Expect Northwind Freight's page, and the Assistant to say its line.

**G. A research (1)**

20. [ ] Say **"Research Sample Logistics."** Expect the research card to ask once, with the cost: Sample Logistics has never been worked. Say **"Cancel."** Expect "Cancelled. Nothing was spent.", and no research to start.

## Then

- [ ] **Talk over the Assistant** in the middle of a sentence. Expect it to stop at once, about 0.2 seconds (TBC).
- [ ] **Say "That's all."** Expect the talk to end and the bar to close.
- [ ] **Chrome on the laptop's speakers, no headset:** say requests 1, 5, 12, 17 and 19 again. Does the Assistant hear itself, stop, or answer itself? If it does, the gate's numbers change in T5-3, or the line "Use a headset" becomes the fallback (the plan's Risks).
  - **An echoed "send it":** after request 12's card opens, say nothing for 10 seconds while the Assistant says "Ready. Say send it.". Expect the card to stay open, with no 5-second hold. If Google hears the Assistant's own words as yours, the hold starts (Undo still stops it): stop and report back.
- [ ] **A phone:** say requests 1, 6, 12, 19 and 20.
  - **Android, Chrome:** the phone needs a secure page for its mic. Connect it by USB, open `chrome://inspect` on the laptop, and forward port 5321 to `localhost:5321`. Then open `http://localhost:5321` on the phone.
  - **iPhone, Safari:** it needs an HTTPS address, so a tunnel, on Al-khair's word. Otherwise it waits for M3, on live.
- [ ] **Read Admin settings' line again,** and AI Studio's usage page. Write both in the Log, with the minutes, the US$ a request, the median first sound and card times, the misses, and the Claude cost.
- [ ] **Claude removes the made-up world** afterwards, on Al-khair's word, or keeps it for M3's practice.
