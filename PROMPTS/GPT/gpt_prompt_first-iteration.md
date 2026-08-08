# 1st Prompt

1. Below is the rules of the hackathon, go through it throughly and wait for me to give the problem statements


# 2nd Prompt 

2. **Hackathon Rules and Evaluation Process**
To ensure a fair competition, every submission goes through a **four-stage** evaluation process. Automated verification is completed before judging so that judges only review valid submissions.

**1**
**Stage** **1:** **Eligibility Verification**
**Automatic Verification |** **Pass / Fail**

All submissions are automatically verified during submission and rechecked after the submission deadline.

A submission must satisfy **all** of the following requirements:

Repository must be **publicly accessible**.
Repository URL must be valid and accessible.
Live Demo URL must be functional and return a working application.
AI Usage Log must be included and accessible.
Submission must belong to a registered team.
Submission must be received before the official deadline.
Any submission that fails one or more of the above requirements will not proceed to judging.

**2**
**Stage** **2:** **Authenticity Review**
**Automated Analysis + Manual Review**

This stage verifies that the project was genuinely created during the hackathon.

The following indicators may trigger a manual review or even **disqualification**:

Repository was created before the official hackathon kickoff.
The first commit already contains most of the project, indicating an imported codebase.
Commit history shows little or no development activity during the hackathon, followed by a large final commit.
The AI Usage Log does not reasonably correspond to the implemented features.
Prompt history appears incomplete, generic, or unrelated to the submitted project.
**3**
**Stage** **3:** **Project Judging**
**Two Independent Judges |** **100 Points**

Eligible submissions are evaluated independently by the judges using the published judging rubric.

Each judge scores the project separately.
Judges do not see each other's scores.
The final score is the average of both judges' scores.
If the difference between the two scores exceeds **15 points**, a third judge will evaluate the project.
In such cases, the **median score** of the three judges becomes the final score.
Only submissions that successfully complete Stages 1 and 2 are evaluated by judges.

**4**
**Stage** **4:** **Live Steer Challenge**
**Final Round |** **Top 6 Teams**

The six highest-scoring teams qualify for the Live Steer Challenge.

Each finalist team will:

Join a live video call.
Share their screen throughout the challenge.
Receive the same previously unseen feature request.
Implement the feature within **20 minutes** using their own repository.
Use any AI tools they used during the hackathon.
The Live Steer Challenge ensures that finalists can demonstrate the same AI-assisted development skills used throughout the hackathon.



# 3rd prompt

3. 3
Autonomous AI Creator
Build an autonomous AI and technology persona that no longer waits for instructions.

The Situation
Every day, thousands of AI-generated posts appear on LinkedIn and X. Almost all of them exist because a human wrote the first prompt.

Today's models are excellent writers. They are rarely autonomous creators.

Your challenge is to build an autonomous AI and technology persona that no longer waits for instructions.

Once initialized, the agent should independently:

Discover topics from live information sources
Decide whether a topic is worth publishing
Write in a consistent editorial voice
Remember previously published content
Continue publishing over time without additional human input
The persona must represent an original identity within the AI and technology ecosystem.

Examples include:

AI Security Researcher
Machine Learning Engineer
AI Product Analyst
Open Source Contributor
Robotics Engineer
Developer Advocate
AI Ethics Researcher
Or any original AI or technology-focused persona
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

A consistent writing style
Stable interests
Distinct editorial opinions
A coherent voice
The persona should remain focused on AI and technology throughout the evaluation period.

4. Memory
The agent should remember previously published content to maintain continuity and avoid unnecessary repetition.

5. Autonomous Publishing
Publishing must occur over time rather than generating all content immediately.

Submissions will be observed for approximately 48 hours after initialization. During this period, evaluators may query the feed endpoint multiple times.

New posts should appear without any additional prompts or API calls.

Simulated publishing is acceptable. Integration with real social media platforms is not required.

6. Publishing Rationale
Every published post must include:

Why the topic was selected
Why it is relevant now
The source(s) of information
This information must be returned through the API response.

Evaluation Criteria
Judging will primarily consider:

Autonomous operation after initialization
Quality of editorial decision-making
Consistency of the AI persona
Effective use of memory
Transparency of publishing rationale
Overall quality and coherence of the generated feed
Out of Scope
The following are not required:

Posting to real social media platforms
Multi-platform publishing
Images or videos
Engagement analytics
Multi-agent architectures
Human intervention after initialization
API Requirements
Your submission must expose two HTTP endpoints.

1. Initialize Agent
Called exactly once before evaluation begins.

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
After initialization, this is the only endpoint the evaluator will call.

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
Return posts in reverse chronological order (newest first).
Each post must have a unique id.
createdAt must be an ISO 8601 UTC timestamp.
Previously returned posts should remain available.
If no posts exist, return:
{
  "posts": []
}
Submission Rules
The evaluator will call POST /api/agent/init exactly once.
No further instructions or prompts will be provided.
During the evaluation period, the evaluator will periodically call GET /api/agent/feed.
Any new posts appearing in the feed must be generated entirely by the autonomous agent after initialization.