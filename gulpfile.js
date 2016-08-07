var childProcess = require('child_process');
var path = require('path');

var gulp = require('gulp');
var jade = require('gulp-jade');
var jshint = require('gulp-jshint');
var less = require('gulp-less');
var lesshint = require('gulp-lesshint');
var plumber = require('gulp-plumber');
var watch = require('gulp-watch');

var bowerInstall = require('./lib/bower_install.js');
var logger = require('./lib/logger.js');
var settings = require('./lib/settings.js');
var version = require('./lib/version.js');

var jadeLocals = {
  settings: settings,
  version: version,
};

var paths = {};
paths.lessMain = 'less/theme.less';
paths.lessAll = 'less/**/*.less';
paths.css = 'public/css/';
paths.jade = 'jade/**/*.jade';
paths.html = 'public/';
paths.serverJs = ['server.js', 'lib/**/*.js'];
paths.publicJs = ['public/js/**/*.js', '!public/js/lib/**/*.js'];
paths.server = concatenateItems(paths.serverJs, '*.json');
paths.js = concatenateItems('gulpfile.js', paths.serverJs, paths.publicJs);

function concatenateItems() {
  var itemList = [];
  for (var i = 0; i < arguments.length; i++) {
    itemList = itemList.concat(arguments[i]);
  }
  return itemList;
}

var server = null;
var restarting = false;
function startServer() {
  if (server !== null) {
    throw new Error('Server is already started');
  }

  server = childProcess.spawn('node', ['server.js']);

  server.stdout.on('data', function(data) {
    process.stdout.write(data);
  });

  server.stderr.on('data', function(data) {
    process.stdout.write(data);
  });
}

function restartServer(callback) {
  if (restarting) {
    return;
  }

  restarting = true;

  if (server === null) {
    startServer();
    callback(null);
    restarting = false;
    return;
  }

  server.on('exit', function() {
    server = null;
    startServer();
    callback(null);
    restarting = false;
  });

  server.kill('SIGTERM');
}

gulp.task('bower', function(callback) {
  bowerInstall();
  callback();
});

gulp.task('server', function(callback) {
  startServer();
});

gulp.task('less', function() {
  return gulp.src(paths.lessMain)
    .pipe(less())
    .pipe(gulp.dest(paths.css));
});

gulp.task('jade', function() {
  return gulp.src(paths.jade)
    .pipe(jade({
      locals: jadeLocals,
    }))
    .pipe(gulp.dest(paths.html));
});

gulp.task('watch_less', ['less'], function() {
  // Watch is done like this so that if any Less file changes, the entire
  // monolithic less file is rebuilt (which depends on everything).
  return watch(paths.lessAll, function() {
    gulp.src(paths.lessMain)
      .pipe(less())
      .pipe(gulp.dest(paths.css));
  });
});

gulp.task('watch_jade', function() {
  return gulp.src(paths.jade)
    .pipe(watch(paths.jade))
    .pipe(plumber())
    .pipe(jade({
      locals: jadeLocals,
    }))
    .pipe(gulp.dest(paths.html));
});

gulp.task('watch_server', function() {
  startServer();
  return watch(paths.server, function() {
    logger.log('File changed. Restarting server...');
    restartServer(function() {});
  });
});

gulp.task('watch', ['watch_less', 'watch_jade', 'watch_server']);

gulp.task('lint_js', function() {
  return gulp.src(paths.js)
    .pipe(jshint())
    .pipe(jshint.reporter('default'));
});

gulp.task('lint_less', function() {
  return gulp.src(paths.lessAll)
    .pipe(lesshint())
    .pipe(lesshint.reporter());
});

gulp.task('lint', ['lint_js', 'lint_less']);

gulp.task('default', ['watch']);
