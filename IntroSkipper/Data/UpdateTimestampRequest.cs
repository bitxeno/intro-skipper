// SPDX-FileCopyrightText: 2026 rlauuzo
// SPDX-License-Identifier: GPL-3.0-only

namespace IntroSkipper.Data;

/// <summary>
/// Updates a single timestamp segment for an item.
/// </summary>
public class UpdateTimestampRequest
{
    /// <summary>
    /// Gets or sets the timestamp mode name.
    /// </summary>
    public string Mode { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the current segment start time in seconds.
    /// </summary>
    public double CurrentStart { get; set; }

    /// <summary>
    /// Gets or sets the current segment end time in seconds.
    /// </summary>
    public double CurrentEnd { get; set; }

    /// <summary>
    /// Gets or sets the new segment start time in seconds.
    /// </summary>
    public double Start { get; set; }

    /// <summary>
    /// Gets or sets the new segment end time in seconds.
    /// </summary>
    public double End { get; set; }
}
