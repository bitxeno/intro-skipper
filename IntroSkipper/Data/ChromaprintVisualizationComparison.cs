// SPDX-FileCopyrightText: 2026 Kilian von Pflugk
// SPDX-FileCopyrightText: 2026 rlauuzo
// SPDX-FileCopyrightText: 2026 AbandonedCart
// SPDX-License-Identifier: GPL-3.0-only

namespace IntroSkipper.Data;

/// <summary>
/// Comparison payload for visualizing two chromaprint fingerprints.
/// </summary>
/// <param name="Mode">Fingerprint mode that was used.</param>
/// <param name="SampleDuration">Duration in seconds represented by one fingerprint point.</param>
/// <param name="SimilarityThresholdPercent">Minimum similarity percentage for a point to count as a match.</param>
/// <param name="MaximumTimeSkip">Maximum allowed gap between matching points when grouping matched ranges.</param>
/// <param name="MinimumMatchDuration">Minimum duration for a grouped match to be shown.</param>
/// <param name="SuggestedOffsets">Suggested point offsets derived from exact fingerprint matches.</param>
/// <param name="LikelyLeftIntro">Chromaprint-only intro candidate for the left episode.</param>
/// <param name="LikelyRightIntro">Chromaprint-only intro candidate for the right episode.</param>
/// <param name="LeftEpisode">Left-hand episode payload.</param>
/// <param name="RightEpisode">Right-hand episode payload.</param>
public record ChromaprintVisualizationComparison(
    string Mode,
    double SampleDuration,
    double SimilarityThresholdPercent,
    double MaximumTimeSkip,
    double MinimumMatchDuration,
    IReadOnlyList<int> SuggestedOffsets,
    Segment? LikelyLeftIntro,
    Segment? LikelyRightIntro,
    ChromaprintVisualizationEpisode LeftEpisode,
    ChromaprintVisualizationEpisode RightEpisode);
