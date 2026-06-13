// feedbackService.js

export function generateFeedback({
  score,
  passed,
  total,
  failures
}) {

  let summary = "";

  if (score >= 90) {

    summary =
      "Excellent understanding of JavaScript concepts.";

  } else if (score >= 70) {

    summary =
      "Good understanding of JavaScript fundamentals.";

  } else if (score >= 40) {

    summary =
      "Basic understanding shown but improvement is needed.";

  } else {

    summary =
      "Significant improvements are required.";
  }

  return {
    summary,

    strengths: [
      `Passed ${passed}/${total} test cases`
    ],

    issues:
      failures.map(
        f => f.feedback
      ),

    recommendations: [
      "Review loops",
      "Review conditional logic",
      "Practice more edge cases"
    ]
  };
}