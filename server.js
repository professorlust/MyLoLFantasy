var fs = require('fs');
var http = require('http');
var https = require('https');
var path = require('path');

var express = require('express');

var mlf = require('./app.js');
var logger = require('./logger.js');
var settings = require('./settings.js');

try {
  mlf.createApp(true).then(function(mlfApp) {
    var app = express();

    // Log all requests to the server
    app.use(function logRequests(req, res, next) {
      logger.logRequest(req);
      next();
    });

    app.get('/', function(req, res) {
      res.redirect('/MLF');
    });
    app.use('/MLF', mlfApp);

    var httpsServer = https.createServer({
      key: fs.readFileSync(path.join(__dirname, 'certs/key.pem')),
      cert: fs.readFileSync(path.join(__dirname, 'certs/key-cert.pem')),
    }, app);

    httpsServer.listen(settings.server_https_port, function() {
      var host = httpsServer.address().address;
      var port = httpsServer.address().port;

      logger.log('Server listening at https://' + host + ':' + port);
    });

    // Create server for redirecting to the secure version of the app
    var redirectApp = express();
    redirectApp.get('*', function(req, res) {
      if (settings.redirect_default_port) {
        res.redirect('https://' + req.hostname + req.url);
      } else {
        res.redirect('https://' + req.hostname + ':' + settings.server_https_port + req.url);
      }
    });
    var httpServer = http.createServer(redirectApp).listen(settings.server_http_port);

  }).fail(function(err) {
    if (err.stack) {
      logger.error(err.stack);
    } else {
      logger.error('Error: ' + err);
    }
  }).done();
} catch (err) {
  if (err.stack) {
    logger.error(err.stack);
  } else {
    logger.error('Error: ' + err);
  }
}
