// SPDX-FileCopyrightText: 2022-2023 ConfusedPolarBear
// SPDX-FileCopyrightText: 2023 Péter Tombor
// SPDX-FileCopyrightText: 2024-2026 rlauuzo
// SPDX-FileCopyrightText: 2024-2026 AbandonedCart
// SPDX-FileCopyrightText: 2024-2026 Kilian von Pflugk
// SPDX-FileCopyrightText: 2024 CasuallyFilthy
// SPDX-FileCopyrightText: 2024 Xameon42
// SPDX-License-Identifier: GPL-3.0-only

using System.Net.Mime;
using IntroSkipper.Data;
using IntroSkipper.Helper;
using IntroSkipper.Manager;
using MediaBrowser.Common.Api;
using MediaBrowser.Controller.Entities.Movies;
using MediaBrowser.Controller.Entities.TV;
using MediaBrowser.Controller.Library;
using MediaBrowser.Controller.MediaSegments;
using MediaBrowser.Controller.Providers;
using MediaBrowser.Model.IO;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace IntroSkipper.Controllers;

/// <summary>
/// Skip intro controller.
/// </summary>
[Authorize]
[ApiController]
[Produces(MediaTypeNames.Application.Json)]
public class SkipIntroController(
    MediaSegmentUpdateManager mediaSegmentUpdateManager,
    IServiceProvider serviceProvider,
    ILibraryManager libraryManager,
    IFileSystem fileSystem) : ControllerBase
{
    private readonly MediaSegmentUpdateManager _mediaSegmentUpdateManager = mediaSegmentUpdateManager;
    private readonly IServiceProvider _serviceProvider = serviceProvider;
    private readonly ILibraryManager _libraryManager = libraryManager;
    private readonly IFileSystem _fileSystem = fileSystem;

    /// <summary>
    /// Updates the timestamps for the provided episode.
    /// </summary>
    /// <param name="id">Episode ID to update timestamps for.</param>
    /// <param name="timestamps">New timestamps Introduction/Credits start and end times.</param>
    /// <param name="cancellationToken">Cancellation Token.</param>
    /// <response code="204">New timestamps saved.</response>
    /// <response code="404">Given ID is not an Episode.</response>
    /// <returns>No content.</returns>
    [Authorize(Policy = Policies.RequiresElevation)]
    [HttpPost("Episode/{Id}/Timestamps")]
    public async Task<ActionResult> UpdateTimestampsAsync([FromRoute] Guid id, [FromBody] TimeStamps timestamps, CancellationToken cancellationToken = default)
    {
        // only update existing episodes
        var rawItem = Plugin.Instance!.GetItem(id);
        if (rawItem is not Episode and not Movie)
        {
            return NotFound();
        }

        if (timestamps == null)
        {
            return NoContent();
        }

        var segmentTypes = new[]
        {
            (AnalysisMode.Introduction, timestamps.Introduction),
            (AnalysisMode.Credits, timestamps.Credits),
            (AnalysisMode.Recap, timestamps.Recap),
            (AnalysisMode.Preview, timestamps.Preview),
            (AnalysisMode.Commercial, timestamps.Commercial)
        };

        foreach (var (mode, segment) in segmentTypes)
        {
            if (segment.Valid)
            {
                segment.EpisodeId = id;
                await Plugin.Instance!.UpdateTimestampAsync(segment, mode, isUserProvided: true, cancellationToken: cancellationToken).ConfigureAwait(false);
            }
        }

        if (Plugin.Instance.Configuration.UpdateMediaSegments)
        {
            await RefreshMediaSegmentsAsync(rawItem.Id, rawItem is Episode e ? e.SeasonId : rawItem.Id, cancellationToken).ConfigureAwait(false);
        }

        return NoContent();
    }

    /// <summary>
    /// Updates a single timestamp segment for the provided item.
    /// </summary>
    /// <param name="id">Item ID to update timestamps for.</param>
    /// <param name="request">The timestamp update request.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <response code="204">Timestamp updated.</response>
    /// <response code="400">Invalid timestamp payload.</response>
    /// <response code="404">Given ID is not an Episode or Movie.</response>
    /// <returns>No content.</returns>
    [Authorize(Policy = Policies.RequiresElevation)]
    [HttpPost("Episode/{Id}/Timestamp")]
    public async Task<ActionResult> UpdateTimestampAsync(
        [FromRoute] Guid id,
        [FromBody] UpdateTimestampRequest request,
        CancellationToken cancellationToken = default)
    {
        var rawItem = Plugin.Instance!.GetItem(id);
        if (rawItem is not Episode and not Movie)
        {
            return NotFound();
        }

        if (!Enum.TryParse(request.Mode, ignoreCase: true, out AnalysisMode mode))
        {
            return BadRequest("Unknown timestamp mode.");
        }

        if (request.CurrentStart < 0 || request.CurrentEnd < request.CurrentStart)
        {
            return BadRequest("Invalid current timestamp range.");
        }

        if (request.Start < 0 || request.End <= request.Start)
        {
            return BadRequest("Invalid updated timestamp range.");
        }

        var currentSegment = new Segment(id, new TimeRange(request.CurrentStart, request.CurrentEnd));
        var updatedSegment = new Segment(id, new TimeRange(request.Start, request.End));

        await Plugin.Instance!.DeleteTimestampAsync(id, mode, currentSegment, cancellationToken).ConfigureAwait(false);
        await Plugin.Instance!.UpdateTimestampAsync(updatedSegment, mode, isUserProvided: true, cancellationToken).ConfigureAwait(false);

        if (Plugin.Instance.Configuration.UpdateMediaSegments)
        {
            await RefreshMediaSegmentsAsync(rawItem.Id, rawItem is Episode e ? e.SeasonId : rawItem.Id, cancellationToken).ConfigureAwait(false);
        }

        return NoContent();
    }

    /// <summary>
    /// Deletes a single timestamp segment for the provided item.
    /// </summary>
    /// <param name="id">Item ID to delete timestamps for.</param>
    /// <param name="mode">Timestamp mode name.</param>
    /// <param name="currentStart">Current segment start time in seconds.</param>
    /// <param name="currentEnd">Current segment end time in seconds.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <response code="204">Timestamp deleted.</response>
    /// <response code="400">Invalid timestamp payload.</response>
    /// <response code="404">Given ID is not an Episode or Movie.</response>
    /// <returns>No content.</returns>
    [Authorize(Policy = Policies.RequiresElevation)]
    [HttpDelete("Episode/{Id}/Timestamp")]
    public async Task<ActionResult> DeleteTimestampAsync(
        [FromRoute] Guid id,
        [FromQuery] string mode,
        [FromQuery] double currentStart,
        [FromQuery] double currentEnd,
        CancellationToken cancellationToken = default)
    {
        var rawItem = Plugin.Instance!.GetItem(id);
        if (rawItem is not Episode and not Movie)
        {
            return NotFound();
        }

        if (!Enum.TryParse(mode, ignoreCase: true, out AnalysisMode analysisMode))
        {
            return BadRequest("Unknown timestamp mode.");
        }

        if (currentStart < 0 || currentEnd <= currentStart)
        {
            return BadRequest("Invalid current timestamp range.");
        }

        var currentSegment = new Segment(id, new TimeRange(currentStart, currentEnd));
        await Plugin.Instance!.DeleteTimestampAsync(id, analysisMode, currentSegment, cancellationToken).ConfigureAwait(false);

        if (Plugin.Instance.Configuration.UpdateMediaSegments)
        {
            await RefreshMediaSegmentsAsync(rawItem.Id, rawItem is Episode e ? e.SeasonId : rawItem.Id, cancellationToken).ConfigureAwait(false);
        }

        return NoContent();
    }

    /// <summary>
    /// Forces a full metadata refresh on the provided items.
    /// </summary>
    /// <param name="itemIds">Item IDs to refresh.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <response code="204">Refresh completed.</response>
    /// <returns>No content.</returns>
    [Authorize(Policy = Policies.RequiresElevation)]
    [HttpPost("Episode/RefreshMetadata")]
    public async Task<ActionResult> RefreshMetadataAsync(
        [FromBody] Guid[] itemIds,
        CancellationToken cancellationToken = default)
    {
        foreach (var id in itemIds)
        {
            cancellationToken.ThrowIfCancellationRequested();

            var item = _libraryManager.GetItemById(id);
            if (item is null)
            {
                continue;
            }

            using var shortcutLease = ShortcutProcessingThrottle.Acquire(id);

            var refreshOptions = new MetadataRefreshOptions(new DirectoryService(_fileSystem))
            {
                MetadataRefreshMode = MetadataRefreshMode.FullRefresh,
                ImageRefreshMode = MetadataRefreshMode.None,
                EnableRemoteContentProbe = true,
                ReplaceAllImages = false,
                ReplaceAllMetadata = false,
                ForceSave = false,
                IsAutomated = false,
                RemoveOldMetadata = false,
                RegenerateTrickplay = false
            };

            await item.RefreshMetadata(refreshOptions, cancellationToken).ConfigureAwait(false);
        }

        return NoContent();
    }

    /// <summary>
    /// Gets the timestamps for the provided episode.
    /// </summary>
    /// <param name="id">Episode ID.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <response code="200">Sucess.</response>
    /// <response code="404">Given ID is not an Episode.</response>
    /// <returns>Episode Timestamps.</returns>
    [HttpGet("Episode/{Id}/Timestamps")]
    [ActionName("UpdateTimestamps")]
    public async Task<ActionResult<TimeStamps>> GetTimestamps([FromRoute] Guid id, CancellationToken cancellationToken = default)
    {
        // only get return content for episodes
        var rawItem = Plugin.Instance!.GetItem(id);
        if (rawItem is not Episode and not Movie)
        {
            return NotFound();
        }

        var times = new TimeStamps();
        var segments = await Plugin.Instance!.GetTimestampsAsync(id, cancellationToken).ConfigureAwait(false);

        if (segments.TryGetValue(AnalysisMode.Introduction, out var introSegment))
        {
            times.Introduction = introSegment;
        }

        if (segments.TryGetValue(AnalysisMode.Credits, out var creditSegment))
        {
            times.Credits = creditSegment;
        }

        if (segments.TryGetValue(AnalysisMode.Recap, out var recapSegment))
        {
            times.Recap = recapSegment;
        }

        if (segments.TryGetValue(AnalysisMode.Preview, out var previewSegment))
        {
            times.Preview = previewSegment;
        }

        if (segments.TryGetValue(AnalysisMode.Commercial, out var commercialSegment))
        {
            times.Commercial = commercialSegment;
        }

        return times;
    }

    /// <summary>
    /// Checks whether the provided episode has any stored media segments.
    /// </summary>
    /// <param name="id">Episode ID.</param>
    /// <response code="200">Whether the item has stored segments.</response>
    /// <response code="404">Given ID is not an Episode.</response>
    /// <returns>Boolean segment presence flag.</returns>
    [HttpGet("Episode/{Id}/HasSegments")]
    public ActionResult<bool> HasSegments([FromRoute] Guid id)
    {
        var rawItem = Plugin.Instance!.GetItem(id);
        if (rawItem is not Episode and not Movie)
        {
            return NotFound();
        }

        var segmentManager = _serviceProvider.GetRequiredService<IMediaSegmentManager>();
        return Ok(segmentManager.HasSegments(id));
    }

    /// <summary>
    /// Gets the chapter markers for the provided episode.
    /// </summary>
    /// <param name="id">Episode ID.</param>
    /// <response code="200">Chapters retrieved.</response>
    /// <response code="404">Given ID is not an Episode.</response>
    /// <returns>List of chapter info objects.</returns>
    [HttpGet("Episode/{Id}/Chapters")]
    public ActionResult<IReadOnlyList<MediaBrowser.Model.Entities.ChapterInfo>> GetChapters([FromRoute] Guid id)
    {
        var rawItem = Plugin.Instance!.GetItem(id);
        if (rawItem is not Episode and not Movie)
        {
            return NotFound();
        }

        return Ok(Plugin.Instance!.GetChapters(id));
    }

    /// <summary>
    /// Gets a dictionary of all skippable segments.
    /// </summary>
    /// <param name="id">Media ID.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <response code="200">Skippable segments dictionary.</response>
    /// <returns>Dictionary of skippable segments.</returns>
    [HttpGet("Episode/{id}/IntroSkipperSegments")]
    public async Task<ActionResult<Dictionary<AnalysisMode, Segment>>> GetSkippableSegments([FromRoute] Guid id, CancellationToken cancellationToken = default)
    {
        var segments = await Plugin.Instance!.GetTimestampsAsync(id, cancellationToken).ConfigureAwait(false);
        var result = new Dictionary<AnalysisMode, Segment>();

        if (segments.TryGetValue(AnalysisMode.Introduction, out var introSegment))
        {
            result[AnalysisMode.Introduction] = introSegment;
        }

        if (segments.TryGetValue(AnalysisMode.Credits, out var creditSegment))
        {
            result[AnalysisMode.Credits] = creditSegment;
        }

        if (segments.TryGetValue(AnalysisMode.Recap, out var recapSegment))
        {
            result[AnalysisMode.Recap] = recapSegment;
        }

        if (segments.TryGetValue(AnalysisMode.Preview, out var previewSegment))
        {
            result[AnalysisMode.Preview] = previewSegment;
        }

        if (segments.TryGetValue(AnalysisMode.Commercial, out var commercialSegment))
        {
            result[AnalysisMode.Commercial] = commercialSegment;
        }

        return result;
    }

    /// <summary>
    /// Erases all previously discovered introduction timestamps.
    /// </summary>
    /// <param name="mode">Mode.</param>
    /// <param name="eraseCache">Erase cache.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <response code="204">Operation successful.</response>
    /// <returns>No content.</returns>
    [Authorize(Policy = Policies.RequiresElevation)]
    [HttpPost("Intros/EraseTimestamps")]
    public async Task<ActionResult> ResetIntroTimestamps([FromQuery] AnalysisMode mode, [FromQuery] bool eraseCache = false, CancellationToken cancellationToken = default)
    {
        using var db = Plugin.CreateDbContext();
        await db.DbSegment
            .Where(s => s.Type == mode)
            .ExecuteDeleteAsync(cancellationToken)
            .ConfigureAwait(false);

        if (eraseCache && mode is AnalysisMode.Introduction or AnalysisMode.Credits)
        {
            // Cache deletion must run to completion — the DB rows are already gone,
            // so aborting here would leave orphaned files with no way to clean them up.
            await Task.Run(() => FFmpegWrapper.DeleteCacheFiles(mode), CancellationToken.None).ConfigureAwait(false);
        }

        return NoContent();
    }

    /// <summary>
    /// Rebuilds the database.
    /// </summary>
    /// <response code="204">Database rebuilt.</response>
    /// <returns>No content.</returns>
    [Authorize(Policy = Policies.RequiresElevation)]
    [HttpPost("Intros/RebuildDatabase")]
    public async Task<ActionResult> RebuildDatabase()
    {
        // Database rebuild is destructive and must run to completion — do not bind to HttpContext.RequestAborted.
        using var db = Plugin.CreateDbContext();
        await db.RebuildDatabaseAsync(Plugin.CreateDbContext).ConfigureAwait(false);
        return NoContent();
    }

    private async Task RefreshMediaSegmentsAsync(Guid itemId, Guid queueKey, CancellationToken cancellationToken)
    {
        if (!Plugin.Instance!.QueuedMediaItems.TryGetValue(queueKey, out var episodes))
        {
            return;
        }

        var episode = episodes.FirstOrDefault(q => q.EpisodeId == itemId);
        if (episode is not null)
        {
            await _mediaSegmentUpdateManager.UpdateMediaSegmentsAsync([episode], cancellationToken).ConfigureAwait(false);
        }
    }
}
