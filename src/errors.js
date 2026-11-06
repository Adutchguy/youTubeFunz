'use strict';
/**
 * Plain-English hints for the errors you'll most often hit while exploring.
 * Matches on Google's error "reason" (error.errors[0].reason) and falls back to the HTTP status.
 */

const BY_REASON = {
  quotaExceeded:
    "You've used up today's quota for this bucket. It resets at midnight Pacific Time. " +
    'Cheaper alternatives (e.g. playlistItems.list instead of search.list) are in the Learn tab.',
  dailyLimitExceeded: 'Daily limit reached for this project. It resets at midnight Pacific Time.',
  rateLimitExceeded: 'Too many requests in a short time. Slow down and retry.',
  userRateLimitExceeded: 'Too many requests from this user in a short time. Slow down and retry.',
  keyInvalid: 'Google does not recognize this API key. Check YOUTUBE_API_KEY in .env.',
  badRequest: 'The request was malformed. Check parameter values and combinations.',
  accessNotConfigured:
    'The YouTube Data API v3 (or Analytics API) is not enabled for the Cloud project that owns this credential. Enable it under APIs & Services > Library.',
  SERVICE_DISABLED:
    'The API is not enabled for this Cloud project. Enable it under APIs & Services > Library, then wait a minute.',
  ipRefererBlocked: "This API key has restrictions (IP/referrer/API) that block this request. Loosen the key's restrictions.",
  insufficientPermissions:
    'The connected account is missing a scope this method needs. Disconnect, then reconnect with the scopes listed on the method.',
  ACCESS_TOKEN_SCOPE_INSUFFICIENT:
    'The access token lacks the required scope. Disconnect, then reconnect with the scopes listed on the method.',
  forbidden:
    "You're not allowed to do this with the current credentials. Many methods need OAuth and ownership of the channel/video.",
  authError: 'Authorization failed. Reconnect your Google account.',
  required: 'A required parameter is missing.',
  missingRequiredParameter: 'A required parameter is missing.',
  incompatibleParameters: 'Two parameters cannot be combined. Many filters are mutually exclusive (use exactly one).',
  invalidFilters: 'Use exactly one filter parameter.',
  filterNotSpecified: 'This method needs exactly one filter parameter (e.g. id, mine, channelId).',
  videoNotFound: "No video with that ID, or it's private/deleted.",
  channelNotFound: 'No channel matched that ID, handle or username.',
  playlistNotFound: "No playlist with that ID, or it's private.",
  commentsDisabled: 'The video owner turned comments off.',
  commentThreadNotFound: 'No comment thread with that ID.',
  subscriptionDuplicate: "You're already subscribed to that channel.",
  youtubeSignupRequired: 'The connected Google account does not have a YouTube channel yet.',
  liveStreamingNotEnabled: 'Live streaming is not enabled on this channel.',
  insufficientCommentPermissions: 'You do not have permission to act on this comment.',
  playlistItemsNotAccessible: 'That playlist cannot be read with these credentials.',
  invalidPageToken: 'The pageToken is invalid or expired. Page tokens only work for the exact same query.',
  processingFailure: 'YouTube failed to process the request. Retrying later often works.',
};

const BY_STATUS = {
  400: 'Bad request: a parameter is missing, invalid, or combined incorrectly.',
  401: 'Not authenticated. For private data connect your Google account; tokens expire after about an hour (they refresh automatically if a refresh token was issued).',
  403: 'Forbidden: wrong scope, not the owner, API not enabled, or quota exhausted. Check error.errors[0].reason.',
  404: 'Not found: the ID does not exist or is not visible to these credentials.',
  409: 'Conflict: the resource already exists or is in a state that blocks this action.',
  429: 'Rate limited. Back off and retry.',
  500: "Google had an internal error. It's usually transient.",
  503: 'Google is temporarily unavailable. Retry shortly.',
};

function explainError(status, json) {
  if (status < 400) return null;
  const err = json && json.error;
  const reasons = [];
  if (err && Array.isArray(err.errors)) for (const e of err.errors) if (e && e.reason) reasons.push(e.reason);
  if (err && Array.isArray(err.details)) for (const d of err.details) if (d && d.reason) reasons.push(d.reason);
  for (const r of reasons) if (BY_REASON[r]) return { reason: r, hint: BY_REASON[r] };
  return { reason: reasons[0] || null, hint: BY_STATUS[status] || null };
}

module.exports = { explainError };
