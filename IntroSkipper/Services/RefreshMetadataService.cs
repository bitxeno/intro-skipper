// SPDX-License-Identifier: GPL-3.0-only

using System.Threading.Channels;
using IntroSkipper.Helper;
using MediaBrowser.Controller.Library;
using MediaBrowser.Controller.Providers;
using MediaBrowser.Model.IO;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace IntroSkipper.Services;

/// <summary>
/// Background service that processes metadata refresh requests sequentially.
/// </summary>
public sealed class RefreshMetadataService : BackgroundService
{
    private readonly Channel<Guid> _queue = Channel.CreateUnbounded<Guid>();
    private readonly ILibraryManager _libraryManager;
    private readonly IFileSystem _fileSystem;
    private readonly ILogger<RefreshMetadataService> _logger;

    /// <summary>
    /// Initializes a new instance of the <see cref="RefreshMetadataService"/> class.
    /// </summary>
    /// <param name="libraryManager">Library manager.</param>
    /// <param name="fileSystem">File system.</param>
    /// <param name="logger">Logger.</param>
    public RefreshMetadataService(
        ILibraryManager libraryManager,
        IFileSystem fileSystem,
        ILogger<RefreshMetadataService> logger)
    {
        _libraryManager = libraryManager;
        _fileSystem = fileSystem;
        _logger = logger;
    }

    /// <summary>
    /// Enqueues item IDs for background metadata refresh.
    /// </summary>
    /// <param name="itemIds">Item IDs to refresh.</param>
    public void Enqueue(IEnumerable<Guid> itemIds)
    {
        foreach (var id in itemIds)
        {
            _queue.Writer.TryWrite(id);
        }
    }

    /// <inheritdoc />
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await foreach (var id in _queue.Reader.ReadAllAsync(stoppingToken).ConfigureAwait(false))
        {
            try
            {
                var item = _libraryManager.GetItemById(id);
                if (item is null)
                {
                    _logger.LogWarning("RefreshMetadata: item {Id} not found, skipping", id);
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

                await item.RefreshMetadata(refreshOptions, stoppingToken).ConfigureAwait(false);

                _logger.LogInformation(
                    "RefreshMetadata: completed for {IndexNumber}{Name} ({Id})",
                    item.IndexNumber.HasValue ? $"E{item.IndexNumber.Value:00}." : string.Empty,
                    item.Name,
                    id);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "RefreshMetadata: failed for {Id}", id);
            }
        }
    }
}
