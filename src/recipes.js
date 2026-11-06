'use strict';
/**
 * Recipes: guided, multi-step API workflows that show how calls chain together.
 *
 * Each step names a catalog method and its params. Params can reference recipe
 * variables with {{name}} (plus {{today}} and {{daysAgo:N}}). `extract` pulls values out of
 * a step's JSON response into variables for later steps, using paths like
 * "items.0.contentDetails.relatedPlaylists.uploads" or "items.*.id" (maps + joins with commas).
 *
 * `auth`: 'key' = works with just an API key; 'oauth' = needs a connected Google account.
 */

const RECIPES = [
  {
    id: 'my-channel',
    title: 'Who am I? Your channel at a glance',
    auth: 'oauth',
    level: 'start here',
    blurb:
      'The "hello world" of private data: ask for the channel that belongs to the connected account. ' +
      'Shows how mine=true swaps an ID lookup for "whoever is logged in".',
    vars: [],
    steps: [
      {
        method: 'channels.list',
        title: 'Read my own channel',
        params: { part: 'snippet,statistics,contentDetails', mine: 'true' },
        extract: { channelId: 'items.0.id', uploads: 'items.0.contentDetails.relatedPlaylists.uploads' },
        explain:
          'mine=true is a filter: exactly one of id / forHandle / mine / … is allowed. It needs OAuth because it depends on who you are. ' +
          'Note contentDetails.relatedPlaylists.uploads — the key to listing all your videos cheaply.',
      },
    ],
  },
  {
    id: 'channel-by-handle',
    title: 'Look up any channel by @handle',
    auth: 'key',
    level: 'start here',
    blurb: 'Public data needs only an API key. Resolve a handle to a channel ID and see its public numbers.',
    vars: [{ name: 'handle', label: 'Channel @handle', default: '@GoogleDevelopers' }],
    steps: [
      {
        method: 'channels.list',
        title: 'Resolve the handle',
        params: { part: 'snippet,statistics', forHandle: '{{handle}}' },
        extract: { channelId: 'items.0.id' },
        explain: 'forHandle accepts the @handle (the @ is optional). The response gives you the UC… channel ID most other calls want.',
      },
    ],
  },
  {
    id: 'latest-uploads-cheap',
    title: 'Latest uploads — the cheap way (3 units)',
    auth: 'key',
    level: 'core pattern',
    blurb:
      'Every channel has a hidden "uploads" playlist. Reading it costs 1 unit per page, versus search.list from the tiny search bucket. ' +
      'Then one videos.list call fetches stats for all of them.',
    vars: [{ name: 'handle', label: 'Channel @handle', default: '@GoogleDevelopers' }],
    steps: [
      {
        method: 'channels.list',
        title: 'Find the uploads playlist ID',
        params: { part: 'contentDetails', forHandle: '{{handle}}' },
        extract: { uploads: 'items.0.contentDetails.relatedPlaylists.uploads' },
        explain: 'contentDetails.relatedPlaylists.uploads is the ID of the auto-generated playlist of every public upload (newest first).',
      },
      {
        method: 'playlistItems.list',
        title: 'List the newest 10 uploads',
        params: { part: 'snippet,contentDetails', playlistId: '{{uploads}}', maxResults: '10' },
        extract: { ids: 'items.*.contentDetails.videoId' },
        explain: 'Each item is a video in the playlist. We collect the video IDs into one comma-separated list for the next call.',
      },
      {
        method: 'videos.list',
        title: 'Fetch stats for all 10 at once',
        params: { part: 'snippet,statistics,contentDetails', id: '{{ids}}' },
        explain: 'videos.list takes up to 50 IDs for 1 unit. playlistItems only gives you titles and IDs — statistics live on the video resource.',
      },
    ],
  },
  {
    id: 'latest-uploads-search',
    title: 'Latest uploads — the expensive way (1 search call)',
    auth: 'key',
    level: 'compare',
    blurb:
      'The same goal via search.list. Fine for one-off exploration, but each call spends 1 of your 100 daily search calls. ' +
      'Run this next to the cheap version and compare the Quota tab.',
    vars: [{ name: 'channelId', label: 'Channel ID (UC…)', default: 'UC_x5XG1OV2P6uZZ5FSM9Ttw' }],
    steps: [
      {
        method: 'search.list',
        title: 'Search a channel’s videos by date',
        params: { part: 'snippet', channelId: '{{channelId}}', type: 'video', order: 'date', maxResults: '10' },
        extract: { ids: 'items.*.id.videoId' },
        explain: 'Search results nest the video ID under id.videoId (not id). They contain no statistics — you would still need videos.list.',
      },
    ],
  },
  {
    id: 'batch-stats',
    title: 'Batch stats (new in 2026)',
    auth: 'key',
    level: 'new',
    blurb:
      'videos.batchGetStats returns just the numbers (views, likes, comments, duration) plus a success/failure summary, from its own quota bucket.',
    vars: [{ name: 'handle', label: 'Channel @handle', default: '@GoogleDevelopers' }],
    steps: [
      {
        method: 'channels.list',
        title: 'Find the uploads playlist',
        params: { part: 'contentDetails', forHandle: '{{handle}}' },
        extract: { uploads: 'items.0.contentDetails.relatedPlaylists.uploads' },
      },
      {
        method: 'playlistItems.list',
        title: 'Get recent video IDs',
        params: { part: 'contentDetails', playlistId: '{{uploads}}', maxResults: '25' },
        extract: { ids: 'items.*.contentDetails.videoId' },
      },
      {
        method: 'videos.batchGetStats',
        title: 'Batch-fetch their stats',
        params: { part: 'statistics,contentDetails,snippet', id: '{{ids}}' },
        explain:
          'Compare the response with videos.list: much smaller. Look at summary.failedVideoIds — a batch call reports per-video failures instead of failing outright.',
      },
    ],
  },
  {
    id: 'research-search',
    title: 'Research: top videos on a topic',
    auth: 'key',
    level: 'discovery',
    blurb:
      'A good use of a precious search call: discover the most-viewed recent videos on a topic, then enrich them with real statistics in one more call.',
    vars: [
      { name: 'query', label: 'Search terms', default: 'lingcod fishing Puget Sound' },
      { name: 'since', label: 'Published after (RFC 3339)', default: '2025-01-01T00:00:00Z' },
    ],
    steps: [
      {
        method: 'search.list',
        title: 'Find the most-viewed videos',
        params: { part: 'snippet', q: '{{query}}', type: 'video', order: 'viewCount', publishedAfter: '{{since}}', maxResults: '10' },
        extract: { ids: 'items.*.id.videoId' },
        explain: 'order=viewCount ranks by views. Search only returns snippets, so we pass the IDs on.',
      },
      {
        method: 'videos.list',
        title: 'Get the numbers and tags',
        params: { part: 'snippet,statistics,contentDetails', id: '{{ids}}' },
        explain: 'snippet.tags and snippet.title show how successful videos in the niche are titled and tagged.',
      },
    ],
  },
  {
    id: 'comments',
    title: 'Read the comments on a video',
    auth: 'key',
    level: 'core pattern',
    blurb: 'Comments are threads: a top-level comment plus (some) replies. Learn the thread → comment shape, and why replies need a second call.',
    vars: [{ name: 'videoId', label: 'Video ID', default: 'dQw4w9WgXcQ' }],
    steps: [
      {
        method: 'commentThreads.list',
        title: 'Top comments by relevance',
        params: { part: 'snippet,replies', videoId: '{{videoId}}', order: 'relevance', maxResults: '10', textFormat: 'plainText' },
        extract: { firstThread: 'items.0.id' },
        explain: 'Each item is a thread. snippet.topLevelComment holds the comment; replies.comments holds only a few replies (check snippet.totalReplyCount).',
      },
      {
        method: 'comments.list',
        title: 'All replies to the first thread',
        params: { part: 'snippet', parentId: '{{firstThread}}', maxResults: '20', textFormat: 'plainText' },
        explain: 'A thread’s ID is also its top-level comment’s ID, so it works as parentId to fetch every reply.',
      },
    ],
  },
  {
    id: 'paging',
    title: 'Paging through results',
    auth: 'key',
    level: 'core pattern',
    blurb:
      'List methods return one page plus nextPageToken. Watch two tiny pages get stitched together — and note each page costs the full price again.',
    vars: [{ name: 'handle', label: 'Channel @handle', default: '@GoogleDevelopers' }],
    steps: [
      {
        method: 'channels.list',
        title: 'Find the uploads playlist',
        params: { part: 'contentDetails', forHandle: '{{handle}}' },
        extract: { uploads: 'items.0.contentDetails.relatedPlaylists.uploads' },
      },
      {
        method: 'playlistItems.list',
        title: 'Page 1 (2 items)',
        params: { part: 'snippet', playlistId: '{{uploads}}', maxResults: '2' },
        extract: { token: 'nextPageToken' },
        explain: 'pageInfo.totalResults is the whole playlist size; resultsPerPage is this page. nextPageToken points to the next slice.',
      },
      {
        method: 'playlistItems.list',
        title: 'Page 2 (2 items)',
        params: { part: 'snippet', playlistId: '{{uploads}}', maxResults: '2', pageToken: '{{token}}' },
        explain: 'Same query + pageToken. Tokens are only valid for the identical query, and are opaque: never build them yourself.',
      },
    ],
  },
  {
    id: 'categories',
    title: 'Video category IDs',
    auth: 'key',
    level: 'reference',
    blurb: 'Categories (Pets & Animals, Sports, People & Blogs…) are numeric IDs. You need them for uploads and for filtering charts.',
    vars: [{ name: 'region', label: 'Region code', default: 'US' }],
    steps: [
      {
        method: 'videoCategories.list',
        title: 'List categories for a region',
        params: { part: 'snippet', regionCode: '{{region}}' },
        explain: 'Not every category is assignable (snippet.assignable) — only assignable ones are valid on upload.',
      },
    ],
  },
  {
    id: 'analytics-overview',
    title: 'Analytics: the last 28 days',
    auth: 'oauth',
    level: 'analytics',
    blurb: 'A different API (YouTube Analytics) for what only you can see: watch time, average view duration, subscribers gained.',
    vars: [],
    steps: [
      {
        method: 'reports.query',
        title: 'Totals for the last 28 days',
        params: {
          ids: 'channel==MINE',
          startDate: '{{daysAgo:28}}',
          endDate: '{{today}}',
          metrics: 'views,estimatedMinutesWatched,averageViewDuration,likes,comments,subscribersGained,subscribersLost',
        },
        explain: 'No dimensions means one row of totals. columnHeaders names each column in order; rows holds the values.',
      },
      {
        method: 'reports.query',
        title: 'Same metrics, day by day',
        params: {
          ids: 'channel==MINE',
          startDate: '{{daysAgo:28}}',
          endDate: '{{today}}',
          metrics: 'views,estimatedMinutesWatched',
          dimensions: 'day',
          sort: 'day',
        },
        explain: 'Adding dimensions=day turns totals into a time series — one row per day.',
      },
    ],
  },
  {
    id: 'analytics-top-videos',
    title: 'Analytics: top videos, with titles',
    auth: 'oauth',
    level: 'analytics',
    blurb: 'Analytics gives video IDs and numbers but no titles. Join it with the Data API to get a readable leaderboard.',
    vars: [],
    steps: [
      {
        method: 'reports.query',
        title: 'Top 10 videos by views (last 90 days)',
        params: {
          ids: 'channel==MINE',
          startDate: '{{daysAgo:90}}',
          endDate: '{{today}}',
          metrics: 'views,estimatedMinutesWatched,averageViewPercentage',
          dimensions: 'video',
          sort: '-views',
          maxResults: '10',
        },
        extract: { ids: 'rows.*.0' },
        explain: 'dimensions=video makes the first column the video ID. We extract that column (rows.*.0) for the next call.',
      },
      {
        method: 'videos.list',
        title: 'Look up their titles',
        params: { part: 'snippet', id: '{{ids}}' },
        explain: 'Two APIs, one workflow: Analytics for the numbers, Data API for the names.',
      },
    ],
  },
];

module.exports = { RECIPES };
