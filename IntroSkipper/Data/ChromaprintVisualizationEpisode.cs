// SPDX-FileCopyrightText: 2026 Kilian von Pflugk
// SPDX-FileCopyrightText: 2026 rlauuzo
// SPDX-FileCopyrightText: 2026 AbandonedCart
// SPDX-License-Identifier: GPL-3.0-only

namespace IntroSkipper.Data;

/// <summary>
/// Fingerprint payload for a single episode in the chromaprint visualizer.
/// </summary>
/// <param name="Id">Episode id.</param>
/// <param name="Name">Episode name.</param>
/// <param name="EpisodeNumber">Episode number within the season.</param>
/// <param name="Duration">Total episode runtime in seconds.</param>
/// <param name="FingerprintStartSeconds">Start time in the episode where the fingerprint begins.</param>
/// <param name="FingerprintEndSeconds">End time in the episode where the fingerprint ends.</param>
/// <param name="Fingerprint">Raw chromaprint points.</param>
public record ChromaprintVisualizationEpisode(
    Guid Id,
    string Name,
    int EpisodeNumber,
    double Duration,
    double FingerprintStartSeconds,
    double FingerprintEndSeconds,
    IReadOnlyList<uint> Fingerprint);
