# 1st Prompt

1. You are a senior hackathon strategist, product architect, AI agent engineer, and technical judge.
We are participating in a 48-hour hackathon and only have about 24 hours left. We need to turn our first iteration into a winning submission for the problem statement “Autonomous AI Creator.”
First, read the hackathon rules and problem statement that I will paste below.

Autonomous AI Creator
Build an autonomous AI and technology persona that no longer waits for instructions.

The Situation
Every day, thousands of AI-generated posts appear on LinkedIn and X. Almost all of them exist because a human wrote the first prompt.
Today's models are excellent writers. They are rarely autonomous creators.
Your challenge is to build an autonomous AI and technology persona that no longer waits for instructions.
Once initialized, the agent should independently:
* Discover topics from live information sources
* Decide whether a topic is worth publishing
* Write in a consistent editorial voice
* Remember previously published content
* Continue publishing over time without additional human input
The persona must represent an original identity within the AI and technology ecosystem.
Examples include:
* AI Security Researcher
* Machine Learning Engineer
* AI Product Analyst
* Open Source Contributor
* Robotics Engineer
* Developer Advocate
* AI Ethics Researcher
* Or any original AI or technology-focused persona
After initialization, the agent must operate autonomously.

Minimum Requirements
Your submission must implement the following capabilities.
1. Topic Discovery
The agent independently discovers AI and technology topics using the web or another live information source.

2. Editorial Judgment
Not every discovered topic deserves publishing.
The agent should demonstrate editorial judgment by intentionally rejecting topics that do not meet its publishing standards.

3. Consistent Persona
Maintain a recognizable identity with:
* A consistent writing style
* Stable interests
* Distinct editorial opinions
* A coherent voice
The persona should remain focused on AI and technology throughout the evaluation period.

4. Memory
The agent should remember previously published content to maintain continuity and avoid unnecessary repetition.

5. Autonomous Publishing
Publishing must occur over time rather than generating all content immediately.
Submissions will be observed for approximately 48 hours after initialization. During this period, evaluators may query the feed endpoint multiple times.
New posts should appear without any additional prompts or API calls.
Simulated publishing is acceptable. Integration with real social media platforms is not required.

6. Publishing Rationale
Every published post must include:
* Why the topic was selected
* Why it is relevant now
* The source(s) of information
This information must be returned through the API response.

Evaluation Criteria
Judging will primarily consider:
* Autonomous operation after initialization
* Quality of editorial decision-making
* Consistency of the AI persona
* Effective use of memory
* Transparency of publishing rationale
* Overall quality and coherence of the generated feed

Out of Scope
The following are not required:
* Posting to real social media platforms
* Multi-platform publishing
* Images or videos
* Engagement analytics
* Multi-agent architectures
* Human intervention after initialization

API Requirements
Your submission must expose two HTTP endpoints.
1. Initialize Agent
Called exactly once before evaluation begins.
Endpoint
POST /api/agent/init
Request
{
  "persona": {
    "name": "Ada",
    "domain": "AI Security"
  }
}
Response
{
  "agentId": "abc-123"
}

2. Retrieve Feed
After initialization, this is the only endpoint the evaluator will call.
Endpoint
GET /api/agent/feed?agentId=abc-123
Response
{
  "posts": [
    {
      "id": "p7",
      "createdAt": "2026-08-07T10:30:00Z",
      "text": "...",
      "rationale": "Why this topic was selected, why it is relevant now, and why it was chosen over other candidates.",
      "sources": [
        "https://..."
      ]
    }
  ]
}
Feed Requirements
* Return posts in reverse chronological order (newest first).
* Each post must have a unique id.
* createdAt must be an ISO 8601 UTC timestamp.
* Previously returned posts should remain available.
* If no posts exist, return:
{
  "posts": []
}

Submission Rules
* The evaluator will call POST /api/agent/init exactly once.
* No further instructions or prompts will be provided.
* During the evaluation period, the evaluator will periodically call GET /api/agent/feed.
* Any new posts appearing in the feed must be generated entirely by the autonomous agent after initialization.

HACKATHON RULES AND EVALUATION PROCESS

To ensure a fair competition, every submission goes through a four-stage evaluation process. Automated verification is completed before judging so that judges only review valid submissions.
1
Stage 1: Eligibility Verification
Automatic Verification | Pass / Fail
All submissions are automatically verified during submission and rechecked after the submission deadline.
A submission must satisfy all of the following requirements:
* Repository must be publicly accessible.
* Repository URL must be valid and accessible.
* Live Demo URL must be functional and return a working application.
* AI Usage Log must be included and accessible.
* Submission must belong to a registered team.
* Submission must be received before the official deadline.
Any submission that fails one or more of the above requirements will not proceed to judging.
2
Stage 2: Authenticity Review
Automated Analysis + Manual Review
This stage verifies that the project was genuinely created during the hackathon.
The following indicators may trigger a manual review or even disqualification:
* Repository was created before the official hackathon kickoff.
* The first commit already contains most of the project, indicating an imported codebase.
* Commit history shows little or no development activity during the hackathon, followed by a large final commit.
* The AI Usage Log does not reasonably correspond to the implemented features.
* Prompt history appears incomplete, generic, or unrelated to the submitted project.
3
Stage 3: Project Judging
Two Independent Judges | 100 Points
Eligible submissions are evaluated independently by the judges using the published judging rubric.
* Each judge scores the project separately.
* Judges do not see each other's scores.
* The final score is the average of both judges' scores.
* If the difference between the two scores exceeds 15 points, a third judge will evaluate the project.
* In such cases, the median score of the three judges becomes the final score.
Only submissions that successfully complete Stages 1 and 2 are evaluated by judges.
4
Stage 4: Live Steer Challenge
Final Round | Top 6 Teams
The six highest-scoring teams qualify for the Live Steer Challenge.
Each finalist team will:
* Join a live video call.
* Share their screen throughout the challenge.
* Receive the same previously unseen feature request.
* Implement the feature within 20 minutes using their own repository.
* Use any AI tools they used during the hackathon.
The Live Steer Challenge ensures that finalists can demonstrate the same AI-assisted development skills used throughout the hackathon.


Now here is the context of our first implementation.
We built a dependency-free Node.js backend that satisfies the required API contract:
1. POST /api/agent/init
    * Accepts:{ "persona": { "name": "Ada", "domain": "AI Security" } }
    * Returns:{ "agentId": "agent-..." }
    * Initializes the agent exactly once.
    * Persists persona, voice, posts, rejected topics, seen topics, cycles, and next scheduled publishing time.
2. GET /api/agent/feed?agentId=...
    * Returns:{ "posts": [...] }
    * Posts are newest first.
    * Previously returned posts remain available.
    * Each post has:
        * unique id
        * ISO UTC createdAt
        * text
        * rationale
        * sources
Current files and behavior:
* src/server.js
    * Native Node HTTP server.
    * Implements the required endpoints.
    * Starts the autonomous background worker.
* src/autonomousAgent.js
    * Creates initial agent state.
    * Runs due publishing cycles.
    * Uses a background timer.
    * Also catches up during feed reads if the host was sleeping.
    * Default publish interval is 120 minutes.
    * Demo interval can be set with PUBLISH_INTERVAL_MINUTES=1.
* src/discovery.js
    * Discovers live topics from:
        * Hacker News Algolia API
        * Dev.to API
        * arXiv API
    * Uses persona/domain-driven queries.
    * Deduplicates discovered topics.
* src/editorial.js
    * Scores topics for:
        * AI/technology relevance
        * persona/domain fit
        * specific beat relevance, e.g. AI Security must have security-specific signals
        * freshness
        * community/research signal
        * novelty against memory
        * low-quality promotional patterns
    * Intentionally rejects weak topics.
    * Keeps rejected topic reasons.
* src/writer.js
    * Generates posts in a consistent persona voice.
    * For AI Security, the voice is measured, practical, skeptical of hype, focused on failure modes.
    * Each rationale explains:
        * why selected
        * why relevant now
        * why chosen over rejected candidates
        * sources
* src/store.js
    * Persists state to data/state.json.
    * Falls back to memory if filesystem persistence is unavailable.
* AI_USAGE_LOG.md
    * Documents AI-assisted development prompts and features.
* README.md
    * Documents setup, API usage, autonomous behavior, and deployment notes.
* Tests:
    * Editorial acceptance of good persona-relevant topics.
    * Rejection of promotional/off-beat topics.
    * Compound persona specificity, e.g. AI Security should not publish generic AI CRM content.
    * Post rationale/source transparency.
    * Memory rejection for already-published sources.
Verified behavior:
* npm test passes.
* Local API initializes successfully.
* Feed returns valid posts.
* With a 1-minute demo interval, a second newer post appears above the first while preserving the original.
* A real sample selected topic was security-relevant: “China's Kimi K3 AI model escapes isolated sandbox during security test.”
* Rationale included rejected candidates.
Important upcoming work:
* We still need to build a separate dynamic frontend later.
* We still need to add a real database later.
* For now, do not implement the frontend or database. Instead, propose the best architecture, UX, and data model so we can build them next.
* We need a public repo, live demo URL, and accessible AI usage log.
* We need a believable commit history and feature evolution.
* The app must survive approximately 48 hours of evaluator feed checks after one initialization call.
Your task:
Give us a detailed improvement plan to make this a winning hackathon project.
Please include:
1. A brutally honest assessment of the current implementation.
    * What is already strong?
    * What is weak?
    * What could fail judging?
    * What could fail during the 48-hour observation window?
2. A ranked list of highest-impact improvements.
    * Separate into Must Have, Should Have, and Nice to Have.
    * Prioritize for the fact that we only have 24 hours left.
    * Focus on what improves judging score the most.
3. Specific backend improvements.
    * Better autonomy.
    * Better topic discovery.
    * Better editorial judgment.
    * Better memory.
    * Better rationale transparency.
    * Better robustness if APIs fail.
    * Better deployment reliability.
    * Better proof that the agent is autonomous.
4. Proposed database design for later.
    * Tables/collections.
    * Fields.
    * Indexes.
    * How to persist:
        * agents
        * personas
        * posts
        * sources
        * discovered topics
        * rejected topics
        * evaluation cycles
        * schedule state
    * Recommend whether to use PostgreSQL, Supabase, SQLite, or another option for this hackathon.
    * Keep the recommendation practical for 24 hours.
5. Proposed dynamic frontend for later.
    * What pages/screens should exist?
    * What should the judges see immediately?
    * How to visualize autonomy, memory, rejected topics, source discovery, and posting timeline.
    * What UI features would make the project feel polished without wasting time.
    * Do not suggest a marketing landing page as the main experience; the first screen should be the working agent dashboard/feed.
6. Demo and judging strategy.
    * How to make the live demo convincing.
    * How to configure publishing intervals for judging vs local demo.
    * What environment variables to expose.
    * What logs or dashboard views prove autonomy.
    * How to avoid looking like we generated all posts at once.
7. Authenticity and submission hygiene.
    * Recommended commit sequence from this point onward.
    * What to include in the AI usage log.
    * What README sections are still missing.
    * What deployment checks to perform before submitting.
8. Live Steer Challenge readiness.
    * How to structure the code so we can add a feature in 20 minutes.
    * What likely feature requests judges might give.
    * How to prepare extension points.
9. Concrete next 10 tasks.
    * Give the exact order.
    * Each task should be small enough to complete quickly.
    * Mark which tasks are most likely to affect judging score.
10. Optional stretch ideas that could make the project memorable.
    * Only include ideas feasible within 24 hours.
    * Avoid multi-agent architectures unless there is a very strong reason.
Be opinionated. We want the shortest path to a winning submission, not a generic list.
A good follow-up after Claude answers: ask it to turn the top 10 tasks into exact implementation tickets with acceptance criteria.
