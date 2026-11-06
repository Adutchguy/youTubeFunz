'use strict';
/**
 * The endpoint catalog: every method the playground can call, with its parameters,
 * auth needs and quota cost. The UI is generated entirely from this file, so adding
 * an endpoint means adding one entry here.
 *
 * Costs/buckets follow https://developers.google.com/youtube/v3/determine_quota_cost
 * (checked 2026-11-06). Granular buckets began June 1, 2026: search.list and videos.insert
 * each have their own bucket (100 calls/day by default); everything else shares 10,000 units.
 * For bucketed-by-call methods, `cost` is the amount deducted from that bucket per call.
 */

const S = {
  RO: 'https://www.googleapis.com/auth/youtube.readonly',
  YT: 'https://www.googleapis.com/auth/youtube',
  SSL: 'https://www.googleapis.com/auth/youtube.force-ssl',
  UPLOAD: 'https://www.googleapis.com/auth/youtube.upload',
  MEMBER: 'https://www.googleapis.com/auth/youtube.channel-memberships.creator',
  AN: 'https://www.googleapis.com/auth/yt-analytics.readonly',
  ANM: 'https://www.googleapis.com/auth/yt-analytics-monetary.readonly',
};

/** Scopes the "Connect" dialog offers. `default` ones are pre-checked. */
const SCOPES = [
  { scope: S.RO, label: 'youtube.readonly', description: 'View your YouTube account (read-only).', default: true },
  { scope: S.AN, label: 'yt-analytics.readonly', description: 'View YouTube Analytics reports (views, watch time, subscribers).', default: true },
  { scope: S.SSL, label: 'youtube.force-ssl', description: 'Manage your videos, playlists, comments and captions. Needed for comments and any write.', default: false },
  { scope: S.YT, label: 'youtube', description: 'Manage your YouTube account (broad read/write).', default: false },
  { scope: S.UPLOAD, label: 'youtube.upload', description: 'Upload videos (the playground cannot upload files, but the scope exists).', default: false },
  { scope: S.ANM, label: 'yt-analytics-monetary.readonly', description: 'View revenue and ad-performance reports.', default: false },
  { scope: S.MEMBER, label: 'youtube.channel-memberships.creator', description: 'See your channel members and membership levels.', default: false },
];

const READ_SCOPES = [S.RO, S.YT, S.SSL];
const WRITE_SCOPES = [S.YT, S.SSL];

// ---------------------------------------------------------------------------
// Parameter helpers
// ---------------------------------------------------------------------------

const part = (options, def, description) => ({
  name: 'part',
  type: 'multi',
  required: true,
  options,
  default: def || [options[0]],
  description:
    description ||
    'Which sections ("parts") of the resource to return. Cost is the same per call, but more parts means a bigger response.',
});

const maxResults = (min, max, def, extra = '') => ({
  name: 'maxResults',
  type: 'int',
  min,
  max,
  default: def,
  description: `Items per page, ${min}–${max}.${extra}`,
});

const pageToken = {
  name: 'pageToken',
  type: 'string',
  description: "Token from a previous response's nextPageToken / prevPageToken. Every page costs the full quota again.",
};

const hl = { name: 'hl', type: 'string', description: 'Language for localized text, e.g. en_US.' };

/** Mark a parameter as one of the "use exactly one" filters. */
const filt = (p) => ({ ...p, filter: true });

const idParam = (description) => ({ name: 'id', type: 'string', required: true, description });

// ---------------------------------------------------------------------------
// Method builder
// ---------------------------------------------------------------------------

function method(resource, name, o) {
  return Object.assign(
    {
      id: `${resource}.${name}`,
      resource,
      name,
      api: 'data',
      http: 'GET',
      path: `/${resource}`,
      auth: 'either', // 'either' | 'oauth'
      scopes: READ_SCOPES, // any-of, used when OAuth is needed
      cost: 1,
      bucket: 'general',
      params: [],
      notes: [],
      executable: true,
      docs: `https://developers.google.com/youtube/v3/docs/${resource}/${name}`,
    },
    o
  );
}

const VIDEO_PARTS = [
  'snippet', 'contentDetails', 'statistics', 'status', 'player', 'topicDetails', 'recordingDetails',
  'liveStreamingDetails', 'localizations', 'paidProductPlacementDetails', 'brandPartner', 'id',
  'fileDetails', 'processingDetails', 'suggestions',
];

const WRITE_NOTE = 'Changes your real channel. The playground asks you to confirm before sending.';

const METHODS = [
  // -------------------------------------------------------------------- videos
  method('videos', 'list', {
    summary: 'Details and statistics for videos by ID — or the most popular / videos you rated.',
    oauthWhen: ['myRating'],
    params: [
      part(VIDEO_PARTS, ['snippet', 'statistics']),
      filt({ name: 'id', type: 'string', description: 'Comma-separated video IDs (up to 50). Cost stays 1 unit regardless of how many.' }),
      filt({ name: 'chart', type: 'enum', options: ['mostPopular'], description: 'Return the most popular videos for a region/category.' }),
      filt({ name: 'myRating', type: 'enum', options: ['like', 'dislike'], description: 'Videos you rated (needs OAuth).' }),
      maxResults(1, 50, 5, ' Only valid with chart or myRating.'),
      pageToken,
      { name: 'regionCode', type: 'string', description: 'ISO 3166-1 country code, e.g. US. Used with chart.' },
      { name: 'videoCategoryId', type: 'string', description: 'Category ID (see videoCategories.list). Used with chart.' },
      hl,
    ],
    notes: [
      'The cheapest way to read stats: 1 unit for up to 50 videos.',
      'parts fileDetails, processingDetails and suggestions are owner-only (OAuth as the channel owner).',
      'Since July 2025 the mostPopular chart shows Trending Music, Movies and Gaming (the Trending page was retired).',
    ],
  }),
  method('videos', 'batchGetStats', {
    path: '/videos:batchGetStats',
    bucket: 'batchStats',
    summary: 'NEW (June 2026): lightweight stats for many videos at once, in its own quota bucket.',
    docs: 'https://developers.google.com/youtube/v3/docs/videos/batchGetStats',
    params: [
      part(['contentDetails', 'id', 'snippet', 'statistics'], ['statistics']),
      idParam('Comma-separated video IDs.'),
    ],
    notes: [
      'Returns a trimmed view: snippet gives publishTime, statistics gives view/like/comment counts, contentDetails gives duration (+ durationMillis).',
      'The response includes a summary with requested / succeeded / failed counts and failedVideoIds.',
      'Public videos work with just an API key. Costs 1 unit from its own bucket (default 10,000/day).',
    ],
  }),
  method('videos', 'getRating', {
    path: '/videos/getRating',
    auth: 'oauth',
    summary: 'Whether you have liked/disliked the given videos.',
    params: [idParam('Comma-separated video IDs.')],
  }),
  method('videos', 'rate', {
    http: 'POST',
    path: '/videos/rate',
    auth: 'oauth',
    scopes: WRITE_SCOPES,
    cost: 50,
    summary: 'Like, dislike, or clear your rating on a video.',
    params: [
      idParam('The video ID.'),
      { name: 'rating', type: 'enum', required: true, options: ['like', 'dislike', 'none'], description: 'The rating to apply.' },
    ],
    notes: ['Success is 204 No Content with an empty body.', WRITE_NOTE],
  }),
  method('videos', 'update', {
    http: 'PUT',
    auth: 'oauth',
    scopes: WRITE_SCOPES,
    cost: 50,
    summary: "Update a video's title, description, tags, category, privacy, etc.",
    params: [part(['snippet', 'status', 'localizations', 'recordingDetails', 'contentDetails'], ['snippet'])],
    body: {
      template: {
        id: 'VIDEO_ID',
        snippet: { title: 'New title', description: 'New description', categoryId: '22', tags: [] },
      },
    },
    notes: [
      'Updating a part REPLACES all of its mutable fields. Read the video first (videos.list) and send the full snippet back, or fields you leave out (like description or tags) get blanked.',
      'snippet.title and snippet.categoryId are required whenever you update the snippet.',
      WRITE_NOTE,
    ],
  }),
  method('videos', 'delete', {
    http: 'DELETE',
    auth: 'oauth',
    scopes: WRITE_SCOPES,
    cost: 50,
    summary: 'Permanently delete one of your videos.',
    params: [idParam('The video ID.')],
    notes: ['IRREVERSIBLE. The playground makes you type DELETE to confirm.'],
  }),
  method('videos', 'insert', {
    http: 'POST',
    auth: 'oauth',
    scopes: [S.UPLOAD, S.YT, S.SSL],
    bucket: 'upload',
    cost: 1,
    executable: false,
    summary: 'Upload a video. Reference only: needs a resumable media upload, which this playground does not do.',
    params: [],
    notes: [
      'Costs 1 call from its own bucket (100 uploads/day by default). Before Dec 2025 an upload cost about 1,600 units.',
      'Since Nov 2, 2026, uploads from unverified API projects are no longer forced to private; default privacy follows the creator’s settings.',
    ],
  }),

  // -------------------------------------------------------------------- search
  method('search', 'list', {
    bucket: 'search',
    cost: 1,
    oauthWhen: ['forMine', 'forDeveloper'],
    summary: 'Search videos, channels and playlists. Powerful but tightly rationed: 100 calls/day by default.',
    params: [
      part(['snippet'], ['snippet'], 'Always "snippet" for search.'),
      { name: 'q', type: 'string', description: 'Search terms. Supports - (NOT) and | (OR), e.g. salmon|lingcod -shorts.' },
      { name: 'type', type: 'multi', options: ['video', 'channel', 'playlist'], default: ['video'], description: 'Resource types to return. Many filters below require type=video.' },
      { name: 'order', type: 'enum', options: ['relevance', 'date', 'rating', 'title', 'videoCount', 'viewCount'], description: 'Sort order (default relevance).' },
      { name: 'publishedAfter', type: 'datetime', placeholder: '2026-01-01T00:00:00Z', description: 'RFC 3339 timestamp, inclusive.' },
      { name: 'publishedBefore', type: 'datetime', placeholder: '2026-12-31T23:59:59Z', description: 'RFC 3339 timestamp, inclusive.' },
      { name: 'channelId', type: 'string', description: 'Only results from this channel (capped at 500 videos when type=video).' },
      maxResults(0, 50, 5),
      pageToken,
      { name: 'regionCode', type: 'string', description: 'ISO 3166-1 country code to bias results.' },
      { name: 'relevanceLanguage', type: 'string', description: 'ISO 639-1 code, e.g. en.' },
      { name: 'safeSearch', type: 'enum', options: ['moderate', 'none', 'strict'], description: 'Safe-search level (default moderate).' },
      { name: 'eventType', type: 'enum', options: ['live', 'upcoming', 'completed'], description: 'Live-broadcast state. Requires type=video.' },
      { name: 'videoDuration', type: 'enum', options: ['any', 'short', 'medium', 'long'], description: 'short < 4 min, medium 4–20 min, long > 20 min. Requires type=video.' },
      { name: 'videoDefinition', type: 'enum', options: ['any', 'high', 'standard'], description: 'Requires type=video.' },
      { name: 'videoCaption', type: 'enum', options: ['any', 'closedCaption', 'none'], description: 'Requires type=video.' },
      { name: 'videoCategoryId', type: 'string', description: 'Requires type=video.' },
      { name: 'videoEmbeddable', type: 'enum', options: ['any', 'true'], description: 'Requires type=video.' },
      { name: 'videoLicense', type: 'enum', options: ['any', 'creativeCommon', 'youtube'], description: 'Requires type=video.' },
      { name: 'videoType', type: 'enum', options: ['any', 'episode', 'movie'], description: 'Requires type=video.' },
      { name: 'videoDimension', type: 'enum', options: ['any', '2d', '3d'], description: 'Requires type=video.' },
      { name: 'location', type: 'string', placeholder: '47.97,-122.2', description: 'lat,lng center point. Requires locationRadius and type=video.' },
      { name: 'locationRadius', type: 'string', placeholder: '50km', description: 'Number + unit (m, km, ft, mi), max 1000 km.' },
      { name: 'forMine', type: 'bool', description: 'Only your own videos. Needs OAuth and type=video; cannot combine with most video* filters.' },
    ],
    notes: [
      'Each call uses 1 of your 100 daily search calls (own bucket since June 2026) — spend them on discovery, not on listing your own uploads.',
      'To list a channel’s videos cheaply: channels.list → uploads playlist → playlistItems.list (1 unit each, no search bucket).',
      'Search returns snippets only. Follow up with videos.list (or videos.batchGetStats) for statistics.',
    ],
  }),

  // ------------------------------------------------------------------ channels
  method('channels', 'list', {
    oauthWhen: ['mine'],
    summary: 'Channel details and statistics, by ID, @handle, legacy username, or your own channel.',
    params: [
      part(['snippet', 'contentDetails', 'statistics', 'status', 'brandingSettings', 'topicDetails', 'localizations', 'contentOwnerDetails', 'id'], ['snippet', 'statistics', 'contentDetails']),
      filt({ name: 'id', type: 'string', description: 'Comma-separated channel IDs (UC…).' }),
      filt({ name: 'forHandle', type: 'string', placeholder: '@GoogleDevelopers', description: 'A channel @handle.' }),
      filt({ name: 'forUsername', type: 'string', description: 'Legacy YouTube username.' }),
      filt({ name: 'mine', type: 'bool', description: 'Your own channel (needs OAuth).' }),
      maxResults(0, 50, 5),
      pageToken,
      hl,
    ],
    notes: [
      'contentDetails.relatedPlaylists.uploads is the ID of the channel’s "uploads" playlist — read it with playlistItems.list for 1 unit instead of searching.',
      'statistics.viewCount counting rules changed (Shorts in March 2025; all formats in August 2026), so older and newer numbers aren’t perfectly comparable.',
    ],
  }),
  method('channels', 'update', {
    http: 'PUT',
    auth: 'oauth',
    scopes: WRITE_SCOPES,
    cost: 50,
    summary: 'Update channel branding settings or in-video promotion (nothing else).',
    params: [part(['brandingSettings', 'invideoPromotion'], ['brandingSettings'])],
    body: {
      template: { id: 'CHANNEL_ID', brandingSettings: { channel: { description: 'New channel description' } } },
    },
    notes: ['Only brandingSettings and invideoPromotion can be updated.', WRITE_NOTE],
  }),
  method('channelSections', 'list', {
    oauthWhen: ['mine'],
    summary: 'The shelves ("sections") on a channel’s home page.',
    params: [
      part(['id', 'snippet', 'contentDetails'], ['snippet', 'contentDetails']),
      filt({ name: 'channelId', type: 'string', description: 'Channel whose sections to list.' }),
      filt({ name: 'id', type: 'string', description: 'Comma-separated section IDs.' }),
      filt({ name: 'mine', type: 'bool', description: 'Your own channel’s sections (needs OAuth).' }),
      hl,
    ],
  }),

  // ----------------------------------------------------------------- playlists
  method('playlists', 'list', {
    oauthWhen: ['mine'],
    summary: 'Playlists by ID, by channel, or your own.',
    params: [
      part(['id', 'snippet', 'contentDetails', 'status', 'player', 'localizations'], ['snippet', 'contentDetails']),
      filt({ name: 'channelId', type: 'string', description: 'Public playlists of this channel.' }),
      filt({ name: 'id', type: 'string', description: 'Comma-separated playlist IDs.' }),
      filt({ name: 'mine', type: 'bool', description: 'Your playlists, including private (needs OAuth).' }),
      maxResults(0, 50, 5),
      pageToken,
      hl,
    ],
  }),
  method('playlists', 'insert', {
    http: 'POST',
    auth: 'oauth',
    scopes: WRITE_SCOPES,
    cost: 50,
    summary: 'Create a playlist.',
    params: [part(['snippet', 'status', 'localizations'], ['snippet', 'status'])],
    body: { template: { snippet: { title: 'API Playground test playlist', description: 'Created from the playground' }, status: { privacyStatus: 'private' } } },
    notes: [WRITE_NOTE],
  }),
  method('playlists', 'update', {
    http: 'PUT',
    auth: 'oauth',
    scopes: WRITE_SCOPES,
    cost: 50,
    summary: 'Update a playlist’s title, description or privacy.',
    params: [part(['snippet', 'status', 'localizations'], ['snippet', 'status'])],
    body: { template: { id: 'PLAYLIST_ID', snippet: { title: 'New title', description: '' }, status: { privacyStatus: 'private' } } },
    notes: ['Like videos.update, a part you send replaces its mutable fields.', WRITE_NOTE],
  }),
  method('playlists', 'delete', {
    http: 'DELETE',
    auth: 'oauth',
    scopes: WRITE_SCOPES,
    cost: 50,
    summary: 'Delete a playlist.',
    params: [idParam('The playlist ID.')],
    notes: ['IRREVERSIBLE. The playground makes you type DELETE to confirm.'],
  }),

  method('playlistItems', 'list', {
    summary: 'The videos inside a playlist — including a channel’s uploads playlist. The cheap way to list uploads.',
    params: [
      part(['id', 'snippet', 'contentDetails', 'status'], ['snippet', 'contentDetails']),
      filt({ name: 'playlistId', type: 'string', description: 'Playlist to read (e.g. a channel’s uploads playlist, UU…).' }),
      filt({ name: 'id', type: 'string', description: 'Comma-separated playlistItem IDs.' }),
      maxResults(0, 50, 5),
      pageToken,
      { name: 'videoId', type: 'string', description: 'Only items for this video (with playlistId).' },
    ],
    notes: ['Page through a whole channel for roughly 1 unit per 50 videos. Compare with search.list at 100x the quota pressure.'],
  }),
  method('playlistItems', 'insert', {
    http: 'POST',
    auth: 'oauth',
    scopes: WRITE_SCOPES,
    cost: 50,
    summary: 'Add a video to a playlist.',
    params: [part(['snippet', 'contentDetails', 'status'], ['snippet'])],
    body: { template: { snippet: { playlistId: 'PLAYLIST_ID', resourceId: { kind: 'youtube#video', videoId: 'VIDEO_ID' } } } },
    notes: [WRITE_NOTE],
  }),
  method('playlistItems', 'update', {
    http: 'PUT',
    auth: 'oauth',
    scopes: WRITE_SCOPES,
    cost: 50,
    summary: 'Change an item’s position or note in a playlist.',
    params: [part(['snippet', 'contentDetails', 'status'], ['snippet'])],
    body: { template: { id: 'PLAYLIST_ITEM_ID', snippet: { playlistId: 'PLAYLIST_ID', resourceId: { kind: 'youtube#video', videoId: 'VIDEO_ID' }, position: 0 } } },
    notes: [WRITE_NOTE],
  }),
  method('playlistItems', 'delete', {
    http: 'DELETE',
    auth: 'oauth',
    scopes: WRITE_SCOPES,
    cost: 50,
    summary: 'Remove an item from a playlist (not the same as deleting the video).',
    params: [idParam('The playlistItem ID (not the video ID).')],
    notes: ['The playground makes you type DELETE to confirm.'],
  }),

  // ------------------------------------------------------------------ comments
  method('commentThreads', 'list', {
    scopes: [S.SSL],
    summary: 'Top-level comments (with optional replies) on a video or across a channel.',
    params: [
      part(['id', 'snippet', 'replies'], ['snippet', 'replies']),
      filt({ name: 'videoId', type: 'string', description: 'Threads on this video.' }),
      filt({ name: 'allThreadsRelatedToChannelId', type: 'string', description: 'Threads on the channel and all of its videos.' }),
      filt({ name: 'id', type: 'string', description: 'Comma-separated thread IDs.' }),
      maxResults(1, 100, 20),
      { name: 'order', type: 'enum', options: ['time', 'relevance'], description: 'Sort order (default time).' },
      { name: 'searchTerms', type: 'string', description: 'Only threads containing these terms.' },
      { name: 'textFormat', type: 'enum', options: ['html', 'plainText'], description: 'How comment text is returned (default html).' },
      pageToken,
    ],
    notes: [
      'replies only includes a few replies per thread; fetch the rest with comments.list?parentId=.',
      'Comments can be disabled per video — you’ll get a commentsDisabled error.',
    ],
  }),
  method('commentThreads', 'insert', {
    http: 'POST',
    auth: 'oauth',
    scopes: [S.SSL],
    cost: 50,
    summary: 'Post a new top-level comment.',
    params: [part(['snippet'], ['snippet'])],
    body: { template: { snippet: { videoId: 'VIDEO_ID', topLevelComment: { snippet: { textOriginal: 'Hello from the API playground' } } } } },
    notes: ['Posts publicly as your channel.', WRITE_NOTE],
  }),
  method('comments', 'list', {
    scopes: [S.SSL],
    summary: 'Replies to a comment, or specific comments by ID.',
    params: [
      part(['id', 'snippet'], ['snippet']),
      filt({ name: 'parentId', type: 'string', description: 'The top-level comment to list replies for.' }),
      filt({ name: 'id', type: 'string', description: 'Comma-separated comment IDs.' }),
      maxResults(1, 100, 20),
      { name: 'textFormat', type: 'enum', options: ['html', 'plainText'], description: 'Default html.' },
      pageToken,
    ],
  }),
  method('comments', 'insert', {
    http: 'POST',
    auth: 'oauth',
    scopes: [S.SSL],
    cost: 50,
    summary: 'Reply to a comment (replies only — top-level comments use commentThreads.insert).',
    params: [part(['snippet'], ['snippet'])],
    body: { template: { snippet: { parentId: 'COMMENT_ID', textOriginal: 'Thanks for watching!' } } },
    notes: [WRITE_NOTE],
  }),
  method('comments', 'update', {
    http: 'PUT',
    auth: 'oauth',
    scopes: [S.SSL],
    cost: 50,
    summary: 'Edit a comment you wrote.',
    params: [part(['snippet'], ['snippet'])],
    body: { template: { id: 'COMMENT_ID', snippet: { textOriginal: 'Edited text' } } },
    notes: [WRITE_NOTE],
  }),
  method('comments', 'setModerationStatus', {
    http: 'POST',
    path: '/comments/setModerationStatus',
    auth: 'oauth',
    scopes: [S.SSL],
    cost: 50,
    summary: 'Publish, hold or reject comments on your videos.',
    params: [
      idParam('Comma-separated comment IDs.'),
      { name: 'moderationStatus', type: 'enum', required: true, options: ['published', 'heldForReview', 'rejected'], description: 'New status.' },
      { name: 'banAuthor', type: 'bool', description: 'Also ban the author (only with rejected).' },
    ],
    notes: [WRITE_NOTE],
  }),
  method('comments', 'delete', {
    http: 'DELETE',
    auth: 'oauth',
    scopes: [S.SSL],
    cost: 50,
    summary: 'Delete a comment.',
    params: [idParam('The comment ID.')],
    notes: ['The playground makes you type DELETE to confirm.'],
  }),

  // ------------------------------------------------------------- subscriptions
  method('subscriptions', 'list', {
    oauthWhen: ['mine', 'myRecentSubscribers', 'mySubscribers'],
    summary: 'Who a channel subscribes to, or (with OAuth) who subscribes to you.',
    params: [
      part(['id', 'snippet', 'contentDetails', 'subscriberSnippet'], ['snippet']),
      filt({ name: 'channelId', type: 'string', description: 'Subscriptions of this channel (public ones).' }),
      filt({ name: 'id', type: 'string', description: 'Comma-separated subscription IDs.' }),
      filt({ name: 'mine', type: 'bool', description: 'Your subscriptions (needs OAuth).' }),
      filt({ name: 'mySubscribers', type: 'bool', description: 'Your subscribers (needs OAuth). Only those who made their subscription public.' }),
      filt({ name: 'myRecentSubscribers', type: 'bool', description: 'Your recent subscribers (needs OAuth).' }),
      { name: 'forChannelId', type: 'string', description: 'Check subscription to these channel IDs.' },
      { name: 'order', type: 'enum', options: ['relevance', 'alphabetical', 'unread'], description: 'Sort order.' },
      maxResults(0, 50, 5),
      pageToken,
    ],
  }),
  method('subscriptions', 'insert', {
    http: 'POST',
    auth: 'oauth',
    scopes: WRITE_SCOPES,
    cost: 50,
    summary: 'Subscribe to a channel.',
    params: [part(['snippet', 'contentDetails'], ['snippet'])],
    body: { template: { snippet: { resourceId: { kind: 'youtube#channel', channelId: 'CHANNEL_ID' } } } },
    notes: [WRITE_NOTE],
  }),
  method('subscriptions', 'delete', {
    http: 'DELETE',
    auth: 'oauth',
    scopes: WRITE_SCOPES,
    cost: 50,
    summary: 'Unsubscribe.',
    params: [idParam('The subscription ID (not the channel ID).')],
    notes: ['The playground makes you type DELETE to confirm.'],
  }),

  // ---------------------------------------------------------------- activities
  method('activities', 'list', {
    oauthWhen: ['mine'],
    summary: 'A channel’s recent public activity (uploads, playlist adds, etc.).',
    params: [
      part(['id', 'snippet', 'contentDetails'], ['snippet', 'contentDetails']),
      filt({ name: 'channelId', type: 'string', description: 'Channel to read.' }),
      filt({ name: 'mine', type: 'bool', description: 'Your own activity (needs OAuth).' }),
      maxResults(1, 50, 5),
      pageToken,
      { name: 'publishedAfter', type: 'datetime', placeholder: '2026-01-01T00:00:00Z', description: 'RFC 3339.' },
      { name: 'publishedBefore', type: 'datetime', placeholder: '2026-12-31T23:59:59Z', description: 'RFC 3339.' },
      { name: 'regionCode', type: 'string', description: 'ISO 3166-1 country code.' },
    ],
  }),

  // ------------------------------------------------------------------ captions
  method('captions', 'list', {
    auth: 'oauth',
    scopes: [S.SSL],
    cost: 50,
    summary: 'Caption tracks on a video you own.',
    params: [
      part(['id', 'snippet'], ['snippet']),
      { name: 'videoId', type: 'string', required: true, description: 'The video whose captions to list.' },
      { name: 'id', type: 'string', description: 'Comma-separated caption track IDs.' },
    ],
    notes: ['Costs 50 units even though it only reads — plan accordingly.'],
  }),
  method('captions', 'delete', {
    http: 'DELETE',
    auth: 'oauth',
    scopes: [S.SSL],
    cost: 50,
    summary: 'Delete a caption track.',
    params: [idParam('The caption track ID.')],
    notes: ['The playground makes you type DELETE to confirm.'],
  }),
  method('captions', 'insert', {
    http: 'POST',
    auth: 'oauth',
    scopes: [S.SSL],
    cost: 400,
    executable: false,
    summary: 'Upload a caption track. Reference only (needs media upload).',
    notes: ['Costs 400 units.'],
  }),
  method('captions', 'update', {
    http: 'PUT',
    auth: 'oauth',
    scopes: [S.SSL],
    cost: 450,
    executable: false,
    summary: 'Replace a caption track. Reference only (needs media upload).',
    notes: ['Costs 450 units.'],
  }),

  // ---------------------------------------------------------------- reference
  method('videoCategories', 'list', {
    summary: 'Video category IDs (e.g. 22 = People & Blogs) for a region. Needed for uploads and category filters.',
    params: [
      part(['snippet'], ['snippet']),
      filt({ name: 'regionCode', type: 'string', default: 'US', description: 'Categories available in this country.' }),
      filt({ name: 'id', type: 'string', description: 'Comma-separated category IDs.' }),
      hl,
    ],
  }),
  method('i18nLanguages', 'list', {
    summary: 'Languages the YouTube site supports.',
    params: [part(['snippet'], ['snippet']), hl],
  }),
  method('i18nRegions', 'list', {
    summary: 'Regions (countries) the YouTube site supports.',
    params: [part(['snippet'], ['snippet']), hl],
  }),
  method('videoAbuseReportReasons', 'list', {
    summary: 'The reasons a video can be reported for.',
    params: [part(['snippet'], ['snippet']), hl],
  }),

  // ---------------------------------------------------------------- live + members
  method('liveBroadcasts', 'list', {
    auth: 'oauth',
    summary: 'Your live broadcasts (upcoming, active, completed).',
    params: [
      part(['id', 'snippet', 'contentDetails', 'status', 'monetizationDetails'], ['snippet', 'status']),
      filt({ name: 'broadcastStatus', type: 'enum', options: ['all', 'active', 'completed', 'upcoming'], description: 'Filter by state.' }),
      filt({ name: 'id', type: 'string', description: 'Comma-separated broadcast IDs.' }),
      filt({ name: 'mine', type: 'bool', description: 'Your broadcasts.' }),
      maxResults(0, 50, 5),
      pageToken,
    ],
  }),
  method('liveStreams', 'list', {
    auth: 'oauth',
    summary: 'Your live stream (ingestion) configurations.',
    params: [
      part(['id', 'snippet', 'cdn', 'contentDetails', 'status'], ['snippet', 'status']),
      filt({ name: 'id', type: 'string', description: 'Comma-separated stream IDs.' }),
      filt({ name: 'mine', type: 'bool', description: 'Your streams.' }),
      maxResults(0, 50, 5),
      pageToken,
    ],
  }),
  method('liveChatMessages', 'list', {
    cost: 5,
    summary: 'Messages from a live chat (needs the liveChatId from liveBroadcasts.list → snippet.liveChatId).',
    params: [
      { name: 'liveChatId', type: 'string', required: true, description: 'Chat ID from the broadcast’s snippet.' },
      part(['id', 'snippet', 'authorDetails'], ['snippet', 'authorDetails']),
      maxResults(200, 2000, 500),
      pageToken,
      { name: 'profileImageSize', type: 'int', description: 'Author avatar size in px (16–720).' },
      hl,
    ],
    notes: ['Costs 5 units per poll — polling every few seconds adds up fast.'],
  }),
  method('superChatEvents', 'list', {
    auth: 'oauth',
    summary: 'Recent Super Chat purchases on your channel.',
    params: [part(['snippet'], ['snippet']), maxResults(5, 50, 5), pageToken, hl],
  }),
  method('members', 'list', {
    auth: 'oauth',
    scopes: [S.MEMBER],
    summary: 'Your channel’s members (needs memberships enabled on the channel).',
    params: [
      part(['snippet'], ['snippet']),
      { name: 'mode', type: 'enum', options: ['all_current', 'updates'], description: 'all_current (default) or only changes since last poll.' },
      maxResults(0, 1000, 5),
      pageToken,
      { name: 'hasAccessToLevel', type: 'string', description: 'Only members at/above this level ID.' },
      { name: 'filterByMemberChannelId', type: 'string', description: 'Comma-separated channel IDs to check.' },
    ],
  }),
  method('membershipsLevels', 'list', {
    auth: 'oauth',
    scopes: [S.MEMBER],
    summary: 'Your channel’s membership levels.',
    params: [part(['id', 'snippet'], ['snippet'])],
  }),

  // ------------------------------------------------------- media-upload (reference)
  method('thumbnails', 'set', {
    http: 'POST',
    auth: 'oauth',
    scopes: [S.UPLOAD, S.YT, S.SSL],
    cost: 50,
    executable: false,
    summary: 'Upload a custom thumbnail. Reference only (needs a media upload).',
    notes: [
      'Costs 50 units. Max file size is now 50 MB (was 2 MB until Sept 2026).',
      'Since Nov 3, 2026 it also supports custom thumbnails for Shorts.',
    ],
  }),
  method('channelBanners', 'insert', {
    http: 'POST',
    path: '/channelBanners/insert',
    auth: 'oauth',
    scopes: [S.UPLOAD, S.YT, S.SSL],
    cost: 50,
    executable: false,
    summary: 'Upload a channel banner image. Reference only: it’s step 1 of 3 (upload, then channels.update with the returned URL).',
  }),

  // ------------------------------------------------------------- YouTube Analytics
  method('reports', 'query', {
    api: 'analytics',
    path: '/reports',
    auth: 'oauth',
    scopes: [S.AN, S.ANM],
    bucket: 'analytics',
    cost: 1,
    docs: 'https://developers.google.com/youtube/analytics/reference/reports/query',
    summary: 'YouTube Analytics: views, watch time, subscribers, revenue… sliced by day, video, country, traffic source and more.',
    params: [
      { name: 'ids', type: 'string', required: true, default: 'channel==MINE', description: 'channel==MINE or channel==UC… (or contentOwner==… for partners).' },
      { name: 'startDate', type: 'date', required: true, default: '@daysAgo:28', description: 'YYYY-MM-DD.' },
      { name: 'endDate', type: 'date', required: true, default: '@today', description: 'YYYY-MM-DD.' },
      { name: 'metrics', type: 'string', required: true, default: 'views,estimatedMinutesWatched,averageViewDuration,subscribersGained', description: 'Comma-separated metrics.' },
      { name: 'dimensions', type: 'string', placeholder: 'day', description: 'Comma-separated dimensions, e.g. day, video, country, insightTrafficSourceType, deviceType.' },
      { name: 'filters', type: 'string', placeholder: 'video==VIDEO_ID;country==US', description: 'Semicolon-separated filters.' },
      { name: 'sort', type: 'string', placeholder: '-views', description: 'Comma-separated; prefix - for descending.' },
      { name: 'maxResults', type: 'int', min: 1, description: 'Max rows to return.' },
      { name: 'startIndex', type: 'int', min: 1, description: '1-based index of the first row.' },
      { name: 'currency', type: 'string', description: 'ISO 4217 code for revenue metrics (default USD).' },
    ],
    notes: [
      'A different API with its own host, its own quota and its own docs. Enable "YouTube Analytics API" in your Cloud project.',
      'Common metrics: views, estimatedMinutesWatched, averageViewDuration, averageViewPercentage, likes, comments, shares, subscribersGained, subscribersLost.',
      'Not every metric/dimension combination is valid — the error message tells you which are allowed together.',
      'Docs say this method needs youtube.readonly in addition to the Analytics scope; the default Connect selection includes both.',
    ],
  }),
];

const byId = new Map(METHODS.map((m) => [m.id, m]));

const BUCKET_LABELS = {
  general: 'General pool',
  search: 'Search bucket',
  upload: 'Upload bucket',
  batchStats: 'batchGetStats bucket',
  analytics: 'Analytics API',
};

module.exports = { METHODS, byId, SCOPES, BUCKET_LABELS };
