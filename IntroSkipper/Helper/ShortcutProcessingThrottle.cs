// SPDX-FileCopyrightText: 2026 Intro-Skipper contributors <intro-skipper.org>
// SPDX-License-Identifier: GPL-3.0-only

using IntroSkipper.Configuration;
using IntroSkipper.Data;

namespace IntroSkipper.Helper;

internal static class ShortcutProcessingThrottle
{
    private static readonly SemaphoreSlim _semaphore = new(1, 1);
    private static Guid? _lastEpisodeId;
    private static DateTimeOffset _lastCompletedAt = DateTimeOffset.MinValue;

    internal static TimeSpan GetInterval(QueuedEpisode episode, PluginConfiguration config)
    {
        ArgumentNullException.ThrowIfNull(episode);
        ArgumentNullException.ThrowIfNull(config);

        return !episode.IsShortcut || config.ProcessShortcutInterval <= 0
            ? TimeSpan.Zero
            : TimeSpan.FromSeconds(config.ProcessShortcutInterval);
    }

    internal static TimeSpan GetWaitBeforeProcessing(
        Guid episodeId,
        DateTimeOffset now,
        Guid? lastEpisodeId,
        DateTimeOffset lastCompletedAt,
        TimeSpan interval)
    {
        if (interval <= TimeSpan.Zero || lastEpisodeId is null || lastEpisodeId == episodeId)
        {
            return TimeSpan.Zero;
        }

        var nextAllowedAt = lastCompletedAt + interval;
        return nextAllowedAt > now ? nextAllowedAt - now : TimeSpan.Zero;
    }

    internal static IDisposable? Acquire(QueuedEpisode? episode)
    {
        if (episode is null)
        {
            return null;
        }

        var config = Plugin.Instance?.Configuration ?? new PluginConfiguration();
        var interval = GetInterval(episode, config);
        if (interval <= TimeSpan.Zero)
        {
            return null;
        }

        _semaphore.Wait();

        var wait = GetWaitBeforeProcessing(
            episode.EpisodeId,
            DateTimeOffset.UtcNow,
            _lastEpisodeId,
            _lastCompletedAt,
            interval);

        if (wait > TimeSpan.Zero)
        {
            Thread.Sleep(wait);
        }

        return new Lease(episode.EpisodeId);
    }

    internal static IDisposable? Acquire(Guid episodeId)
    {
        var config = Plugin.Instance?.Configuration ?? new PluginConfiguration();
        var interval = config.ProcessShortcutInterval <= 0
            ? TimeSpan.Zero
            : TimeSpan.FromSeconds(config.ProcessShortcutInterval);

        if (interval <= TimeSpan.Zero)
        {
            return null;
        }

        _semaphore.Wait();

        var wait = GetWaitBeforeProcessing(
            episodeId,
            DateTimeOffset.UtcNow,
            _lastEpisodeId,
            _lastCompletedAt,
            interval);

        if (wait > TimeSpan.Zero)
        {
            Thread.Sleep(wait);
        }

        return new Lease(episodeId);
    }

    private sealed class Lease(Guid episodeId) : IDisposable
    {
        private int _disposed;

        public void Dispose()
        {
            if (Interlocked.Exchange(ref _disposed, 1) != 0)
            {
                return;
            }

            _lastEpisodeId = episodeId;
            _lastCompletedAt = DateTimeOffset.UtcNow;
            _semaphore.Release();
        }
    }
}
