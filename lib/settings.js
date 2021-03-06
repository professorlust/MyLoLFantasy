var _ = require('lodash');

var logger = require('./logger.js');

var settings = {};

try {
  var defaults = require('../defaults.json');
  _.assign(settings, defaults);
} catch (err) {
  // Silently ignore (in case the file is missing)
}

try {
  var userSettings = require('../settings.json');
  _.assign(settings, userSettings);
} catch (err) {
  // Silently ignore (in case the file is missing)
}

function validateSettings(settings) {
  var requiredSettings = [
    'asset_cache_time',
    'base_path',
    'cookie_age',
    'email_url',
    'failed_log_in_count',
    'failed_log_in_reset_time',
    'ga_key',
    'is_prod',
    'league_creation_throttle_count',
    'league_creation_throttle_period',
    'league_refresh_min_wait',
    'lol_api_key',
    'lol_request_throttle_period',
    'lol_request_throttle_count',
    'max_leagues_per_user',
    'password_hash_rounds',
    'password_reset_throttle_count',
    'password_reset_throttle_period',
    'password_reset_link_duration',
    'postgre_url',
    'postgre_pool_connection_count',
    'redirect_default_port',
    'redis_host',
    'redis_port',
    'secret_key',
    'server_port',
    'sign_up_throttle_count',
    'sign_up_throttle_period',
  ];

  for (var i = 0; i < requiredSettings.length; i++) {
    if (typeof settings[requiredSettings[i]] == 'undefined')
      throw new Error('Missing setting \'' + requiredSettings[i] + '\'');
  }

  function isValidPort(port) {
    return _.isNumber(port) &&
      port > 0 && port < 65536 &&
      port === port | 0;
  }

  if (!_.isString(settings.lol_api_key))
    throw new Error('LoL API key must be a string');
  if (!_.isString(settings.postgre_url))
    throw new Error('PostgreSQL URL must be a string');
  if (!_.isString(settings.redis_host))
    throw new Error('Redis host must be a string');
  if (!isValidPort(settings.redis_port))
    throw new Error('Redis port must be valid');
  if (!_.isString(settings.secret_key))
    throw new Error('Secret key must be a string (and it should be very random!)');
  if (!_.isNumber(settings.max_leagues_per_user) || (settings.max_leagues_per_user !== settings.max_leagues_per_user | 0) || settings.max_leagues_per_user <= 0)
    throw new Error('Max number of Leagues per user must be a positive integer');
  if (!_.isNumber(settings.lol_request_throttle_count) || (settings.lol_request_throttle_count !== settings.lol_request_throttle_count | 0) || settings.lol_request_throttle_count <= 0)
    throw new Error('Number of LoL throttle requests should be a positive integer');
  if (!_.isNumber(settings.lol_request_throttle_period) || (settings.lol_request_throttle_period !== settings.lol_request_throttle_period | 0) || settings.lol_request_throttle_period < 0)
    throw new Error('LoL throttle request period must be a a non-negative integer');
  if (!_.isNumber(settings.password_hash_rounds) || (settings.password_hash_rounds !== settings.password_hash_rounds | 0) || settings.password_hash_rounds < 1)
    throw new Error('Password hash rounds must be an integer greater than zero');
  if (!isValidPort(settings.server_port))
    throw new Error('Port for server must be valid');
  if (!_.isBoolean(settings.redirect_default_port))
    throw new Error('Redirection to default port must be either `true` or `false`');
  if (!_.isBoolean(settings.is_prod))
    throw new Error('Is production must be either `true` or `false`');
  if (!_.isString(settings.ga_key))
    throw new Error('Google Analytics key must be a string value');
  if (!_.isNumber(settings.cookie_age) || (settings.cookie_age !== settings.cookie_age | 0) || settings.cookie_age <= 0)
    throw new Error('Cookie age should be a positive integer');
  if (!_.isNumber(settings.sign_up_throttle_count) || (settings.sign_up_throttle_count !== settings.sign_up_throttle_count | 0) || settings.sign_up_throttle_count <= 0)
    throw new Error('Number of sign ups per IP during one period must be a positive integer');
  if (!_.isNumber(settings.sign_up_throttle_period) || (settings.sign_up_throttle_period !== settings.sign_up_throttle_period | 0) || settings.sign_up_throttle_period < 0)
    throw new Error('Sign up throttle period must be a non-negative integer');
  if (!_.isNumber(settings.failed_log_in_count) || (settings.failed_log_in_count !== settings.failed_log_in_count | 0) || settings.failed_log_in_count <= 0)
    throw new Error('Number of failed log ins per IP/username during one period must be a positive integer');
  if (!_.isNumber(settings.failed_log_in_reset_time) || (settings.failed_log_in_reset_time !== settings.failed_log_in_reset_time | 0) || settings.failed_log_in_reset_time < 0)
    throw new Error('Failed log in lock out period must be a non-negative integer');
  if (!_.isNumber(settings.league_creation_throttle_count) || (settings.league_creation_throttle_count !== settings.league_creation_throttle_count | 0) || settings.league_creation_throttle_count <= 0)
    throw new Error('Number of league creations per account/IP during one period must be a positive integer');
  if (!_.isNumber(settings.league_creation_throttle_period) || (settings.league_creation_throttle_period !== settings.league_creation_throttle_period | 0) || settings.league_creation_throttle_period < 0)
    throw new Error('League creations throttle period must be a non-negative integer');
  if (!_.isNumber(settings.league_refresh_min_wait) || (settings.league_refresh_min_wait !== settings.league_refresh_min_wait | 0) || settings.league_refresh_min_wait < 0)
    throw new Error('Amount of time to wait before refreshing a League again must be a non-negative integer');
  if (!_.isNumber(settings.password_reset_throttle_count) || (settings.password_reset_throttle_count !== settings.password_reset_throttle_count | 0) || settings.password_reset_throttle_count <= 0)
    throw new Error('Number of password reset requests per account/IP during one period must be a positive integer');
  if (!_.isNumber(settings.password_reset_throttle_period) || (settings.password_reset_throttle_period !== settings.password_reset_throttle_period | 0) || settings.password_reset_throttle_period < 0)
    throw new Error('Password reset throttle period must be a non-negative integer');
  if (!_.isNumber(settings.password_reset_link_duration) || (settings.password_reset_link_duration !== settings.password_reset_link_duration | 0) || settings.password_reset_link_duration < 0)
    throw new Error('Password reset link duration must be a non-negative integer');
  if (!_.isString(settings.email_url))
    throw new Error('Email URL must be a string (e.g. smtps://user%40gmail.com:pass@smtp.gmail.com)');
  if (!_.isNumber(settings.asset_cache_time) || (settings.asset_cache_time !== settings.asset_cache_time | 0) || settings.asset_cache_time < 0)
    throw new Error('Asset cache time must be a non-negative integer');
  if (!_.isNumber(settings.postgre_pool_connection_count) || (settings.postgre_pool_connection_count !== settings.postgre_pool_connection_count | 0) || settings.postgre_pool_connection_count <= 0)
    throw new Error('Number of PostgreSQL pool connections must be a positive integer');
}

try {
  validateSettings(settings);
} catch (err) {
  logger.logException(err);

  // Just stop everything and tell the user they need to fix their settings
  process.kill(process.pid);
}

module.exports = settings;
