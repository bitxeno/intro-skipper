// SPDX-FileCopyrightText: 2024-2026 rlauuzo
// SPDX-FileCopyrightText: 2024-2026 AbandonedCart
// SPDX-FileCopyrightText: 2024-2026 Kilian von Pflugk
// SPDX-License-Identifier: GPL-3.0-only

using IntroSkipper.Data;
using Jellyfin.Database.Implementations.Enums;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Entities.Movies;
using MediaBrowser.Controller.Entities.TV;
using MediaBrowser.Controller.Library;
using MediaBrowser.Controller.MediaSegments;
using MediaBrowser.Model;
using MediaBrowser.Model.MediaSegments;

namespace IntroSkipper.Providers
{
    /// <summary>
    /// Introskipper media segment provider.
    /// </summary>
    public class SegmentProvider : IMediaSegmentProvider
    {
        private readonly ILibraryManager _libraryManager;

        /// <summary>
        /// Mappings between AnalysisMode and MediaSegmentType.
        /// </summary>
        private static readonly Dictionary<AnalysisMode, MediaSegmentType> _segmentMappings = new()
        {
            [AnalysisMode.Introduction] = MediaSegmentType.Intro,
            [AnalysisMode.Recap] = MediaSegmentType.Recap,
            [AnalysisMode.Preview] = MediaSegmentType.Preview,
            [AnalysisMode.Credits] = MediaSegmentType.Outro,
            [AnalysisMode.Commercial] = MediaSegmentType.Commercial
        };

        /// <summary>
        /// Initializes a new instance of the <see cref="SegmentProvider"/> class.
        /// </summary>
        /// <param name="libraryManager">The library manager.</param>
        public SegmentProvider(ILibraryManager libraryManager)
        {
            _libraryManager = libraryManager;
        }

        /// <inheritdoc/>
        public string Name => Plugin.Instance!.Name;

        /// <inheritdoc/>
        public async Task<IReadOnlyList<MediaSegmentDto>> GetMediaSegments(MediaSegmentGenerationRequest request, CancellationToken cancellationToken)
        {
            ArgumentNullException.ThrowIfNull(request);
            ArgumentNullException.ThrowIfNull(Plugin.Instance);

            var item = _libraryManager.GetItemById(request.ItemId);
            if (item is null)
            {
                return Array.Empty<MediaSegmentDto>();
            }

            var libraryOptions = _libraryManager.GetLibraryOptions(item);
            if (libraryOptions != null && libraryOptions.DisabledMediaSegmentProviders.Contains(Plugin.Instance.Name))
            {
                return request.ExistingSegments.ToArray();
            }

            var segments = new List<MediaSegmentDto>();
            var itemSegments = await Plugin.Instance.GetSegmentsAsync(request.ItemId, cancellationToken).ConfigureAwait(false);
            var dedupedModes = new HashSet<AnalysisMode>();

            foreach (var segment in itemSegments.OrderBy(segment => segment.Start))
            {
                if (!_segmentMappings.TryGetValue(segment.Type, out var type))
                {
                    continue;
                }

                if (segment.End <= 0.0)
                {
                    continue;
                }

                if (segment.Type != AnalysisMode.Commercial && !dedupedModes.Add(segment.Type))
                {
                    continue;
                }

                long startTicks = (long)(segment.Start * TimeSpan.TicksPerSecond);
                long endTicks = (long)(segment.End * TimeSpan.TicksPerSecond);

                segments.Add(new MediaSegmentDto
                {
                    StartTicks = startTicks,
                    EndTicks = endTicks,
                    ItemId = request.ItemId,
                    Type = type
                });
            }

            return segments;
        }

        /// <inheritdoc/>
        public ValueTask<bool> Supports(BaseItem item) => ValueTask.FromResult(item is Episode or Movie);
    }
}
