# How others built research agents

How 13 well-known research agents work, in plain words, and what our Lead Finder can borrow.

- **Last updated:** 2026-10-25.
- **Sources:** each builder's own posts and GitHub pages, plus write-ups about them. Links are at the end.
- Most numbers are the builders' own claims, not independent tests. **TBC** marks what is not confirmed.

## Words used here

- **Agent:** an AI that can use tools, like searching or opening a web page, again and again until a job is done.
- **Helper:** a second AI that the main one sends off to do one slice of the job. Also called a subagent.
- **Loop:** search, read, check what's still missing, search again.
- **Tokens:** the unit AI usage is billed in. More reading means more tokens, which means more cost.

## In short

Almost all of them follow the same four steps:

1. **Plan.** Turn the question into a list of smaller questions.
2. **Search.** Look each one up, often several at the same time.
3. **Check.** Ask "what's still missing?" and search again if needed.
4. **Write.** Put it together, with a source for each fact.

They differ in three ways:
- **Who makes the plan:** fixed code, or the AI itself.
- **How many helpers:** one AI doing everything, or a lead AI with a team.
- **Instructed or trained:** most use a normal AI model with good instructions. OpenAI and Alibaba trained a special model just for research.

## Big company products

### 1. Claude Research (Anthropic)
- **How it works:** a lead AI reads the question, writes a plan and saves it. It sends helpers to search at the same time, each in its own workspace, and each returns a short summary. The lead decides whether more research is needed. At the end, a separate citation step matches every claim to its source.
- **Effort rules:** a simple fact gets 1 agent and 3 to 10 searches. A comparison gets 2 to 4 helpers. Complex research gets 10 or more.
- **Numbers:** it beat a single AI by 90.2% on Anthropic's own test. It uses about 15 times the tokens of a normal chat. Early versions sent 50 helpers for simple questions.
- **Worth copying:** effort rules, a separate citation step, and starting tests small (about 20 questions).

### 2. ChatGPT Deep Research (OpenAI)
- **How it works:** one model, trained by trial and reward on hard browsing tasks. That training is called reinforcement learning. It asks clarifying questions first, then searches, reads, changes course when it finds something new, and writes a report with citations. A run can take up to about 30 minutes.
- **Worth copying:** asking clarifying questions before starting. Not the training, which needs a big research lab.

### 3. Gemini Deep Research (Google)
- **How it works:** it writes a research plan and shows it to you to edit before it runs. It decides which steps can run at the same time and which must wait. It runs in the background and tells you when it's done.
- **Worth copying:** a person approves the plan, and the work runs in the background. Our weekly run already works this way.

### 4. Perplexity Deep Research
- **How it works:** it splits the question into smaller tasks, then runs round after round of searches. Each round changes direction based on what it found. It does dozens of searches over hundreds of sources, in a few minutes. Perplexity hasn't published the details (**TBC**).
- **Worth copying:** let the next search depend on what the last one found.

## Open-source teams of helpers

### 5. Open Deep Research (LangChain)
- **How it works:** three phases. First it checks the question is clear, asks if it isn't, and writes a short research brief. Then a supervisor splits the brief into topics and sends researchers out at the same time, with a cap on how many run at once. Findings are shortened, and one final step writes the report.
- **Note:** the GitHub project is now archived (read-only). Borrow the ideas, not the code.
- **Worth copying:** a written research brief before any searching, and a cap on parallel workers.

### 6. GPT Researcher
- **How it works:** a planner writes a fixed list of research questions. One worker per question searches and gathers. The planner then filters everything and writes the report. The team credits the fixed list for its reliability.
- **Numbers:** their own figure is about 3 minutes and US$0.10 per task, with their models. Ours will differ (**TBC**).
- **Worth copying:** this is closest to our version 1, a fixed plan in code.

### 7. DeerFlow (ByteDance)
- **How it works:** in the first version, a coordinator takes the request and a planner writes the steps. A research team does the work: a researcher searches and a coder runs code. A reporter writes it up. Version 2 is a rewrite: a lead with helpers, long-term memory, and a safe box for running code.
- **Worth copying:** give each role one clear job. The researcher only gathers. It doesn't write the report.

### 8. STORM (Stanford)
- **How it works:** it writes Wikipedia-style articles. It first reads similar articles to find different points of view. Then AI "writers" interview an AI "expert" who answers from web sources. It builds an outline from the interviews and writes section by section, with citations.
- **Worth copying:** ask questions from several points of view. For us: the CFO's view (lease cost), the HR view (hiring) and the CEO's view (growth).

### 9. Open Deep Research (Hugging Face)
- **How it works:** an open copy of OpenAI's product, built in about a day on Hugging Face's smolagents library. Its agents write each action as a short piece of code instead of filling in a form. The team says this makes them better at finishing tasks.
- **Worth copying:** not much for us. It shows a small team can get close to the big products.

## Open-source simple loops

### 10. node-DeepResearch (Jina AI)
- **How it works:** one loop of search, read and think, repeated until it finds an answer or hits a token budget. When the budget runs out, it stops searching and writes the best answer it has.
- **Worth copying:** a hard budget per company, so one hard company can't use up the week's spend.

### 11. deep-research (dzhng)
- **How it works:** under 500 lines of code with two dials. Breadth is how many searches run each round. Depth is how many rounds. Each round pulls out what it learned and new leads to follow, then goes one level deeper.
- **Note:** not actively updated since mid-2025.
- **Worth copying:** the two dials, which are easy to set for each weekly run.

### 12. Open Deep Research (Together AI)
- **How it works:** plan, search, check for gaps, write. It uses a different model for each step. The team found that more than one search round clearly improved accuracy.
- **Worth copying:** the gap check. Run one more round only where something is missing.

## Trained research model

### 13. Tongyi DeepResearch (Alibaba)
- **How it works:** an open model trained just for research, on made-up practice questions that get harder over time. It has two modes. The light mode thinks, searches and repeats. The heavy mode runs several agents at the same time and combines their notes.
- **Worth copying:** little for now. It shows open models are catching up (**TBC**).

## What they share

| Step | What most of them do | Our Lead Finder ([LEADS.md](../LEADS.md)) |
|---|---|---|
| Plan | Split the job into smaller questions | Fixed plan in code: 4 signs × 3 cities, plus watchlist batches |
| Search | Several helpers at once, each with its own workspace | Search workers in parallel |
| Check | Ask "what's missing?" and search again | Not yet. Add one gap check (below). |
| Sources | Every fact gets a link. Some use a separate citation step. | Source checker |
| Write | One final step writes the report | Lead cards for Levi |

## What we should borrow

1. **Keep the fixed plan for version 1.** GPT Researcher and Anthropic both show that splitting the job up front works. A fixed plan also keeps the cost predictable.
2. **Add one gap check.** After the first search, check each company for the facts our rules need: office size or staff, city, trigger and source. If one is missing, run one more targeted search, then stop. (Together AI, Jina)
3. **Set effort rules and a budget.** For example, a watchlist company gets 1 worker and up to 10 searches, and a discovery slice gets more. Add a token cap per company. These numbers are **TBC** until the hand-test.
4. **Check sources as their own step.** Do it at the end, like Anthropic's citation step. Watch for low-quality "content farm" sites, which Anthropic found its agents liked.
5. **Test small first.** Anthropic started with about 20 test questions. Our hand-test (30 days, 3 cities) is the same idea.

**Not worth copying:** training our own model, as OpenAI and Alibaba did. It needs a research lab's budget.

## Sources

- Anthropic: [How we built our multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system)
- OpenAI: [The Batch on Deep Research](https://www.deeplearning.ai/the-batch/openais-deep-research-agent-generates-detailed-reports-by-analyzing-web-sources/), [Sequoia interview with Isa Fulford](https://inferencebysequoia.substack.com/p/how-openai-built-its-groundbreaking)
- Google: [Gemini Deep Research](https://gemini.google/overview/deep-research/)
- Perplexity: [Deep Research Agents survey (arXiv)](https://arxiv.org/pdf/2506.18096)
- LangChain: [Open Deep Research blog](https://www.langchain.com/blog/open-deep-research), [GitHub](https://github.com/langchain-ai/open_deep_research)
- GPT Researcher: [docs](https://docs.gptr.dev/docs/gpt-researcher/getting-started/introduction)
- DeerFlow: [MarkTechPost](https://www.marktechpost.com/2025/05/09/bytedance-open-sources-deerflow-a-modular-multi-agent-framework-for-deep-research-automation/), [GitHub](https://github.com/bytedance/deer-flow)
- STORM: [paper](https://arxiv.org/abs/2402.14207), [GitHub](https://github.com/stanford-oval/storm)
- Hugging Face: [Open-source DeepResearch](https://huggingface.co/blog/open-deep-research)
- Jina AI: [GitHub](https://github.com/jina-ai/node-DeepResearch), [implementation guide](https://jina.ai/news/a-practical-guide-to-implementing-deepsearch-deepresearch/)
- dzhng: [GitHub](https://github.com/dzhng/deep-research), [Langfuse deep dive](https://langfuse.com/blog/2025-02-20-the-agent-deep-dive-open-deep-research)
- Together AI: [The Decoder](https://the-decoder.com/?p=22906)
- Tongyi: [technical report review](https://www.themoonlight.io/review/tongyi-deepresearch-technical-report), [Geekflare](https://geekflare.com/news/alibaba-tongyi-deepresearch-challenges-openai-5-things-to-know)
- Lists: [Awesome-Deep-Research](https://github.com/DavidZWZ/Awesome-Deep-Research)
