// SPDX-FileCopyrightText: 2026 Intro-Skipper contributors <intro-skipper.org>
// SPDX-License-Identifier: GPL-3.0-only

namespace IntroSkipper.Helper;

/// <summary>
/// Shared helper for computing the analysis window for intro and credit fingerprinting.
/// </summary>
internal static class AnalysisDurationHelper
{
    private const double ShortItemThresholdSeconds = 5 * 60;

    /// <summary>
    /// Calculates how many seconds of media should be analyzed.
    /// </summary>
    /// <param name="durationSeconds">The total media duration in seconds.</param>
    /// <param name="analysisPercent">The configured analysis percent as a 0-1 fraction.</param>
    /// <param name="minimumAnalysisLengthMinutes">The configured minimum analysis length in minutes.</param>
    /// <param name="maximumAnalysisLengthMinutes">The configured maximum analysis length in minutes.</param>
    /// <returns>The analysis window in seconds.</returns>
    internal static double CalculateAnalysisDurationSeconds(
        double durationSeconds,
        double analysisPercent,
        int minimumAnalysisLengthMinutes,
        int maximumAnalysisLengthMinutes)
    {
        if (durationSeconds <= 0)
        {
            return 0;
        }

        var analysisDurationSeconds = durationSeconds >= ShortItemThresholdSeconds
            ? durationSeconds * analysisPercent
            : durationSeconds;

        var minimumDurationSeconds = 60 * minimumAnalysisLengthMinutes;
        var maximumDurationSeconds = 60 * maximumAnalysisLengthMinutes;

        return Math.Min(
            durationSeconds,
            Math.Min(maximumDurationSeconds, Math.Max(minimumDurationSeconds, analysisDurationSeconds)));
    }
}
