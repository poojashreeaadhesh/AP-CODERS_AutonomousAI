import test from "node:test";
import assert from "node:assert/strict";
import { computeSchedule, decayThreshold } from "../src/autonomousAgent.js";
import { DEFAULT_EDITORIAL_THRESHOLD } from "../src/editorial.js";

const BASE_NOW = new Date("2026-08-08T10:00:00.000Z");

function minutesBetween(fromIso, toIso) {
  return (new Date(toIso).getTime() - new Date(fromIso).getTime()) / 60000;
}

test("a quiet first cycle retries in 1 minute and decays the threshold", () => {
  const schedule = computeSchedule({
    now: BASE_NOW,
    previousNextPublishAt: BASE_NOW.toISOString(),
    hadNoPostsBefore: true,
    published: false,
    acceptedCount: 0,
    currentThreshold: DEFAULT_EDITORIAL_THRESHOLD,
    catchUpCreditsRemaining: 0
  });

  assert.equal(minutesBetween(BASE_NOW.toISOString(), schedule.nextPublishAt), 1);
  assert.equal(schedule.editorialThreshold, DEFAULT_EDITORIAL_THRESHOLD - 0.75);
  assert.match(schedule.nextPublishReason, /retrying in 1m/);
});

test("a quiet cycle after the first post retries in 10 minutes, not a full interval", () => {
  const schedule = computeSchedule({
    now: BASE_NOW,
    previousNextPublishAt: BASE_NOW.toISOString(),
    hadNoPostsBefore: false,
    published: false,
    acceptedCount: 0,
    currentThreshold: DEFAULT_EDITORIAL_THRESHOLD,
    catchUpCreditsRemaining: 0
  });

  assert.equal(minutesBetween(BASE_NOW.toISOString(), schedule.nextPublishAt), 10);
  assert.match(schedule.nextPublishReason, /retrying in 10m/);
});

test("repeated quiet cycles decay the threshold toward the floor within a handful of retries", () => {
  let threshold = DEFAULT_EDITORIAL_THRESHOLD;
  let previousNextPublishAt = BASE_NOW.toISOString();
  let now = BASE_NOW;
  const thresholdsSeen = [threshold];

  for (let i = 0; i < 5; i += 1) {
    const schedule = computeSchedule({
      now,
      previousNextPublishAt,
      hadNoPostsBefore: false,
      published: false,
      acceptedCount: 0,
      currentThreshold: threshold,
      catchUpCreditsRemaining: 0
    });

    threshold = schedule.editorialThreshold;
    thresholdsSeen.push(threshold);
    previousNextPublishAt = schedule.nextPublishAt;
    now = new Date(schedule.nextPublishAt);
  }

  assert.equal(threshold, 2.0, "threshold should have decayed to the floor within 5 quiet cycles");
  assert.ok(
    thresholdsSeen.every((value, index) => index === 0 || value <= thresholdsSeen[index - 1]),
    "threshold must never increase during a run of quiet cycles"
  );
});

test("threshold decay is bounded by the floor and never goes negative", () => {
  let threshold = DEFAULT_EDITORIAL_THRESHOLD;
  for (let i = 0; i < 20; i += 1) {
    threshold = decayThreshold(threshold);
  }

  assert.ok(threshold >= 2.0);
});

test("threshold resets to the default after a successful publish", () => {
  const schedule = computeSchedule({
    now: BASE_NOW,
    previousNextPublishAt: BASE_NOW.toISOString(),
    hadNoPostsBefore: false,
    published: true,
    acceptedCount: 1,
    currentThreshold: 2.25,
    catchUpCreditsRemaining: 0
  });

  assert.equal(schedule.editorialThreshold, DEFAULT_EDITORIAL_THRESHOLD);
});

test("publishing with a deep candidate pool shortens the next interval and says why", () => {
  const schedule = computeSchedule({
    now: BASE_NOW,
    previousNextPublishAt: BASE_NOW.toISOString(),
    hadNoPostsBefore: false,
    published: true,
    acceptedCount: 4,
    currentThreshold: DEFAULT_EDITORIAL_THRESHOLD,
    catchUpCreditsRemaining: 0
  });

  const minutes = minutesBetween(BASE_NOW.toISOString(), schedule.nextPublishAt);
  // Default PUBLISH_INTERVAL_MINUTES fallback is 120; a deep pool should
  // shorten that materially (60% factor, plus up to +/-20% jitter).
  assert.ok(minutes < 100, `expected a shortened interval, got ${minutes}m`);
  assert.match(schedule.nextPublishReason, /4 strong candidates queued/);
});

test("publishing with a thin candidate pool uses the full interval and says it's quiet", () => {
  const schedule = computeSchedule({
    now: BASE_NOW,
    previousNextPublishAt: BASE_NOW.toISOString(),
    hadNoPostsBefore: false,
    published: true,
    acceptedCount: 1,
    currentThreshold: DEFAULT_EDITORIAL_THRESHOLD,
    catchUpCreditsRemaining: 0
  });

  assert.match(schedule.nextPublishReason, /quiet news cycle/);
});

test("jittered intervals are not perfectly regular across repeated calls", () => {
  const intervals = new Set();

  for (let i = 0; i < 10; i += 1) {
    const schedule = computeSchedule({
      now: BASE_NOW,
      previousNextPublishAt: BASE_NOW.toISOString(),
      hadNoPostsBefore: false,
      published: true,
      acceptedCount: 1,
      currentThreshold: DEFAULT_EDITORIAL_THRESHOLD,
      catchUpCreditsRemaining: 0
    });
    intervals.add(schedule.nextPublishAt);
  }

  assert.ok(intervals.size > 1, "expected jitter to produce varying nextPublishAt values");
});

test("a detected host gap paces catch-up cycles 8 minutes apart instead of resuming the full interval", () => {
  const overdueSince = new Date(BASE_NOW.getTime() - 10 * 60 * 60 * 1000).toISOString(); // 10h ago

  const first = computeSchedule({
    now: BASE_NOW,
    previousNextPublishAt: overdueSince,
    hadNoPostsBefore: false,
    published: true,
    acceptedCount: 1,
    currentThreshold: DEFAULT_EDITORIAL_THRESHOLD,
    catchUpCreditsRemaining: 0
  });

  assert.equal(minutesBetween(BASE_NOW.toISOString(), first.nextPublishAt), 8);
  assert.ok(new Date(first.nextPublishAt) >= BASE_NOW, "next publish time must not be earlier than the resume time");
  assert.equal(first.catchUpCreditsRemaining, 2);

  const secondNow = new Date(first.nextPublishAt);
  const second = computeSchedule({
    now: secondNow,
    previousNextPublishAt: first.nextPublishAt,
    hadNoPostsBefore: false,
    published: true,
    acceptedCount: 1,
    currentThreshold: DEFAULT_EDITORIAL_THRESHOLD,
    catchUpCreditsRemaining: first.catchUpCreditsRemaining
  });

  assert.equal(minutesBetween(secondNow.toISOString(), second.nextPublishAt), 8);
  assert.ok(new Date(second.nextPublishAt) >= secondNow);
  assert.equal(second.catchUpCreditsRemaining, 1);

  const thirdNow = new Date(second.nextPublishAt);
  const third = computeSchedule({
    now: thirdNow,
    previousNextPublishAt: second.nextPublishAt,
    hadNoPostsBefore: false,
    published: true,
    acceptedCount: 1,
    currentThreshold: DEFAULT_EDITORIAL_THRESHOLD,
    catchUpCreditsRemaining: second.catchUpCreditsRemaining
  });

  assert.equal(minutesBetween(thirdNow.toISOString(), third.nextPublishAt), 8);
  assert.equal(third.catchUpCreditsRemaining, 0);

  // Credits exhausted: the cycle after this one returns to normal cadence.
  const fourthNow = new Date(third.nextPublishAt);
  const fourth = computeSchedule({
    now: fourthNow,
    previousNextPublishAt: third.nextPublishAt,
    hadNoPostsBefore: false,
    published: true,
    acceptedCount: 1,
    currentThreshold: DEFAULT_EDITORIAL_THRESHOLD,
    catchUpCreditsRemaining: third.catchUpCreditsRemaining
  });

  assert.ok(!/catching up/.test(fourth.nextPublishReason));
});
