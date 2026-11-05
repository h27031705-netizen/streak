# StreakForce Project Guide

## Purpose

StreakForce extends the existing tracker into an **Intelligent Cross-Platform Consistency and Progress Tracking System**. It retains the original dashboard, account/session flow, platform adapters, calendar logging, streaks, notifications, and SQLite database, and adds recurring activities, project tasks, measurable goals, unified history, explainable scoring, and a per-user consistency classifier.

## Existing Foundation

- Front end: vanilla JavaScript, HTML, and CSS using the existing dashboard and navigation.
- Backend: Express routes in `server.js`.
- Database: SQLite through `better-sqlite3`; existing tables remain in use.
- Authentication: server-side sessions with HTTP-only cookies; passwords use per-user salted scrypt hashes.
- Public sync: LeetCode, CodeChef, Codeforces, and AtCoder use their current public endpoints/adapters. Other platforms can be saved as public profile links, but are not presented as automatically synced.
- Manual activity: existing platform/day entries remain supported. New recurring activities use separate log rows so multiple sessions and completion history are retained.

## Added Data Model

New tables are additive and profile-owned:

- `custom_activities` and `custom_activity_logs`: recurring activities, frequency, target, completion, date, and note.
- `projects`, `project_tasks`, and `project_task_events`: project metadata, priorities/deadlines, current task state, and append-only complete/reopen history.
- `goals` and `goal_progress_logs`: measurable targets, current progress, deadline, priority, and append-only progress entries.

Existing external platform rows, manual platform rows, profile IDs, and catalog entries are not replaced. The unified activity history is composed from the existing sync/manual tables and the new activity, task, and goal logs. Write APIs require the current session and scope reads/writes by `profile_id`.

## Consistency Score

The score is a weighted 0-100 summary of stored data:

`35% recent active-day coverage + 25% planned-session completion + 20% activity rhythm + 20% goal progress`

- Recent coverage: unique activity days in the last 30 days divided by 30.
- Planned-session completion: completed custom-activity logs divided by the activities' combined weekly frequency projected over 30 days, capped at 100%.
- Rhythm: `1 - average gap between active days / 14`, clamped to 0-1.
- Goal progress: mean current/target ratio across active and completed goals.
- If the user has no scheduled activities or no goals, that component uses active-day coverage rather than treating the absent feature as failure. With no recorded events, the score is `null` and the interface shows a cold-start state.

The API returns every component and a plain-language reason list so users can see why the score changes.

## Machine Learning

`lib/consistency.js` performs per-user feature engineering and deterministic K-Means without an external ML service or added package. It creates eight rolling 7-day feature vectors using:

1. Active-day rate
2. Planned-session completion rate
3. Longest streak density within that window
4. Activity-source diversity

K-Means groups the user's historical weekly vectors into three clusters. The current week's vector is assigned to its nearest cluster. A transparent rule maps its cluster quality and recent activity/trend to **Highly Consistent**, **Consistent**, **Irregular**, **At Risk**, or **Inactive**: a current activity rate below 15% is Inactive; below 30% or a decline over 30 percentage points is At Risk; otherwise cluster quality below 0.48 is Irregular, at least 0.78 is Highly Consistent, and the middle range is Consistent. The response names the model, assigned cluster, confidence, and training-history size.

Cold start is explicit: a classification is withheld until there are at least four active historical weeks and 14 logged days. The feature set is small and explainable for a semester project; it is not a clinical or long-horizon prediction.

## Recommendations and History

Recommendations are generated from stored facts, not random motivational text: goal deadlines/progress, completed project tasks, recent activity changes, and weekday/weekend distribution. The existing AI Coach can explain the backend score and unified history. It works without an LLM; no raw user data is sent to an external model.

## Run and Test

```powershell
npm install
npm start
```

Open `http://localhost:3000`. Run the test suite with:

```powershell
npm test
```

The tests cover old-schema migration preservation, score components, K-Means determinism, cold start, streak gaps, registration/login/Remember Me/recovery, authenticated platform/activity/project/goal flows, unified history, and profile isolation using a temporary SQLite database. Run with `npm test`.

## Current Integration Limits

- Automatic public activity import remains limited to the existing four adapters. HackerRank, GitHub, GeeksforGeeks, and custom platforms can retain username/profile URL and open the public profile; no sync statistics are fabricated.
- Custom activity targets use a weekly frequency and per-session target. Goal completion is progress-log based; projects do not infer task completion from external platforms.
- K-Means is recalculated from a bounded recent window and is intentionally conservative for new accounts. Recommendations are deterministic rules over computed features, not generated prose.
