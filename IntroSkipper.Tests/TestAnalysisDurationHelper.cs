// SPDX-FileCopyrightText: 2026 Intro-Skipper contributors <intro-skipper.org>
// SPDX-License-Identifier: GPL-3.0-only

using IntroSkipper.Helper;
using Xunit;

namespace IntroSkipper.Tests;

public class TestAnalysisDurationHelper
{
    [Fact]
    public void ShortItems_UseTheirFullDuration()
    {
        var result = AnalysisDurationHelper.CalculateAnalysisDurationSeconds(
            durationSeconds: 4 * 60,
            analysisPercent: 0.25,
            minimumAnalysisLengthMinutes: 6,
            maximumAnalysisLengthMinutes: 10);

        Assert.Equal(4 * 60, result);
    }

    [Fact]
    public void LongItems_AreRaisedToTheMinimumRuntime_WhenPercentageIsLower()
    {
        var result = AnalysisDurationHelper.CalculateAnalysisDurationSeconds(
            durationSeconds: 20 * 60,
            analysisPercent: 0.25,
            minimumAnalysisLengthMinutes: 6,
            maximumAnalysisLengthMinutes: 10);

        Assert.Equal(6 * 60, result);
    }

    [Fact]
    public void LongItems_AreCappedByTheMaximumRuntime()
    {
        var result = AnalysisDurationHelper.CalculateAnalysisDurationSeconds(
            durationSeconds: 60 * 60,
            analysisPercent: 0.25,
            minimumAnalysisLengthMinutes: 6,
            maximumAnalysisLengthMinutes: 10);

        Assert.Equal(10 * 60, result);
    }
}