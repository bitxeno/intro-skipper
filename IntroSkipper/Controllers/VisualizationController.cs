// SPDX-FileCopyrightText: 2022 ConfusedPolarBear
// SPDX-FileCopyrightText: 2024-2026 rlauuzo
// SPDX-FileCopyrightText: 2024-2026 Kilian von Pflugk
// SPDX-FileCopyrightText: 2024-2026 AbandonedCart
// SPDX-FileCopyrightText: 2024 theMasterpc
// SPDX-License-Identifier: GPL-3.0-only

using System.Net.Mime;
using IntroSkipper.Analyzers;
using IntroSkipper.Configuration;
using IntroSkipper.Data;
using IntroSkipper.Manager;
using IntroSkipper.ScheduledTasks;
using Jellyfin.Data.Enums;
using Jellyfin.Database.Implementations.Enums;
using MediaBrowser.Common.Api;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Entities.TV;
using MediaBrowser.Controller.Library;
using MediaBrowser.Controller.Providers;
using MediaBrowser.Model.IO;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace IntroSkipper.Controllers;

/// <summary>
/// Audio fingerprint visualization controller. Allows browsing fingerprints on a per episode basis.
/// </summary>
/// <remarks>
/// Initializes a new instance of the <see cref="VisualizationController"/> class.
/// </remarks>
/// <param name="logger">Logger.</param>
/// <param name="mediaSegmentUpdateManager">Media segment update manager.</param>
/// <param name="libraryManager">libraryManager.</param>
/// <param name="providerManager">providerManager.</param>
/// <param name="fileSystem">fileSystem.</param>
/// <param name="loggerFactory">loggerFactory.</param>
[Authorize(Policy = Policies.RequiresElevation)]
[ApiController]
[Produces(MediaTypeNames.Application.Json)]
[Route("Intros")]
public partial class VisualizationController(ILogger<VisualizationController> logger, MediaSegmentUpdateManager mediaSegmentUpdateManager, ILibraryManager libraryManager, IProviderManager providerManager, IFileSystem fileSystem, ILoggerFactory loggerFactory) : ControllerBase
{
    private readonly ILogger<VisualizationController> _logger = logger;
    private readonly MediaSegmentUpdateManager _mediaSegmentUpdateManager = mediaSegmentUpdateManager;
    private readonly ILibraryManager _libraryManager = libraryManager;
    private readonly IProviderManager _providerManager = providerManager;
    private readonly IFileSystem _fileSystem = fileSystem;
    private readonly ILoggerFactory _loggerFactory = loggerFactory;

    /// <summary>
    /// Returns the analyzer actions for the provided season.
    /// </summary>
    /// <param name="seasonId">Season ID.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>Analyzer actions for the season.</returns>
    [HttpGet("AnalyzerActions/{SeasonId}")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<IReadOnlyDictionary<AnalysisMode, AnalyzerAction>>> GetAnalyzerAction([FromRoute] Guid seasonId, CancellationToken cancellationToken = default)
    {
        if (!Plugin.Instance!.QueuedMediaItems.ContainsKey(seasonId))
        {
            return NotFound();
        }

        var analyzerActions = await Plugin.Instance!.GetAllAnalyzerActionsAsync(seasonId, cancellationToken).ConfigureAwait(false);

        return Ok(analyzerActions);
    }

    /// <summary>
    /// Returns the names and unique identifiers of all episodes in the provided season.
    /// </summary>
    /// <param name="seriesId">Show ID.</param>
    /// <param name="seasonId">Season ID.</param>
    /// <returns>List of episode titles.</returns>
    [HttpGet("Show/{SeriesId}/{SeasonId}")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public ActionResult<List<EpisodeVisualization>> GetSeasonEpisodes([FromRoute] Guid seriesId, [FromRoute] Guid seasonId)
    {
        var episodes = ResolveSeasonEpisodes(seriesId, seasonId);
        if (episodes.Count == 0)
        {
            return NotFound();
        }

        return episodes.Select(e => new EpisodeVisualization(e.EpisodeId, e.Name)).ToList();
    }

    /// <summary>
    /// Returns raw chromaprint data for two episodes so the dashboard can visualize their similarity.
    /// </summary>
    /// <param name="leftEpisodeId">Left-hand episode id.</param>
    /// <param name="rightEpisodeId">Right-hand episode id.</param>
    /// <param name="mode">Fingerprint mode.</param>
    /// <returns>Chromaprint visualization payload.</returns>
    [HttpGet("Chromaprint/Compare/{LeftEpisodeId}/{RightEpisodeId}")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    [ProducesResponseType(StatusCodes.Status500InternalServerError)]
    public ActionResult<ChromaprintVisualizationComparison> GetChromaprintComparison(
        [FromRoute] Guid leftEpisodeId,
        [FromRoute] Guid rightEpisodeId,
        [FromQuery] AnalysisMode mode = AnalysisMode.Introduction)
    {
        if (mode is not (AnalysisMode.Introduction or AnalysisMode.Credits))
        {
            return BadRequest("Chromaprint visualization only supports Introduction and Credits mode.");
        }

        var leftEpisode = ResolveEpisodeForChromaprint(leftEpisodeId);
        var rightEpisode = ResolveEpisodeForChromaprint(rightEpisodeId);
        if (leftEpisode is null || rightEpisode is null)
        {
            return NotFound();
        }

        try
        {
            var leftFingerprint = FFmpegWrapper.Fingerprint(leftEpisode, mode);
            var rightFingerprint = FFmpegWrapper.Fingerprint(rightEpisode, mode);
            var config = Plugin.Instance?.Configuration ?? new PluginConfiguration();
            var analyzer = new ChromaprintAnalyzer(_loggerFactory.CreateLogger<ChromaprintAnalyzer>());
            var timeAdjustmentHelper = new TimeAdjustmentHelper(_loggerFactory.CreateLogger<TimeAdjustmentHelper>(), config, mode);
            var (likelyLeftIntro, likelyRightIntro) = analyzer.CompareEpisodes(
                leftEpisode.EpisodeId,
                leftFingerprint,
                rightEpisode.EpisodeId,
                rightFingerprint);

            if (mode == AnalysisMode.Credits)
            {
                OffsetVisualizationSegmentForCredits(likelyLeftIntro, leftEpisode);
                OffsetVisualizationSegmentForCredits(likelyRightIntro, rightEpisode);
            }

            var adjustedLeftIntro = AdjustVisualizationSegment(likelyLeftIntro, leftEpisode, timeAdjustmentHelper);
            var adjustedRightIntro = AdjustVisualizationSegment(likelyRightIntro, rightEpisode, timeAdjustmentHelper);

            return new ChromaprintVisualizationComparison(
                mode.ToString(),
                ChromaprintConstants.SampleDuration,
                100 - ((config.MaximumFingerprintPointDifferences * 100.0) / 32.0),
                config.MaximumTimeSkip,
                mode == AnalysisMode.Introduction ? config.MinimumIntroDuration : config.MinimumCreditsDuration,
                ChromaprintAnalyzer.GetSuggestedOffsets(leftFingerprint, rightFingerprint),
                adjustedLeftIntro,
                adjustedRightIntro,
                CreateVisualizationEpisode(leftEpisode, leftFingerprint, mode),
                CreateVisualizationEpisode(rightEpisode, rightFingerprint, mode));
        }
        catch (FingerprintException ex)
        {
            LogChromaprintVisualizationFailed(_logger, ex, leftEpisodeId, rightEpisodeId);
            return Problem("Unable to compute chromaprint data for the selected episodes.", statusCode: StatusCodes.Status500InternalServerError);
        }
        catch (Exception ex)
        {
            LogChromaprintVisualizationFailed(_logger, ex, leftEpisodeId, rightEpisodeId);
            return Problem("Unable to build adjusted Chromaprint intro data for the selected episodes.", statusCode: StatusCodes.Status500InternalServerError);
        }
    }

    /// <summary>
    /// Erases all timestamps for the provided season.
    /// </summary>
    /// <param name="seriesId">Show ID.</param>
    /// <param name="seasonId">Season ID.</param>
    /// <param name="eraseCache">Erase cache.</param>
    /// <param name="cancellationToken">Cancellation Token.</param>
    /// <response code="204">Season timestamps erased.</response>
    /// <response code="404">Unable to find season in provided series.</response>
    /// <returns>No content.</returns>
    [HttpDelete("Show/{SeriesId}/{SeasonId}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    [ProducesResponseType(StatusCodes.Status500InternalServerError)]
    public async Task<ActionResult> EraseSeasonAsync([FromRoute] Guid seriesId, [FromRoute] Guid seasonId, [FromQuery] bool eraseCache = false, CancellationToken cancellationToken = default)
    {
        var episodes = ResolveSeasonEpisodes(seriesId, seasonId);
        if (episodes.Count == 0)
        {
            return NotFound();
        }

        LogErasingTimestamps(_logger, seriesId, seasonId);

        try
        {
            using var db = Plugin.CreateDbContext();

            // ExecuteDeleteAsync runs a single server-side DELETE and bypasses the change tracker.
            // This is safe here because the tracked operations below target DbSeasonInfo, not DbSegment.
            var episodeIds = episodes.Select(e => e.EpisodeId).ToHashSet();
            await db.DbSegment
                .Where(s => episodeIds.Contains(s.ItemId))
                .ExecuteDeleteAsync(cancellationToken)
                .ConfigureAwait(false);

            if (eraseCache)
            {
                // Cache deletion must run to completion — the DB rows are already gone,
                // so aborting here would leave orphaned files with no way to clean them up.
                foreach (var episode in episodes)
                {
                    await Task.Run(() => FFmpegWrapper.DeleteFingerprintCache(episode.EpisodeId), CancellationToken.None).ConfigureAwait(false);
                }
            }

            // Batch-load season info and clear episode IDs.
            var seasonInfos = await db.DbSeasonInfo
                .Where(s => s.SeasonId == seasonId)
                .ToListAsync(cancellationToken)
                .ConfigureAwait(false);

            foreach (var info in seasonInfos)
            {
                db.Entry(info).Property(s => s.EpisodeIds).CurrentValue = [];
            }

            await db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);

            if (Plugin.Instance!.Configuration.UpdateMediaSegments)
            {
                await _mediaSegmentUpdateManager.UpdateMediaSegmentsAsync(episodes, cancellationToken).ConfigureAwait(false);
            }

            return NoContent();
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception ex)
        {
            LogFailedToEraseTimestamps(_logger, ex, seriesId, seasonId);
            return Problem("An unexpected error occurred while erasing season data.", statusCode: StatusCodes.Status500InternalServerError);
        }
    }

    private List<QueuedEpisode> ResolveSeasonEpisodes(Guid seriesId, Guid seasonId)
    {
        if (Plugin.Instance!.QueuedMediaItems.TryGetValue(seasonId, out var queuedEpisodes)
            && queuedEpisodes.Count > 0
            && queuedEpisodes.Any(e => e.SeriesId == seriesId))
        {
            return queuedEpisodes;
        }

        var query = new InternalItemsQuery
        {
            ParentId = seasonId,
            IncludeItemTypes = [BaseItemKind.Episode],
            Recursive = false,
            IsVirtualItem = false,
            OrderBy = [(ItemSortBy.IndexNumber, SortOrder.Ascending)],
        };

        return _libraryManager.GetItemList(query, false)
            .OfType<Episode>()
            .Where(episode => episode.SeriesId == seriesId)
            .Select(episode => new QueuedEpisode
            {
                SeriesName = episode.SeriesName ?? string.Empty,
                SeasonNumber = episode.AiredSeasonNumber ?? 0,
                EpisodeNumber = episode.IndexNumber ?? 0,
                EpisodeId = episode.Id,
                SeasonId = episode.SeasonId,
                SeriesId = episode.SeriesId,
                Path = episode.Path ?? string.Empty,
                ShortcutPath = episode.ShortcutPath,
                Name = episode.Name ?? string.Empty,
                Category = QueuedMediaCategory.Episode,
                IsShortcut = episode.IsShortcut,
                Duration = TimeSpan.FromTicks(episode.RunTimeTicks ?? 0).TotalSeconds,
            })
            .ToList();
    }

    private QueuedEpisode? ResolveEpisodeForChromaprint(Guid episodeId)
    {
        if (Plugin.Instance?.GetItem(episodeId) is not Episode episode || string.IsNullOrEmpty(episode.Path))
        {
            return null;
        }

        var plugin = Plugin.Instance;
        if (plugin is null)
        {
            return null;
        }

        var duration = TimeSpan.FromTicks(episode.RunTimeTicks ?? 0).TotalSeconds;
        if (duration <= 0)
        {
            duration = FFmpegWrapper.ProbeDuration(new QueuedEpisode
            {
                EpisodeId = episode.Id,
                Path = episode.Path,
                ShortcutPath = episode.ShortcutPath,
                IsShortcut = episode.IsShortcut,
            });
        }

        var analysisPercent = Convert.ToDouble(plugin.Configuration.AnalysisPercent) / 100;
        var fingerprintDuration = global::IntroSkipper.Helper.AnalysisDurationHelper.CalculateAnalysisDurationSeconds(
            duration,
            analysisPercent,
            plugin.Configuration.MinimumAnalysisLength,
            plugin.Configuration.AnalysisLengthLimit);

        var maxCreditsDuration = global::IntroSkipper.Helper.AnalysisDurationHelper.CalculateAnalysisDurationSeconds(
            duration,
            analysisPercent,
            plugin.Configuration.MinimumAnalysisLength,
            plugin.Configuration.MaximumCreditsDuration);

        return new QueuedEpisode
        {
            SeriesName = episode.SeriesName ?? string.Empty,
            SeasonNumber = episode.AiredSeasonNumber ?? 0,
            EpisodeNumber = episode.IndexNumber ?? 0,
            EpisodeId = episode.Id,
            SeasonId = episode.SeasonId,
            SeriesId = episode.SeriesId,
            Path = episode.Path,
            ShortcutPath = episode.ShortcutPath,
            Name = episode.Name ?? string.Empty,
            Category = QueuedMediaCategory.Episode,
            IsShortcut = episode.IsShortcut,
            Duration = duration,
            IntroFingerprintEnd = fingerprintDuration,
            CreditsFingerprintStart = Math.Max(0, duration - maxCreditsDuration),
        };
    }

    private static ChromaprintVisualizationEpisode CreateVisualizationEpisode(
        QueuedEpisode episode,
        uint[] fingerprint,
        AnalysisMode mode)
    {
        var fingerprintStart = mode == AnalysisMode.Credits ? episode.CreditsFingerprintStart : 0;
        var fingerprintEnd = mode == AnalysisMode.Credits ? episode.Duration : episode.IntroFingerprintEnd;

        return new ChromaprintVisualizationEpisode(
            episode.EpisodeId,
            episode.Name,
            episode.EpisodeNumber,
            episode.Duration,
            fingerprintStart,
            fingerprintEnd,
            fingerprint);
    }

    private static void OffsetVisualizationSegmentForCredits(Segment intro, QueuedEpisode episode)
    {
        if (!intro.Valid)
        {
            return;
        }

        intro.Start += episode.CreditsFingerprintStart;
        intro.End += episode.CreditsFingerprintStart;
    }

    private static Segment? AdjustVisualizationSegment(Segment intro, QueuedEpisode episode, TimeAdjustmentHelper timeAdjustmentHelper)
    {
        if (!intro.Valid)
        {
            return null;
        }

        var adjustedIntro = timeAdjustmentHelper.AdjustIntroTimes(episode, new Segment(intro));
        return adjustedIntro.Valid ? adjustedIntro : null;
    }

    /// <summary>
    /// Updates the analyzer actions for the provided season.
    /// </summary>
    /// <param name="request">Update analyzer actions request.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>No content.</returns>
    [HttpPost("AnalyzerActions/UpdateSeason")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    public async Task<ActionResult> UpdateAnalyzerActions([FromBody] UpdateAnalyzerActionsRequest request, CancellationToken cancellationToken = default)
    {
        await Plugin.Instance!.SetAnalyzerActionAsync(request.Id, request.AnalyzerActions, cancellationToken).ConfigureAwait(false);

        return NoContent();
    }

    /// <summary>
    /// Returns whether a scan is currently running.
    /// </summary>
    /// <returns>A JSON object indicating whether a scan is currently in progress.</returns>
    [HttpGet("ScanStatus")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    public ActionResult<ScanStatusResponse> GetScanStatus()
    {
        return new ScanStatusResponse(ScheduledTaskSemaphore.IsBusy);
    }

    /// <summary>
    /// Scans the provided season for intros.
    /// </summary>
    /// <param name="seriesId">Show ID.</param>
    /// <param name="seasonId">Season ID.</param>
    /// <param name="cancellationToken">cancellationToken.</param>
    /// <returns>Accepted if the scan was started; Conflict if a scan is already running.</returns>
    [HttpPost("ScanSeason/{SeriesId}/{SeasonId}")]
    [ProducesResponseType(StatusCodes.Status202Accepted)]
    [ProducesResponseType(StatusCodes.Status409Conflict)]
    public async Task<ActionResult> ScanSeason([FromRoute] Guid seriesId, [FromRoute] Guid seasonId, CancellationToken cancellationToken = default)
    {
        if (_libraryManager is null)
        {
            throw new InvalidOperationException("Library manager was null");
        }

        var scanLease = await ScheduledTaskSemaphore.TryAcquireAsync().ConfigureAwait(false);
        if (scanLease is null)
        {
            return Conflict(new { message = "A scan is already in progress." });
        }

        // Run erase + analyze in background so it doesn't get canceled when the HTTP request ends/timeouts
        _ = Task.Run(
            async () =>
            {
                using (scanLease)
                {
                    try
                    {
                        // Do not bind to the HTTP request cancellation; long-running job should complete even if client disconnects
                        LogStartRescan(_logger, seasonId);

                        // Erase season timestamps and cache first
                        // await EraseSeasonAsync(seriesId, seasonId, true, CancellationToken.None).ConfigureAwait(false);

                        var baseIntroAnalyzer = new BaseItemAnalyzerTask(
                            _loggerFactory.CreateLogger<DetectSegmentsTask>(),
                            _loggerFactory,
                            _libraryManager,
                            _providerManager,
                            _fileSystem,
                            _mediaSegmentUpdateManager);

                        await baseIntroAnalyzer.AnalyzeItemsAsync(new Progress<double>(), CancellationToken.None, [seasonId]).ConfigureAwait(false);
                    }
                    catch (OperationCanceledException)
                    {
                        LogRescanCanceled(_logger, seasonId);
                    }
                    catch (Exception ex)
                    {
                        LogRescanError(_logger, ex, seasonId);
                    }
                }
            },
            CancellationToken.None);

        // Immediately return to the client; background task continues
        return Accepted();
    }

    [LoggerMessage(Level = LogLevel.Information, Message = "Erasing timestamps for series {SeriesId} season {SeasonId} at user request")]
    private static partial void LogErasingTimestamps(ILogger logger, Guid seriesId, Guid seasonId);

    [LoggerMessage(Level = LogLevel.Error, Message = "Failed to erase timestamps for series {SeriesId} season {SeasonId}")]
    private static partial void LogFailedToEraseTimestamps(ILogger logger, Exception ex, Guid seriesId, Guid seasonId);

    [LoggerMessage(Level = LogLevel.Information, Message = "Start (Re-) scan of season/movie {SeasonId}")]
    private static partial void LogStartRescan(ILogger logger, Guid seasonId);

    [LoggerMessage(Level = LogLevel.Error, Message = "Failed to build chromaprint visualization payload for {LeftEpisodeId} and {RightEpisodeId}")]
    private static partial void LogChromaprintVisualizationFailed(ILogger logger, Exception ex, Guid leftEpisodeId, Guid rightEpisodeId);

    [LoggerMessage(Level = LogLevel.Information, Message = "Manual season rescan for {SeasonId} was canceled.")]
    private static partial void LogRescanCanceled(ILogger logger, Guid seasonId);

    [LoggerMessage(Level = LogLevel.Error, Message = "Error during manual season rescan for {SeasonId}")]
    private static partial void LogRescanError(ILogger logger, Exception ex, Guid seasonId);
}
