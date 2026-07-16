import logger from '../../config/logger.js';

/**
 * Calculates the final score based on the rubric criteria and test results.
 * @param {Object} rubric The rubric.json defining weights and criteria.
 * @param {Object} testResults Output from runApiTests containing passed/failed counts.
 * @returns {Object} Structured evaluation result.
 */
export const evaluateResults = (rubric, testResults) => {
    // Basic logic mapping test percentage pass/fail to the rubric's "All API endpoints work" criterion
    // In a production system, tests would map individually to specific rubric categories.
    const rubricCriteria = rubric.criteria || [];

    let totalScore = 0;
    let maxScore = 0;
    const rubric_breakdown = [];

    // Simple ratio scaling for the MVP
    const testDetails = testResults.test_details || [];
    const globalPassRatio = testResults.passedCount / (testResults.totalTests || 1);

    // Performance Monitoring
    const PERFORMANCE_THRESHOLD_MS = 500;
    const httpTests = testDetails.filter(t => t.duration !== undefined);
    const slowTests = httpTests.filter(t => t.duration > PERFORMANCE_THRESHOLD_MS);
    
    rubricCriteria.forEach((criterion) => {
        const possiblePoints = criterion.weight;
        maxScore += possiblePoints;

        const nameLower = criterion.name.toLowerCase();
        const isPerformanceCriterion = nameLower.includes('performance') || nameLower.includes('speed') || nameLower.includes('efficiency');

        let achievedPoints;
        if (isPerformanceCriterion) {
            // Performance logic: percentage of tests that stayed under threshold
            const fastTests = httpTests.length - slowTests.length;
            const perfRatio = httpTests.length > 0 ? (fastTests / httpTests.length) : 1;
            achievedPoints = Math.round(possiblePoints * perfRatio);
            logger.debug(`[Scoring] Performance Criterion "${criterion.name}": ${fastTests}/${httpTests.length} tests under ${PERFORMANCE_THRESHOLD_MS}ms. Score: ${achievedPoints}/${possiblePoints}`);
        } else {
            // Standard Logic: Find tests belonging to this criterion
            const matchingTests = testDetails.filter(t => t.criterion === criterion.name);
            if (matchingTests.length > 0) {
                const critPassed = matchingTests.filter(t => t.status === 'pass').length;
                const critRatio = critPassed / matchingTests.length;
                achievedPoints = Math.round(possiblePoints * critRatio);
            } else {
                achievedPoints = Math.round(possiblePoints * globalPassRatio);
            }
        }

        totalScore += achievedPoints;
        rubric_breakdown.push({
            name: criterion.name,
            points_achieved: achievedPoints,
            total_points: possiblePoints
        });
    });

    // Add Performance warnings to the final output
    if (slowTests.length > 0) {
        const slowList = slowTests.map(t => `${t.name} (${t.duration}ms)`).join(', ');
        const truncated = slowList.length > 200 ? `${slowList.slice(0, 200)}...` : slowList;
        testResults.warnings = testResults.warnings || [];
        testResults.warnings.push(`Performance Warning: ${slowTests.length} tests exceeded the ${PERFORMANCE_THRESHOLD_MS}ms threshold: ${truncated}`);
    }

    // We consider "Pass" to be 70% or greater overall.
    const passPercent = maxScore > 0 ? (totalScore / maxScore) * 100 : 0;
    const isPass = passPercent >= 70;

    let feedback = `Your API passed ${testResults.passedCount} out of ${testResults.totalTests} tests.`;

    if (isPass) {
        feedback += " Great job! Your backend meets the requirements.";
    } else {
        feedback += " Please review the errors and warnings to improve the robustness of your API.";
    }

    return {
        score: totalScore,
        maxScore,
        rubric_breakdown,
        feedback,
        ai_feedback: null, // Placeholder for LLM feedback
        test_details: testResults.test_details,
        warnings: testResults.warnings,
        execution_logs: testResults.execution_logs,
        pass: isPass
    };
};