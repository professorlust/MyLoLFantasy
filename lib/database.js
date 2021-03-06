var _ = require('lodash');
var url = require('url');

var pg = require('pg');
var Q = require('q');

var logger = require('./logger.js');
var settings = require('./settings.js');

var DB_VERSION = '1.3.0';

var DB_VERSION_TABLE =
  'CREATE TABLE version (' +
    'version          TEXT PRIMARY KEY' +
  ');';

var DB_USERS_TABLE =
  'CREATE TABLE users (' +
    'username         TEXT PRIMARY KEY,' +
    'password_hash    TEXT NOT NULL,' +
    'email            TEXT NOT NULL,' +
    'summoner_name    TEXT NOT NULL,' +
    'region           TEXT NOT NULL' +
  ');';

var DB_LEAGUES_TABLE =
  'CREATE TABLE leagues (' +
    'id               SERIAL PRIMARY KEY,' +
    'name             TEXT NOT NULL,' +
    'owner            TEXT NOT NULL REFERENCES users (username) ON DELETE CASCADE,' +
    'region           TEXT NOT NULL,' +
    'data             TEXT NOT NULL,' +
    'creation_time    TIMESTAMP NOT NULL,' +
    'matches_tracked  TEXT[] NOT NULL,' +
    'last_update      TIMESTAMP NOT NULL,' +
    'is_inactive      BOOLEAN NOT NULL DEFAULT FALSE' +
  ');';

// All methods return Q promises unless otherwise noted.
function DB() {
  var self = this;

  var params = url.parse(settings.postgre_url);
  var auth = params.auth.split(':');
  var config = {
    user: auth[0],
    password: auth[1],
    host: params.hostname,
    port: params.port,
    database: params.pathname.split('/')[1],
    max: settings.postgre_pool_connection_count,
    ssl: false,
  };

  self.pool = new pg.Pool(config);
}

DB.prototype.init = function() {
  var self = this;
  return Q.ninvoke(self.pool, 'connect').spread(function(client, done) {
    return Q.ninvoke(client, 'query', 'SELECT version FROM version;').then(function(result) {
      if (!result.rows.length) {
        throw new Error('Database version is faulty. Please recreate your database.');
      } else if (result.rows[0].version !== DB_VERSION) {
        throw new Error('Database is out of date. Run `node batch/update_db.js`.');
      }
    }).fin(function() {
      done();
    });
  });
};

// Call this when doing graceful shutdowns so that the Node process can end
DB.prototype.deinit = function() {
  var self = this;
  return Q.Promise(function(resolve, reject) {
    self.pool.end(function() {
      resolve();
    });
  });
};

DB.prototype.createDb = function() {
  var self = this;
  return Q.ninvoke(self.pool, 'connect').spread(function(client, done) {
    // Drop tables in correct order. We silently ignore errors since if the table doesn't
    // exist we don't care.
    return Q.Promise(function(resolve, reject) {
      client.query('DROP TABLE leagues;', function(err, result) {
        resolve();
      });
    }).then(function() {
      return Q.Promise(function(resolve, reject) {
        client.query('DROP TABLE users;', function(err, result) {
          resolve();
        });
      });
    }).then(function() {
      return Q.Promise(function(resolve, reject) {
        client.query('DROP TABLE version;', function(err, result) {
          resolve();
        });
      });
    })
    .then(function() { return Q.ninvoke(client, 'query', DB_VERSION_TABLE); })
    .then(function() { return Q.ninvoke(client, 'query', 'INSERT INTO version (version) VALUES (\'' + DB_VERSION + '\');'); })
    .then(function() { return Q.ninvoke(client, 'query', DB_USERS_TABLE); })
    .then(function() { return Q.ninvoke(client, 'query', DB_LEAGUES_TABLE); }).fin(function() {
      done();
    });
  });
};

DB.prototype.updateDb = function(version, lol) {
  var self = this;

  var config = {
    connectionString: settings.postgre_url,
    ssl: false,
  };

  var client = new pg.Client(config);

  switch (version) {
    case '1.0.0':
      logger.log('Updating DB from v1.0.0 to v1.1.0 ...');
      return Q.ninvoke(client, 'connect').then(function() {
        return Q.ninvoke(client, 'query', 'BEGIN;').then(function() {
          return Q.ninvoke(client, 'query', 'ALTER TABLE leagues ADD COLUMN last_update TIMESTAMP;');
        }).then(function() {
          return Q.ninvoke(client, 'query', 'UPDATE leagues SET last_update = \'epoch\'');
        }).then(function() {
          return Q.ninvoke(client, 'query', 'ALTER TABLE leagues ALTER COLUMN last_update SET NOT NULL;');
        }).then(function() {
          return Q.ninvoke(client, 'query', 'UPDATE version SET version = \'1.1.0\'');
        }).fail(function(reason) {
          logger.logException(reason);
          return Q.ninvoke(client, 'query', 'ROLLBACK;').then(function() {
            throw new Error('Failure to update database from v1.0.0 to v1.1.0.');
          });
        }).then(function() {
          return Q.ninvoke(client, 'query', 'COMMIT;');
        }).then(function() {
          return self.updateDb('1.1.0', lol);
        }).fin(function() {
          client.end();
        });
      });
    case '1.1.0':
      logger.log('Updating DB from v1.1.0 to v1.2.0 ...');
      return Q.ninvoke(client, 'connect').then(function() {
        return Q.ninvoke(client, 'query', 'BEGIN;').then(function() {
          var deferred = Q.defer();

          var query = client.query('SELECT id, region, data FROM leagues;');

          var receivedRows = 0;
          var processedRows = 0;
          var isDone = false;
          function checkResolved() {
            return isDone && receivedRows === processedRows;
          }

          query.on('row', function(league) {
            receivedRows += 1;
            logger.log('Updating league ' + league.id);
            league.data = JSON.parse(league.data);
            var updatePromises = [];

            _.forEach(league.data, function(summonerData, summonerName) {
              var update = lol.getAccountId(league.region, summonerData.summonerId).then(function(accountId) {
                summonerData.accountId = accountId;
              }, function(reason) {
                return Q.delay(30000).then(function() {
                  return lol.getAccountId(league.region, summonerData.summonerId).then(function(accountId) {
                    summonerData.accountId = accountId;
                  }, function(reason) {
                    return Q.delay(30000).then(function() {
                      return lol.getAccountId(league.region, summonerData.summonerId).then(function(accountId) {
                        summonerData.accountId = accountId;
                      });
                    });
                  });
                });
              });

              updatePromises.push(update);
            });

            Q.all(updatePromises).then(function() {
              var queryParams = {
                name: 'add_account_ids',
                text: 'UPDATE leagues SET data = $2 WHERE id = $1;',
                values: [league.id, JSON.stringify(league.data)]
              };
              return Q.ninvoke(client, 'query', queryParams);
            }).then(function() {
              logger.log('Added accountIds to league with id ' + league.id);
              processedRows += 1;
              if (checkResolved()) {
                deferred.resolve();
              }
            }).fail(function(reason) {
              deferred.reject(reason);
            }).done();
          });

          query.on('end', function() {
            isDone = true;
            if (checkResolved()) {
              deferred.resolve();
            }
          });

          query.on('error', function(err) {
            deferred.reject(err);
          });

          return deferred.promise;
        }).then(function() {
          return Q.ninvoke(client, 'query', 'UPDATE version SET version = \'1.2.0\'');
        }).fail(function(reason) {
          logger.logException(reason);
          return Q.ninvoke(client, 'query', 'ROLLBACK;').then(function() {
            throw new Error('Failure to update database from v1.1.0 to v1.2.0.');
          });
        }).then(function() {
          return Q.ninvoke(client, 'query', 'COMMIT;');
        }).then(function() {
          return self.updateDb('1.2.0', lol);
        }).fin(function() {
          client.end();
        });
      });
    case '1.2.0':
      logger.log('Updating DB from v1.2.0 to v1.3.0 ...');
      return Q.ninvoke(client, 'connect').then(function() {
        return Q.ninvoke(client, 'query', 'BEGIN;').then(function() {
          return Q.ninvoke(client, 'query', 'ALTER TABLE leagues ADD COLUMN is_inactive BOOLEAN;');
        }).then(function() {
          return Q.ninvoke(client, 'query', 'UPDATE leagues SET is_inactive = FALSE');
        }).then(function() {
          return Q.ninvoke(client, 'query', 'ALTER TABLE leagues ALTER COLUMN is_inactive SET NOT NULL;');
        }).then(function() {
          return Q.ninvoke(client, 'query', 'ALTER TABLE leagues ALTER COLUMN is_inactive SET DEFAULT FALSE;');
        }).then(function() {
          return Q.ninvoke(client, 'query', 'UPDATE version SET version = \'1.3.0\'');
        }).fail(function(reason) {
          logger.logException(reason);
          return Q.ninvoke(client, 'query', 'ROLLBACK;').then(function() {
            throw new Error('Failure to update database from v1.2.0 to v1.3.0.');
          });
        }).then(function() {
          return Q.ninvoke(client, 'query', 'COMMIT;');
        }).then(function() {
          return self.updateDb('1.3.0', lol);
        }).fin(function() {
          client.end();
        });
      });
    case '1.3.0':
      logger.log('DB is up to date at v1.3.0.');
      return Q('1.3.0');
    default:
      return Q.Promise(function(resolve, reject) {
        reject('Unable to update database from version v' + version + '.');
      });
  }
};

/***********/
/* Version */
/***********/

// Returns DB version as a string.
DB.prototype.getVersion = function() {
  var self = this;
  return Q.ninvoke(self.pool, 'connect').spread(function(client, done) {
    var queryParams = {
      name: 'get_version',
      text: 'SELECT version FROM version',
      values: []
    };

    return Q.ninvoke(client, 'query', queryParams).then(function(result) {
      if (!result.rows.length) {
        throw new Error('getVersion failed.');
      }

      return result.rows[0].version;
    }).fin(function() {
      done();
    });
  });
};

/*********/
/* Users */
/*********/

// Creates a user with the given fields as arguments.
DB.prototype.createUser = function(username, passwordHash, email, summonerName, region) {
  var self = this;
  return Q.ninvoke(self.pool, 'connect').spread(function(client, done) {
    var queryParams = {
      name: 'create_user',
      text: 'INSERT INTO users (username, password_hash, email, summoner_name, region) VALUES ($1, $2, $3, $4, $5);',
      values: [username, passwordHash, email, summonerName, region]
    };

    return Q.ninvoke(client, 'query', queryParams).then(function() {
      // Absorb previous return and return nothing instead.
    }).fin(function() {
      done();
    });
  });
};

// Returns false if user does not exist otherwise it returns an object
// with the username, summoner_name, email, and password_hash fields.
DB.prototype.getUser = function(username) {
  var self = this;
  return Q.ninvoke(self.pool, 'connect').spread(function(client, done) {
    var queryParams = {
      name: 'get_user',
      text: 'SELECT username, summoner_name, email, password_hash, region FROM users WHERE username = $1;',
      values: [username]
    };

    return Q.ninvoke(client, 'query', queryParams).then(function(result) {
      if (!result.rows.length) {
        return false;
      } else {
        return result.rows[0];
      }
    }).fin(function() {
      done();
    });
  });
};

// Updates a user's password.
DB.prototype.updateUserPassword = function(username, passwordHash) {
  var self = this;
  return Q.ninvoke(self.pool, 'connect').spread(function(client, done) {
    var queryParams = {
      name: 'update_user_password',
      text: 'UPDATE users SET password_hash = $2 WHERE username = $1;',
      values: [username, passwordHash]
    };

    return Q.ninvoke(client, 'query', queryParams).then(function() {
      // Absorb previous return and return nothing instead.
    }).fin(function() {
      done();
    });
  });
};

/***********/
/* Leagues */
/***********/

// Creates a League with the given fields as arguments. Uses the postgreSQL now() function to
// get the current time and sets no matches tracked initially. Doesn't return anything. Data
// should be passed in as an object.
DB.prototype.createLeague = function(name, owner, region, data) {
  var self = this;
  return Q.ninvoke(self.pool, 'connect').spread(function(client, done) {
    var queryParams = {
      name: 'create_league',
      text: 'INSERT INTO leagues (name, owner, region, data, creation_time, matches_tracked, last_update) VALUES ($1, $2, $3, $4, now(), $5, now());',
      values: [name, owner, region, JSON.stringify(data), []]
    };

    return Q.ninvoke(client, 'query', queryParams).then(function() {
      // Absorb previous return and return nothing instead.
    }).fin(function() {
      done();
    });
  });
};

// Query database for all Leagues that exist and execute leagueCallback(league) for each one
// and then finishedCallback() when all the rows have been received. Doesn't return anything.
// League objects contain the fields: id, name, owner, region, data, creation_time,
// matches_tracked, and is_inactive.
DB.prototype.getAllLeagues = function(leagueCallback, finishedCallback) {
  var self = this;
  Q.ninvoke(self.pool, 'connect').spread(function(client, done) {
    var queryParams = {
      name: 'get_all_leagues',
      text: 'SELECT id, name, owner, region, data, creation_time, matches_tracked, last_update, is_inactive FROM leagues;',
      values: []
    };

    var query = client.query(queryParams);

    query.on('row', function(league) {
      league.data = JSON.parse(league.data);
      leagueCallback(league);
    });

    query.on('end', function() {
      finishedCallback();
      done();
    });

    query.on('error', function(err) {
      done();
    });
  }).then(function() {
    // Absorb previous return and return nothing instead.
  }).done();
};

// Returns the total number of Leagues that exist for a particular user.
DB.prototype.getNumberOfUsersLeagues = function(username) {
  var self = this;
  return Q.ninvoke(self.pool, 'connect').spread(function(client, done) {
    var queryParams = {
      name: 'get_users_leagues_count',
      text: 'SELECT COUNT(*) FROM leagues WHERE owner = $1;',
      values: [username]
    };

    return Q.ninvoke(client, 'query', queryParams).then(function(result) {
      if (result.rows.length !== 1) {
        throw new Error('Unexpected SQL result.');
      }

      return parseInt(result.rows[0].count);
    }).fin(function() {
      done();
    });
  });
};

// Returns an array of League objects associated with the username. Returns an empty
// array if the user does not exist or if the user has no leagues. League objects
// contain the fields: id, name, owner, data, matches_tracked, and creation_time.
DB.prototype.getUsersLeagues = function(username) {
  var self = this;
  return Q.ninvoke(self.pool, 'connect').spread(function(client, done) {
    var queryParams = {
      name: 'get_users_leagues',
      text: 'SELECT id, name, owner, region, data, creation_time, matches_tracked, last_update FROM leagues WHERE owner = $1;',
      values: [username]
    };

    return Q.ninvoke(client, 'query', queryParams).then(function(result) {
      var leagues = result.rows;
      for (var i = 0; i < leagues.length; i++) {
        leagues[i].data = JSON.parse(leagues[i].data);
      }

      return leagues;
    }).fin(function() {
      done();
    });
  });
};

// Returns false if a League with the given ID does not exist otherwise it returns an
// object with the fields: id, name, owner, data, creation_time, matches_tracked, and is_inactive.
DB.prototype.getLeague = function(id) {
  var self = this;
  return Q.ninvoke(self.pool, 'connect').spread(function(client, done) {
    var queryParams = {
      name: 'get_league',
      text: 'SELECT id, name, owner, region, data, creation_time, matches_tracked, last_update, is_inactive FROM leagues WHERE id = $1;',
      values: [id]
    };

    return Q.ninvoke(client, 'query', queryParams).then(function(result) {
      if (!result.rows.length) {
        return false;
      } else {
        var league = result.rows[0];
        league.data = JSON.parse(league.data);
        return league;
      }
    }).fin(function() {
      done();
    });
  });
};

// Update League with passed in id to have the passed in data and newTrackedMatches. The values
// given overwrite any previous values. Data should be passed in as an object and newTrackedMatches
// should be passed in as an array of gameIds.
DB.prototype.updateLeague = function(id, data, newTrackedMatches) {
  var self = this;
  return Q.ninvoke(self.pool, 'connect').spread(function(client, done) {
    var queryParams = {
      name: 'update_league',
      text: 'UPDATE leagues SET data = $2, matches_tracked = array_cat(matches_tracked, $3), last_update = now() WHERE id = $1;',
      values: [id, JSON.stringify(data), newTrackedMatches]
    };

    return Q.ninvoke(client, 'query', queryParams).then(function() {
      // Absorb previous return and return nothing instead.
    }).fin(function() {
      done();
    });
  });
};

// Set the value of the is_inactive column on the leagues table for a specific row with the given id.
DB.prototype.setLeagueInactiveFlag = function(id, isInactive) {
  var self = this;
  return Q.ninvoke(self.pool, 'connect').spread(function(client, done) {
    var queryParams = {
      name: 'set_league_inactive',
      text: 'UPDATE leagues SET is_inactive = $2 WHERE id = $1',
      values: [id, isInactive]
    };

    return Q.ninvoke(client, 'query', queryParams).then(function() {
      // Absorb previous return and return nothing instead.
    }).fin(function() {
      done();
    });
  });
};

// Delete the League with the given id.
DB.prototype.deleteLeague = function(id) {
  var self = this;
  return Q.ninvoke(self.pool, 'connect').spread(function(client, done) {
    var queryParams = {
      name: 'delete_league',
      text: 'DELETE FROM leagues WHERE id = $1',
      values: [id]
    };

    return Q.ninvoke(client, 'query', queryParams).then(function() {
      // Absorb previous return and return nothing instead.
    }).fin(function() {
      done();
    });
  });
};

module.exports = DB;
