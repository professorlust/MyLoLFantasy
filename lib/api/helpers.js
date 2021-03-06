var secretId = require('../secret_id.js');

module.exports = {
  createProfileData: function(user) {
    if (user) {
      return {
        isLoggedIn: true,
        username: user.username,
        summonerName: user.summonerName,
      };
    } else {
      return {
        isLoggedIn: false,
      };
    }
  },

  verifyCsrfToken: function(req, res, next) {
    if (req.cookies.csrf !== req.get('X-CSRF-Token')) {
      res.status(403);
      res.send('Unauthorized');
    } else {
      next();
    }
  },

  prunedLeague: function(league, statsApi) {
    var prunedLeague = {
      name: league.name,
      id: secretId.encodeLeagueId(league.id),
      owner: league.owner,
      region: league.region,
      lastUpdate: league.last_update,
      data: {},
    };
    var gameCount;
    for (var summoner in league.data) {
      var summonerData = {
        stats: league.data[summoner].stats,
        points: statsApi.evaluatePoints(league.data[summoner].stats),
      };
      gameCount = league.data[summoner].stats.totalGames;
      prunedLeague.data[summoner] = summonerData;
    }
    prunedLeague.gameCount = gameCount;
    return prunedLeague;
  },

  prunedLeagues: function(leagues) {
    prunedLeagues = [];
    for (var i = 0; i < leagues.length; i++) {
      prunedLeagues.push({
        name: leagues[i].name,
        id: secretId.encodeLeagueId(leagues[i].id),
        lastUpdate: leagues[i].last_update,
      });
    }
    return prunedLeagues;
  },
};
